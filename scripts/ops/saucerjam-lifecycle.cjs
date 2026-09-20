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
    // Zero is rejected for every key, not just maxAttempts. A zero window is not
    // "disabled", it is a collector that silently does nothing or expires
    // everything instantly while still reporting exit 0 and empty stdout - i.e.
    // indistinguishable from healthy.
    if (!Number.isFinite(cfg[key]) || cfg[key] <= 0 ||
        (["maxAttempts", "maxActionsPerRun"].includes(key) && !Number.isInteger(cfg[key]))) {
      throw new Error(`Invalid lifecycle config: ${key}`);
    }
  }
  const actions = [];
  const findings = [];
  const stats = { total: posts.length, open: 0, working: 0, terminal: 0, unacked: 0, unackedOverdue: 0, unreadable: 0, oldestPendingHours: 0 };
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
      // Identity of the closure is the author plus the stable shape of our own
      // sentence - NOT the exact prose. Comparing the full text means one future
      // wording change silently stops every already-closed post from ever
      // reopening, while those posts keep promising "reply and it reopens".
      const closedMarker = /^Closing this one as aged out: (\d+) days/.exec(response?.text || "");
      const closedAt = isOurs(response) && closedMarker && Number.isFinite(Date.parse(response?.respondedAt))
        ? Date.parse(response.respondedAt) : NaN;
      // Only the person who filed the report may reopen it. A maintainer adding a
      // closing note must not flip an aged-out report back to open, and the reason
      // we publish must not call a maintainer "the reporter".
      // A reply is ANY comment created after we closed. Closure is written as a
      // status response, not a comment, so the collector posts nothing at or after
      // that moment - anything later is genuinely from a human.
      // Do NOT filter on author identity here. On the live board the only account
      // that has ever commented IS the post author (user id 1 == BOT_ID), so
      // filtering "not us" deleted the reporter's own replies and silently
      // disabled reopening for the whole board, while the closure text kept
      // promising that replying reopens it.
      const replies = comments.filter((c) => {
        const t = Date.parse(c && c.createdAt);
        return Number.isFinite(t) && t > closedAt;
      });
      if (Number.isFinite(closedAt) && replies.length > 0) {
        actions.push({
          kind: "reopen", number, title: post.title,
          reason: "a reply arrived after we closed it",
        });
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
    if (!acked) {
      stats.unacked++;
      // Only "overdue" is worth waking anyone for. Reporting a report that is
      // merely young would deliver a WARN on every hourly tick for its first
      // ackAfterHours, and that wallpaper is what makes the exit-1 FAIL alerts
      // get ignored.
      if (ageHours !== null && ageHours >= cfg.ackAfterHours) stats.unackedOverdue++;
    }

    if (ageHours !== null && ageHours > stats.oldestPendingHours) {
      stats.oldestPendingHours = Math.round(ageHours);
    }

    // Already in flight: never expire work in progress. But it is still
    // acknowledged below - a reporter deserves to hear something even when the
    // item is already moving, and "planned" with no comment is how staleness starts.

    const ageDays = (ageHours ?? 0) / 24;
    const idleMs = lastActivityMs(post, comments);
    const idleDays = idleMs === null ? ageDays : (now - idleMs) / DAY;

    // 1. Escalate: consumed its attempt budget without converging. Surface it, but
    //    do NOT stop here. The `continue` that used to sit below made escalation
    //    the only state in the machine with no exit: the report was never
    //    acknowledged, never expired, never reopened-from, and emitted a WARN on
    //    every tick forever. Surfacing a problem must not also strand it.
    if (attempts >= cfg.maxAttempts) {
      findings.push({
        kind: "escalate", number, title: post.title, attempts,
        reason: `consumed ${attempts}/${cfg.maxAttempts} attempts without reaching a fix`,
      });
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
      // Publish the IDLE period, which is what the gate actually measured - not the
      // post's age. A 200-day-old report whose reporter replied 61 days ago was
      // being closed with "200 days with no further activity": a claim the
      // collector never observed, written permanently into the post's response.
      const idle = Math.max(1, Math.round(idleDays));
      actions.push({
        kind: "expire", number, title: post.title, ageDays: idle,
        reason: `no activity for ${idle} days`,
      });
    }
  }

  // Loop-level health. A dead collector and an empty board must not look alike.
  if (stats.open > cfg.backlogCeiling) {
    findings.push({
      kind: "backlog", reason: `${stats.open} open reports exceeds the ceiling of ${cfg.backlogCeiling}`,
    });
  }
  // There is deliberately NO "liveness" finding here. A collector that has stopped
  // running cannot report its own absence, so an age-based warning is not a
  // dead-man switch - it is hourly wallpaper on any board with an old post, and it
  // trains the reader to ignore the exit-1 FAIL lines that matter. The age is still
  // reported in stats for an external monitor; missed-run detection belongs to the
  // scheduler, which is the only thing positioned to know a run never happened.
  //
  // `unacked` fires only when acks are genuinely overdue AND this run is not
  // already about to ack them - otherwise it is the same wallpaper.
  // Bound the run BEFORE computing findings, so a finding can see that the cap
  // suppressed work. Computing findings against the uncapped list made `unacked`
  // unreachable: every overdue-unacked report always had an ack action planned for
  // it, so the warning could not fire even when the cap meant no ack happened.
  const planned = actions.slice(0, cfg.maxActionsPerRun);
  const plannedAcks = planned.filter((a) => a.kind === "ack").length;
  if (stats.unackedOverdue > plannedAcks) {
    findings.push({
      kind: "unacked",
      reason: `${stats.unackedOverdue - plannedAcks} report(s) are overdue for acknowledgement`,
    });
  }

  return { actions: planned, suppressed: Math.max(0, actions.length - cfg.maxActionsPerRun), findings, stats, config: cfg };
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
  // Says only what the collector observed: it saw the report. It enqueues nothing,
  // so it must not claim the report is "in the queue".
  return `Thanks for reporting this - we've seen it.

What happens next: we try to reproduce it. If we can, it becomes a tracked fix. If we can't reproduce it from the description, we'll ask for the missing details rather than guess.

No action needed from you.`;
}

function expireBody(number, ageDays) {
  // `ageDays` is the IDLE period actually measured by the gate. The wording must
  // not claim a reproduction attempt happened - nothing here observes one.
  // The "aged out: <n> days" prefix is also the closure marker matched on reopen.
  return `Closing this one as aged out: ${ageDays} days with no activity. We'd rather close it honestly than leave it open forever.

This is not a judgement on the report. If you can still reproduce it, reply here with the steps and it reopens automatically.`;
}

function reopenBody() {
  return `Reopened - thanks for following up. We'll take another look.`;
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
  // Each line is written AS IT HAPPENS, never buffered until the end. Buffering
  // means a run killed by the deadline reports nothing at all: writes that already
  // succeeded against the tracker would be invisible, and the operator would see a
  // silent timeout instead of "these three closed, this one failed". Silence is
  // still preserved - no lines produced means no output.
  const emit = (line) => process.stdout.write(line + "\n");
  let failed = state.unknownComments.length > 0;
  for (const action of result.actions) {
    const detail = `${action.kind} #${safe(action.number, 20)} - ${action.reason} (${safe(action.title)})`;
    if (!apply) {
      emit(`PLAN ${detail}`);
      continue;
    }
    try {
      await applyAction(action);
      emit(`DONE ${detail}`);
    } catch (err) {
      failed = true;
      emit(`FAIL ${action.kind} #${safe(action.number, 20)} - ${safe(err.message, 200)}`);
    }
  }
  for (const f of result.findings) {
    emit(`WARN ${f.kind}${f.number ? " #" + safe(f.number, 20) : ""} - ${f.reason}${f.title ? ` (${safe(f.title)})` : ""}`);
  }

  return failed ? 1 : 0;
}

module.exports = { plan, DEFAULTS, BOT_ID, TERMINAL_STATUSES, ackBody, expireBody, reopenBody, statusPath, safe };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    process.stdout.write(`saucerjam-lifecycle: fatal - ${safe(err.message, 200)}\n`);
    process.exit(1);
  });
}
