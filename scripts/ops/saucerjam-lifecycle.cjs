#!/usr/bin/env node
"use strict";
// SaucerJam issue lifecycle collector.
//
// The problem this solves: reports arrive, get triaged once, and then sit forever.
// Nothing closed, aged out, or bounded them, so "unactioned" became a resting state
// rather than a transient one. That is how a board turns into stale clutter and how
// an agent keeps burning tokens re-attempting work that will never converge.
//
// This is a deterministic policy runner. It contains no model calls and no local
// state: Fider itself is the record, so it is correct after any restart and needs
// neither Hermes nor a database to be online.
//
// Every report is driven toward a terminal state:
//
//   new/acknowledged -> (reproduced) -> fix-proposed -> shipped
//                    -> declined/aged-out  (terminal, with a written public reason)
//
// Guarantees:
//   * Ack      - a report is publicly acknowledged once, within ackAfterHours.
//   * Expire   - a report that never reached reproduction ages out after
//                expireAfterDays and is closed with a published reason.
//   * Escalate - a report that consumed maxAttempts is surfaced, never retried
//                silently forever.
//   * Bound    - at most maxActionsPerRun mutations per run.
//   * Silent   - empty stdout when nothing needs doing (cron-friendly).
//
// Usage:
//   node scripts/ops/saucerjam-lifecycle.cjs            # dry run, reports only
//   node scripts/ops/saucerjam-lifecycle.cjs --apply     # performs ack + expire
//   node scripts/ops/saucerjam-lifecycle.cjs --json      # machine-readable plan

const BASE_URL = (process.env.FIDER_BASE_URL || "https://community.menezmethod.com").replace(/\/+$/, "");
const API_KEY = process.env.FIDER_API_KEY || "";
const REQUEST_TIMEOUT_MS = Number(process.env.LIFECYCLE_TIMEOUT_MS || 20000);

// Identify our own comments by AUTHOR, not by content. A content marker is
// spoofable by any user (anyone can paste the string), and it leaks into the
// rendered comment as visible debug text. Fider returns the author on every
// comment, so identity is the reliable signal.
const BOT_ID = process.env.LIFECYCLE_BOT_ID || "1";

// Statuses that mean the report is finished. Fider's status is NOT a boolean:
// status=open returns only a subset, and treating planned/started as terminal
// would silently abandon work in progress.
const TERMINAL_STATUSES = new Set(["completed", "declined", "duplicate"]);
const WORKING_STATUSES = new Set(["planned", "started"]);

const DEFAULTS = {
  ackAfterHours: Number(process.env.LIFECYCLE_ACK_AFTER_HOURS || 4),
  expireAfterDays: Number(process.env.LIFECYCLE_EXPIRE_AFTER_DAYS || 60),
  maxAttempts: Number(process.env.LIFECYCLE_MAX_ATTEMPTS || 3),
  backlogCeiling: Number(process.env.LIFECYCLE_BACKLOG_CEILING || 40),
  oldestPendingHours: Number(process.env.LIFECYCLE_OLDEST_PENDING_HOURS || 24 * 14),
  maxActionsPerRun: Number(process.env.LIFECYCLE_MAX_ACTIONS || 5),
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Post text is untrusted input that ends up in a cron message delivered to a
// human. A hostile title containing newlines or terminal escapes could forge
// extra output lines or inject control sequences into that message, so it is
// normalised and capped before it is ever printed.
// Covers C0/C1 controls, soft hyphen, combining grapheme joiner, bidi controls,
// Mongolian vowel separator, zero-width and other invisible formatting characters.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0]/g;

function safe(value, limit = 120) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(UNSAFE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

const isTerminal = (status) => TERMINAL_STATUSES.has(String(status || "").toLowerCase());
const isWorking = (status) => WORKING_STATUSES.has(String(status || "").toLowerCase());

function hoursBetween(fromMs, toMs) {
  const t = Date.parse(fromMs);
  if (!Number.isFinite(t)) return null;
  return (toMs - t) / HOUR;
}

// A comment authored by this collector. Anything else is a human (or another
// bot) and counts as activity we must not override.
function isOurs(comment) {
  // Display names and content are player-controlled; only the stable ID is identity.
  return comment?.user?.id != null && String(comment.user.id) === BOT_ID;
}

function lastActivityMs(post, comments) {
  const times = [Date.parse(post.createdAt)].filter(Number.isFinite);
  for (const c of comments) {
    const t = Date.parse(c.createdAt);
    if (Number.isFinite(t)) times.push(t);
  }
  return times.length ? Math.max(...times) : null;
}

function latestMs(comments) {
  let latest = null;
  for (const c of comments) {
    const t = Date.parse(c && c.createdAt);
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  }
  return latest;
}

/**
 * Pure planner. Given Fider state, decide what the collector should do.
 * No I/O, no clock access - so it is exhaustively testable.
 */
function plan({ posts = [], commentsByNumber = {}, unknownComments = [], config = {}, now = Date.now() } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Number.isFinite(cfg[key]) || cfg[key] < 0 ||
        (["maxAttempts", "maxActionsPerRun"].includes(key) && !Number.isInteger(cfg[key])) ||
        (key === "maxAttempts" && cfg[key] === 0)) throw new Error(`Invalid lifecycle config: ${key}`);
  }
  const actions = [];
  const findings = [];
  const stats = { total: posts.length, open: 0, working: 0, terminal: 0, unacked: 0, unreadable: 0, oldestPendingHours: 0 };
  const unreadable = new Set(unknownComments.map(String));

  for (const post of posts) {
    const number = String(post.number ?? post.id ?? "");
    if (!number) continue;

    // If this post's comments could not be read, we do not know whether it has
    // been acknowledged. Acting on that ignorance would re-ack the entire board
    // on a transient Fider blip, so skip it and say so rather than guess.
    if (unreadable.has(number)) {
      findings.push({
        kind: "unreadable", number, title: post.title,
        reason: "comments could not be read; skipped so no duplicate action is taken",
      });
      stats.unreadable++;
      continue;
    }

    const status = String(post.status || "").toLowerCase();
    const comments = commentsByNumber[number] || [];

    // A closed report that a human has replied to since we closed it. Without
    // this the expiry comment's promise ("reply and it reopens") would be false.
    // Checked before the terminal skip because declined is terminal by status.
    if (status === "declined") {
      // A decline by a maintainer is not our expiry. Use the actual staff
      // response (author, reason, timestamp), not the time of an arbitrary ack.
      const response = post.response;
      const age = /^Closing this one as aged out: (\d+) days/.exec(response?.text || "");
      const closedAt = isOurs(response) && age && response.text === expireBody(number, Number(age[1]))
        ? Date.parse(response.respondedAt) : NaN;
      const theirLatest = latestMs(comments.filter((c) => !isOurs(c)));
      if (Number.isFinite(closedAt) && theirLatest !== null && theirLatest > closedAt) {
        actions.push({ kind: "reopen", number, title: post.title, reason: "reporter replied after we closed it" });
      }
      stats.terminal++;
      continue;
    }

    if (isTerminal(status)) { stats.terminal++; continue; }
    stats.open++;
    if (isWorking(status)) stats.working++;

    const ageHours = hoursBetween(post.createdAt, now);
    const attempts = comments.filter(isOurs).length;
    const acked = attempts > 0;
    if (!acked) stats.unacked++;

    if (ageHours !== null && ageHours > stats.oldestPendingHours) {
      stats.oldestPendingHours = Math.round(ageHours);
    }

    // Already in flight: never expire work in progress. But it is still
    // acknowledged below - a reporter deserves to hear something even when the
    // item is already moving, and "planned" with no comment is how staleness starts.

    const ageDays = (ageHours ?? 0) / 24;
    const idleMs = lastActivityMs(post, comments);
    const idleDays = idleMs === null ? ageDays : (now - idleMs) / DAY;

    // 1. Escalate: consumed its attempt budget without converging. Surface it
    //    explicitly instead of retrying forever.
    if (attempts >= cfg.maxAttempts) {
      findings.push({
        kind: "escalate", number, title: post.title, attempts,
        reason: `consumed ${attempts}/${cfg.maxAttempts} attempts without reaching a fix`,
      });
      continue;
    }

    // 2. Acknowledge: nobody has told the reporter we saw it.
    if (!acked && ageHours !== null && ageHours >= cfg.ackAfterHours) {
      actions.push({
        kind: "ack", number, title: post.title,
        reason: `unacknowledged after ${Math.round(ageHours)}h`,
      });
      continue;
    }

    // 3. Expire: old enough and quiet enough. Closed with a published reason
    //    rather than left to rot. Note this must NOT require zero attempts: the
    //    ack itself is an attempt, so requiring zero would mean nothing ever
    //    ages out. Being idle is the signal that matters.
    if (!isWorking(status) && ageDays >= cfg.expireAfterDays && idleDays >= cfg.expireAfterDays) {
      actions.push({
        kind: "expire", number, title: post.title, ageDays: Math.round(ageDays),
        reason: `no reproduction and no activity for ${Math.round(ageDays)} days`,
      });
    }
  }

  // Loop-level health. A dead collector and an empty board must not look alike.
  if (stats.open > cfg.backlogCeiling) {
    findings.push({
      kind: "backlog", reason: `${stats.open} open reports exceeds the ceiling of ${cfg.backlogCeiling}`,
    });
  }
  if (stats.oldestPendingHours > cfg.oldestPendingHours) {
    findings.push({
      kind: "liveness",
      reason: `oldest open report is ${stats.oldestPendingHours}h old (threshold ${cfg.oldestPendingHours}h)`,
    });
  }
  if (stats.unacked > 0 && actions.every((a) => a.kind !== "ack")) {
    findings.push({
      kind: "unacked",
      reason: `${stats.unacked} open report(s) still have no acknowledgement`,
    });
  }

  return { actions: actions.slice(0, cfg.maxActionsPerRun), suppressed: Math.max(0, actions.length - cfg.maxActionsPerRun), findings, stats, config: cfg };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

async function api(path, init = {}) {
  if (!API_KEY) throw new Error("FIDER_API_KEY is not set");
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  if (!text) return null;
  return JSON.parse(text);
}

function ackBody(number) {
  return `Thanks for reporting this - it's in the queue.

What happens next: we try to reproduce it. If we can, it becomes a tracked fix. If we can't reproduce it from the description, we'll ask for the missing details rather than guess.

No action needed from you.`;
}

function expireBody(number, ageDays) {
  return `Closing this one as aged out: ${ageDays} days with no reproduction and no further activity. We'd rather close it honestly than leave it open forever.

This is not a judgement on the report. If you can still reproduce it, reply here with the steps and it reopens automatically.`;
}

function reopenBody() {
  return `Reopened - thanks for following up. This is back in the queue and will be looked at again.`;
}

// Fider changes status through a DEDICATED endpoint. `PUT /api/v1/posts/{n}` accepts
// only title/description and silently ignores `status`: it returns 200 while changing
// nothing, so a closure written that way would tell the reporter the report was closed
// while leaving it open indefinitely. Verified against the live API.
const statusPath = (number) => `/api/v1/posts/${number}/status`;

async function setStatus(number, status, text) {
  // Fider stores status and its public response in the same database UPDATE.
  await api(statusPath(number), { method: "PUT", body: JSON.stringify({ status, text }) });
}

async function applyAction(action) {
  if (action.kind === "reopen") return setStatus(action.number, "open", reopenBody());
  if (action.kind === "expire") return setStatus(action.number, "declined", expireBody(action.number, action.ageDays));
  await api(`/api/v1/posts/${action.number}/comments`, { method: "POST", body: JSON.stringify({ content: ackBody(action.number) }) });
}

function readList(value, key) {
  const list = Array.isArray(value) ? value : value?.[key];
  if (!Array.isArray(list) || list.some((item) => !item || typeof item !== "object")) {
    throw new Error(`Invalid Fider ${key} response`);
  }
  if (key === "posts" && list.some((p) => !Number.isSafeInteger(p.number) || p.number <= 0 ||
      !["open", "planned", "started", "completed", "declined", "duplicate"].includes(p.status) ||
      !Number.isFinite(Date.parse(p.createdAt)))) throw new Error("Invalid Fider post identity, status or timestamp");
  return list;
}

async function collect() {
  // Fider supports limit=all, not offset pagination. Fetch declined explicitly
  // too: the default view must not decide whether we can honour a reopen promise.
  const all = readList(await api("/api/v1/posts?view=all&limit=all"), "posts");
  const declined = readList(await api("/api/v1/posts?view=declined&limit=all"), "posts");
  const posts = [...new Map([...all, ...declined].map((p) => [p.number, p])).values()];
  const commentsByNumber = {};
  const unknownComments = [];
  for (const post of posts) {
    const number = String(post.number ?? post.id ?? "");
    if (!number) continue;
    try {
      const res = await api(`/api/v1/posts/${number}/comments`);
      const comments = readList(res, "comments");
      if (comments.some((c) => c.user?.id == null || !Number.isFinite(Date.parse(c.createdAt)))) {
        throw new Error("Invalid Fider comment identity or timestamp");
      }
      commentsByNumber[number] = comments;
    } catch {
      // Deliberately do NOT record an empty list. "We could not read the
      // comments" and "there are no comments" must never look alike: treating a
      // transient fetch failure as no-comments would make every acknowledged
      // report appear unacknowledged and re-ack the entire board.
      unknownComments.push(number);
    }
  }
  return { posts, commentsByNumber, unknownComments };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const json = args.has("--json");
  const apply = args.has("--apply");

  let state;
  try {
    state = await collect();
  } catch (err) {
    process.stdout.write(`saucerjam-lifecycle: Fider unreachable - ${safe(err.message, 200)}\n`);
    return 1;
  }

  const result = plan({
    posts: state.posts,
    commentsByNumber: state.commentsByNumber,
    unknownComments: state.unknownComments,
  });

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 1) + "\n");
    return state.unknownComments.length ? 1 : 0;
  }

  // Every post-derived value printed here is untrusted input on its way into a
  // message delivered to a human, so it goes through safe() first.
  const lines = [];
  let failed = state.unknownComments.length > 0;
  for (const action of result.actions) {
    const detail = `${action.kind} #${safe(action.number, 20)} - ${action.reason} (${safe(action.title)})`;
    if (!apply) {
      lines.push(`PLAN ${detail}`);
      continue;
    }
    try {
      await applyAction(action);
      lines.push(`DONE ${detail}`);
    } catch (err) {
      failed = true;
      lines.push(`FAIL ${action.kind} #${safe(action.number, 20)} - ${safe(err.message, 200)}`);
    }
  }
  for (const f of result.findings) {
    lines.push(`WARN ${f.kind}${f.number ? " #" + safe(f.number, 20) : ""} - ${f.reason}${f.title ? ` (${safe(f.title)})` : ""}`);
  }

  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  return failed ? 1 : 0;
}

module.exports = { plan, DEFAULTS, BOT_ID, TERMINAL_STATUSES, ackBody, expireBody, reopenBody, statusPath, safe };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stdout.write(`saucerjam-lifecycle: fatal - ${safe(err.message, 200)}\n`);
    process.exit(1);
  });
}
