#!/usr/bin/env node
// Hermes ops guardrail body. The .sh wrappers are what cron runs; the logic
// lives here so `npm run ops:selftest` can drive it with fixtures.
//
// Contract (docs/HERMES-AUTOMATION-CONTRACT.md D3):
//   check : read-only, safe any time.
//   heal  : only actions marked allowed_autonomously (SaucerJamDown -> restart).
//   exit 0 + empty stdout = healthy/silent; exit 0 + stdout = event; non-zero = alert.
//   --json, --dry-run. Internal timeout < 60s. State file silences a standing condition.
const fs = require("node:fs");
const path = require("node:path");
// A7: post-derived text must be guarded before it reaches an alert or log line.
const { guardPublicText } = require("../../server/community");

const ROOT = path.resolve(__dirname, "..", "..");
const STATE_DIR = process.env.SAUCERJAM_OPS_STATE_DIR || path.join(ROOT, "logs", "ops");
const FIXTURE = process.env.SAUCERJAM_FIXTURE || "";
const COOLDOWN_MS = 30 * 60_000;
// `Number(env) || default` silently discards an explicit "0", which makes a
// tunable impossible to disable. Parse once, preserving zero and negatives-safe.
const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
// One incident owns at most two restarts, counted across separate invocations
// because each cron tick is its own process. The budget resets only when the
// service is observed healthy again.
const MAX_RESTARTS_PER_INCIDENT = num("SAUCERJAM_HEAL_MAX_RESTARTS", 2);
// A second confirmation is required before acting, and the two samples must be
// separated so a single flapping scrape cannot spend a restart.
const CONFIRM_DELAY_MS = num("SAUCERJAM_HEAL_CONFIRM_DELAY_MS", 5_000);
// Total wall-clock budget for heal. The wrapper timeout is 60s; staying under
// 55s leaves room for the process to report a result instead of being killed.
const HEAL_BUDGET_MS = num("SAUCERJAM_HEAL_BUDGET_MS", 50_000);
const HEAL_POLL_MS = num("SAUCERJAM_HEAL_POLL_MS", 3_000);
// A restart is only allowed after this long, so two ticks cannot stack.
const HEAL_COOLDOWN_MS = num("SAUCERJAM_HEAL_COOLDOWN_MS", 5 * 60_000);
// A standing queue is a constant condition: the ids do not change while items sit
// untriaged, so the tick interval repeats the same alert indefinitely. With
// COOLDOWN_MS == the 30m tick, the guard at the bottom of runCheck never trips and
// the whole queue is re-announced every tick forever. A standing condition is
// therefore re-announced on a much longer floor — enough to keep reminding an
// operator, not enough to become wallpaper. A *changed* key still notifies at once.
const STANDING_REMINDER_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
// Telegram caps messages at 4096 chars. MAX_REPORTED_ITEMS bounds the count and
// MAX_MESSAGE_CHARS bounds the whole rendered body, so a queue of long items
// still fits even though count alone cannot guarantee it.
const MAX_REPORTED_ITEMS = 10;
const MAX_MESSAGE_CHARS = 3900;
const APP_UUID = process.env.COOLIFY_APP_SAUCERJAM || "aoeefnsohotlncnvmpgwmaao";

const NAMES = {
  sre: { requiredEnv: ["COOLIFY_URL", "COOLIFY_TOKEN"] },
  community: { requiredEnv: ["COMMUNITY_ACTION_TOKEN"] },
};

function base() {
  return String(process.env.SAUCERJAM_URL || "https://qd.menezmethod.com").replace(/\/+$/, "");
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: res.status, body: await res.text() };
}

function loadFixture() {
  return FIXTURE ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : null;
}

async function sreCondition(fx) {
  const health = fx ? fx.health : await get(`${base()}/health`);
  if (health.status !== 200) return { key: "down", unavailable: true, alert: true, message: `SaucerJamDown: /health returned ${health.status}` };
  // The body must be JSON with a `status`, and the community block must say ok.
  // A 200 carrying an HTML error page or a degraded community block is not
  // healthy service, and the old check could not tell them apart.
  // Health must be parseable, and both the game and the community block must
  // report ok. A 200 carrying an HTML error page, an empty body, or a degraded
  // community block is not service health, and the old check could not tell
  // them apart.
  let body;
  try {
    body = JSON.parse(health.body || "{}");
  } catch {
    return { key: "health_malformed", alert: true, message: "SaucerJamHealthMalformed: /health did not return JSON" };
  }
  if (!body || typeof body.status !== "string")
    return { key: "health_malformed", alert: true, message: "SaucerJamHealthMalformed: /health body carries no status" };
  if (body.status && body.status !== "ok")
    return { key: `health_status:${safeField(body.status, 24)}`, alert: true, message: `SaucerJamHealthDegraded: /health status=${safeField(body.status, 24)}` };
  if (body.community && body.community.status && body.community.status !== "ok")
    return { key: `community:${safeField(body.community.status, 24)}`, alert: true, message: `SaucerJamHealthDegraded: community=${safeField(body.community.status, 24)} issues=${(body.community.issues || []).map((i) => safeField(i, 40)).join(",")}` };
  const rankings = safeField(body.rankings, 24);
  if (rankings && rankings !== "ok")
    return { key: `rankings:${rankings}`, alert: true, message: `SaucerJamHealthDegraded: rankings=${rankings}` };
  const metrics = fx ? fx.metrics : await get(`${base()}/metrics`);
  if (metrics.status !== 200 || !String(metrics.body || "").includes("saucerjam_rooms"))
    return { key: "metrics_missing", alert: true, message: `SaucerJamDown: /metrics missing saucerjam_rooms (status ${metrics.status})` };
  // Rankings health must be *observed*, not assumed: healthy only when the ok
  // series is present and set to 1. A missing series is not a healthy signal,
  // which is how `rankings: degraded` plus an unreadable body used to pass.
  const metricsText = String(metrics.body || "");
  const rankingsStatus = metricsText.match(/saucerjam_rankings_status\{status="(\w+)"\}\s+(\d+)/);
  if (!rankingsStatus || rankingsStatus[1] !== "ok" || Number(rankingsStatus[2]) !== 1)
    return { key: "rankings_degraded", alert: true, message: "SaucerJamRankingSaveErrors: metrics do not report healthy rankings" };
  if (/saucerjam_community_queue_healthy\s+0/.test(String(metrics.body || "")))
    return { key: "community_store_unhealthy", alert: true, message: "SaucerJamHealthDegraded: the community queue store is unhealthy" };
  return null;
}

// Every field below is post-derived (it came from Fider through the webhook),
// so it passes through guardPublicText before it can reach an alert or log
// line: that strips bidi overrides, zero-width and control characters, and
// ANSI escapes, and caps the length. The id is guarded separately because the
// dedupe key must stay on the raw value.
function safeField(value, limit) {
  return guardPublicText(String(value ?? "").replace(/\s+/g, " ").trim(), { limit });
}

// One readable block per queued item so the Hermes delivery says what was
// processed, not just a bare id. Missing fields degrade quietly — Fider can
// omit them and the queue API is the only source of truth. Every value is
// guarded first, because the alert text is post-derived and untrusted.
function formatQueueItem(item) {
  const ref = safeField(item.number ?? item.id ?? "?", 20) || "?";
  const kind = safeField(item.kind, 24) || "item";
  const lines = [`#${ref} · ${kind} · ${safeField(item.title, 120) || "(untitled)"}`];
  const description = safeField(item.description, 200);
  if (description) lines.push(`   ${description}`);
  const meta = [];
  if (item.votes !== undefined && item.votes !== null && !Number.isNaN(Number(item.votes)))
    meta.push(`${Number(item.votes)} vote(s)`);
  const status = safeField(item.status, 24);
  if (status) meta.push(`status: ${status}`);
  const proposal = safeField(item.proposal, 24);
  if (proposal) meta.push(`proposal: ${proposal}`);
  const reference = safeField(item.reference, 60);
  if (reference) meta.push(`ref: ${reference}`);
  if (meta.length) lines.push(`   ${meta.join(" · ")}`);
  const url = safeField(item.url, 120);
  if (url) lines.push(`   ${url}`);
  const received = item.receivedAt ? new Date(item.receivedAt) : null;
  if (received && !Number.isNaN(received.getTime()))
    lines.push(`   received ${received.toISOString().replace("T", " ").slice(0, 16)} UTC`);
  return lines.join("\n");
}

function formatQueueMessage(items) {
  const header = `CommunityQueue: ${items.length} new item(s)`;
  const parts = [header];
  let length = header.length;
  let shown = 0;
  for (const item of items) {
    if (shown >= MAX_REPORTED_ITEMS) break;
    const block = formatQueueItem(item);
    if (length + block.length + 1 > MAX_MESSAGE_CHARS) break;
    parts.push(block);
    length += block.length + 1;
    shown++;
  }
  const hidden = items.length - shown;
  if (hidden > 0) parts.push(`…and ${hidden} more not shown`);
  return parts.join("\n");
}

async function communityCondition(fx) {
  const q = fx
    ? fx.queue
    : await get(`${base()}/api/community/queue?status=new`, { "x-community-token": process.env.COMMUNITY_ACTION_TOKEN || "" });
  if (q.status !== 200) return { key: "queue_unreachable", alert: true, message: `CommunityQueueUnreachable: /api/community/queue returned ${q.status}` };
  let items = [];
  try {
    items = JSON.parse(q.body || "{}").items || [];
  } catch {}
  if (!items.length) return null;
  // The ids are post-derived too, so they are guarded for display; the dedupe
  // key stays on the raw values so a standing queue still reports once.
  const ids = items.map((item) => guardPublicText(String(item.id ?? ""), { limit: 40 })).join(",");
  return { key: `queue:${items.map((item) => item.id).join(",")}`, alert: false, standing: true, message: formatQueueMessage(items) };
}

function stateFile(name) {
  return path.join(STATE_DIR, `${name}.state.json`);
}
function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function logLine(name, text) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(path.join(STATE_DIR, `${name}.log`), `${new Date().toISOString()} ${text}\n`);
}
function emit(opts, message) {
  process.stdout.write(opts.json ? `${JSON.stringify({ ops: true, message })}\n` : `${message}\n`);
}

async function restartSaucerJam() {
  const url = String(process.env.COOLIFY_URL || "").replace(/\/+$/, "");
  // A network failure is a failed restart, not an exception that skips the
  // incident bookkeeping. The budget has to be recorded either way, otherwise an
  // unreachable Coolify retries forever.
  const attempt = async () => {
    try {
      const res = await fetch(`${url}/api/v1/applications/${APP_UUID}/restart`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN || ""}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  if (await attempt()) return true;
  await sleep(2_000);
  return attempt();
}

// Optional injected interface: when a status source is discoverable, an active
// deployment must block a restart. Restarting mid-deploy is how a healthy
// rollout gets mistaken for a failure and interrupted.
async function deploymentInFlight(fx) {
  if (fx && typeof fx.deploymentActive === "boolean") return fx.deploymentActive;
  if (String(process.env.SAUCERJAM_DEPLOYMENT_ACTIVE || "") === "true") return true;
  const url = String(process.env.COOLIFY_URL || "").replace(/\/+$/, "");
  if (!url || !process.env.COOLIFY_TOKEN) return false;
  try {
    const res = await fetch(`${url}/api/v1/deployments?uuid=${APP_UUID}`, {
      headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const payload = await res.json();
    const entries = Array.isArray(payload) ? payload : payload?.deployments || [];
    return entries.some((entry) => entry?.status === "in_progress" || entry?.status === "queued");
  } catch {
    // An unavailable status source is not evidence of an active deployment.
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait for the service to answer healthy, bounded by the heal budget. `get` is
// injectable so this can be driven by a local fixture without any restart.
async function verifyRecovery(deadline, fx, probe = get) {
  while (Date.now() < deadline) {
    await sleep(Math.min(HEAL_POLL_MS, Math.max(0, deadline - Date.now())));
    try {
      const health = fx && fx.health ? fx.health : await probe(`${base()}/health`);
      if (health.status === 200) {
        const body = JSON.parse(health.body || "{}");
        if (!body.status || body.status === "ok") return true;
      }
    } catch {
      // Still down; keep polling inside the budget.
    }
  }
  return false;
}

async function runCheck(name, fx, opts) {
  const condition = await (name === "sre" ? sreCondition(fx) : communityCondition(fx));
  const file = stateFile(name);
  const state = readState(file);
  if (!condition) {
    if (state.condition) {
      writeState(file, { clearedAt: new Date().toISOString() });
      emit(opts, `RESOLVED ${state.condition}`);
    } else {
      try { fs.unlinkSync(file); } catch {}
    }
    process.exit(0);
  }
  const now = Date.now();
  // A standing condition (an untriaged queue) is unchanged by definition, so it
  // uses the long floor; anything that changes notifies immediately. Without this
  // the guard is unreachable whenever the cooldown equals the tick interval.
  const sameCondition = state.condition === condition.key;
  const quietFor = now - (state.notifiedAt || 0);
  const floor = sameCondition && condition.standing ? STANDING_REMINDER_MS : COOLDOWN_MS;
  if (sameCondition && quietFor < floor) process.exit(0);
  writeState(file, {
    condition: condition.key,
    since: state.condition === condition.key ? state.since || new Date().toISOString() : new Date().toISOString(),
    notifiedAt: now,
  });
  emit(opts, condition.message);
  process.exit(condition.alert ? 1 : 0);
}
// Heal is the only autonomous action, and it runs a strict sequence:
//   1. Re-confirm the failure *now*. A saved `down` state is evidence about the
//      past, and acting on it is how a healthy service gets restarted.
//   2. Require credentials. Without them a restart cannot be attempted at all.
//   3. Require a second sample after a short backoff, so one blip is not enough.
//   4. Only true unavailability permits a restart. A malformed body, a degraded
//      ranking, or a metrics-only problem is a report, never a restart.
//   5. Respect an active deployment and the persistent per-incident budget.
//   6. Verify recovery within the budget; if it never comes back, escalate.
function readIncident(name) {
  const file = stateFile(name);
  const state = readState(file);
  const incident = state.incident && typeof state.incident === "object" ? state.incident : null;
  return {
    file,
    state,
    incident: incident
      ? {
          key: incident.key || null,
          since: incident.since || null,
          restarts: Number(incident.restarts) || 0,
          lastRestartAt: incident.lastRestartAt || null,
          lastRestartAccepted: Boolean(incident.lastRestartAccepted),
          escalated: Boolean(incident.escalated),
        }
      : null,
  };
}

function writeIncident(file, incident) {
  writeState(file, { ...readState(file), incident });
}

async function runHeal(name, opts) {
  if (name !== "sre") {
    // ponytail: no other alert is marked allowed_autonomously, so heal is a no-op.
    process.exit(0);
  }
  const { file, incident } = readIncident(name);
  // Step 1: fresh confirmation. Never act on the saved state.
  const condition = await sreCondition(loadFixture());
  if (!condition) {
    // Healthy now: clear the incident and its restart budget entirely.
    if (incident) {
      writeState(file, { clearedAt: new Date().toISOString() });
      emit(opts, "HEAL: SaucerJam is healthy; incident cleared and restart budget reset");
      process.exit(0);
    }
    process.exit(0);
  }
  if (!condition.unavailable) {
    // Degraded or malformed: visible, but a restart is not the remedy.
    logLine(name, `heal skipped: non-unavailable condition ${condition.key}`);
    emit(opts, `HEAL skipped: ${condition.message} (not a restart condition)`);
    process.exit(1);
  }
  // Step 2: credentials are required to heal at all.
  for (const variable of NAMES[name].requiredEnv)
    if (!process.env[variable]) {
      process.stdout.write(`MISSING ENV: ${variable}\n`);
      process.exit(2);
    }
  const key = condition.key;
  const current = incident && incident.key === key ? incident : { key, since: new Date().toISOString(), restarts: 0, lastRestartAt: null, lastRestartAccepted: false, escalated: false };
  if (current.restarts >= MAX_RESTARTS_PER_INCIDENT) {
    if (!current.escalated) {
      writeIncident(file, { ...current, escalated: true });
      emit(opts, `HEAL: restart budget exhausted (${current.restarts}/${MAX_RESTARTS_PER_INCIDENT}) for ${key}; escalating`);
    }
    process.exit(1);
  }
  if (current.lastRestartAt && Date.now() - Date.parse(current.lastRestartAt) < HEAL_COOLDOWN_MS) {
    emit(opts, `HEAL: cooldown active after the last restart for ${key}`);
    process.exit(1);
  }
  if (await deploymentInFlight(loadFixture())) {
    logLine(name, "heal deferred: a deployment is active");
    emit(opts, "HEAL deferred: a deployment is active for this application");
    process.exit(1);
  }
  if (opts["dry-run"]) {
    emit(opts, `HEAL dry-run: would restart SaucerJam via Coolify (incident ${key}, restart ${current.restarts + 1}/${MAX_RESTARTS_PER_INCIDENT})`);
    process.exit(0);
  }
  // Step 3: second sample after a short backoff. Both must show unavailability.
  await sleep(CONFIRM_DELAY_MS);
  const second = await sreCondition(loadFixture());
  if (!second || !second.unavailable) {
    logLine(name, "heal aborted: the second sample was not unavailable");
    emit(opts, `HEAL: not confirmed on the second sample (${second ? second.key : "healthy"}); no restart attempted`);
    process.exit(second ? 1 : 0);
  }
  const deadline = Date.now() + HEAL_BUDGET_MS;
  logLine(name, `restart requested (attempt ${current.restarts + 1}/${MAX_RESTARTS_PER_INCIDENT})`);
  const accepted = await restartSaucerJam();
  const next = { ...current, restarts: current.restarts + 1, lastRestartAt: new Date().toISOString(), lastRestartAccepted: accepted, escalated: false };
  // An accepted POST is not recovery. The budget is only cleared by an observed
  // healthy sample, so a restart that is accepted but still down stays counted.
  writeIncident(file, next);
  if (!accepted) {
    emit(opts, `HEAL: Coolify restart request failed (attempt ${next.restarts}/${MAX_RESTARTS_PER_INCIDENT})`);
    process.exit(1);
  }
  const recovered = await verifyRecovery(deadline, loadFixture());
  if (!recovered) {
    emit(opts, `HEAL: restart accepted but /health did not recover within ${Math.round(HEAL_BUDGET_MS / 1000)}s (attempt ${next.restarts}/${MAX_RESTARTS_PER_INCIDENT})`);
    process.exit(1);
  }
  writeState(file, { clearedAt: new Date().toISOString() });
  emit(opts, `HEAL: SaucerJam recovered after restart (attempt ${next.restarts}/${MAX_RESTARTS_PER_INCIDENT})`);
  process.exit(0);
}

async function main() {
  const [name, sub, ...rest] = process.argv.slice(2);
  const opts = { json: rest.includes("--json"), "dry-run": rest.includes("--dry-run") };
  if (!NAMES[name]) {
    process.stdout.write(`Unknown ops name: ${name || "(none)"}\n`);
    process.exit(2);
  }
  if (!["check", "heal"].includes(sub)) {
    process.stdout.write(`Unknown subcommand: ${sub || "(none)"}\n`);
    process.exit(2);
  }
  const fx = loadFixture();
  if (!fx && sub === "check")
    for (const variable of NAMES[name].requiredEnv)
      if (!process.env[variable]) {
        process.stdout.write(`MISSING ENV: ${variable}\n`);
        process.exit(2);
      }
  if (sub === "check") await runCheck(name, fx, opts);
  await runHeal(name, opts);
}

process.on("exit", (code) => process.stderr.write(`elapsed_ms=${Date.now() - globalThis.__started} exit=${code}\n`));
globalThis.__started = Date.now();

main().catch((error) => {
  process.stdout.write(`ops error: ${error.message}\n`);
  process.exit(1);
});
