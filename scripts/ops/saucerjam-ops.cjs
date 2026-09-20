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
  if (health.status !== 200) return { key: "down", alert: true, message: `SaucerJamDown: /health returned ${health.status}` };
  const metrics = fx ? fx.metrics : await get(`${base()}/metrics`);
  if (metrics.status !== 200 || !String(metrics.body || "").includes("saucerjam_rooms"))
    return { key: "metrics_missing", alert: true, message: `SaucerJamDown: /metrics missing saucerjam_rooms (status ${metrics.status})` };
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
  return { key: `queue:${items.map((item) => item.id).join(",")}`, alert: false, message: formatQueueMessage(items) };
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
  const attempt = () =>
    fetch(`${url}/api/v1/applications/${APP_UUID}/restart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.COOLIFY_TOKEN || ""}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).then((res) => res.ok);
  if (await attempt()) return true;
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  return attempt();
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
  if (state.condition === condition.key && now - (state.notifiedAt || 0) < COOLDOWN_MS) process.exit(0);
  writeState(file, {
    condition: condition.key,
    since: state.condition === condition.key ? state.since || new Date().toISOString() : new Date().toISOString(),
    notifiedAt: now,
  });
  emit(opts, condition.message);
  process.exit(condition.alert ? 1 : 0);
}

async function runHeal(name, opts) {
  const file = stateFile(name);
  const state = readState(file);
  if (name === "sre" && state.condition === "down") {
    if (opts["dry-run"]) {
      emit(opts, "HEAL dry-run: would restart SaucerJam via Coolify");
      process.exit(0);
    }
    logLine(name, "restart requested");
    if (await restartSaucerJam()) {
      try { fs.unlinkSync(file); } catch {}
      emit(opts, "HEAL: requested SaucerJam restart via Coolify");
      process.exit(0);
    }
    logLine(name, "restart failed after one retry");
    emit(opts, "HEAL: Coolify restart failed after one retry");
    process.exit(1);
  }
  // ponytail: no other alert is marked allowed_autonomously, so heal is a no-op.
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
