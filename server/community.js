// Community intake: Fider webhook -> signed queue -> AI triage actions.
// The AI (Hermes) reads GET /api/community/queue and acts through the
// restricted POST /api/community/action surface. Nothing here auto-merges:
// every proposal must clear a maintainer/community gate (see docs/AUTOMATION.md).
const { createHash, createHmac, timingSafeEqual, randomBytes } = require("node:crypto");

const clean = (v, limit) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, limit) : "");

// A7: any string derived from a Fider post that reaches an alert, a log line,
// or a public artifact must be neutralised first. The order matters: NFKC
// normalise, remove terminal escape sequences, strip control/bidi/zero-width
// formatting, collapse whitespace, then cap by code points. This stops a post
// title from being a prompt-injection or terminal-escape vector.
// Control whitespace becomes a space so words are not glued together; the
// remaining control/bidi/zero-width characters are deleted.
const CONTROL_WHITESPACE = /[\t\n\v\f\r]/g;
const FORBIDDEN = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

function guardPublicText(value, { limit = 200 } = {}) {
  if (typeof value !== "string") return "";
  return Array.from(
    value
      .normalize("NFKC")
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences (SGR colours)
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)?/g, "") // OSC sequences
      .replace(/\u001b[@-Z\\-_]/g, "") // other two-character escapes
      .replace(CONTROL_WHITESPACE, " ")
      .replace(FORBIDDEN, "")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, Math.max(0, limit)).join("");
}

// The queue-detail formatter echoes post identity, title, body, and URL into a
// single guarded line for the ops alert path.
function formatQueueDetail(item = {}, { limit = 200 } = {}) {
  const id = guardPublicText(String(item.id ?? item.key ?? item.number ?? "?"), { limit: 40 });
  const title = guardPublicText(item.title, { limit });
  const body = guardPublicText(item.description ?? item.body, { limit });
  const url = guardPublicText(item.url, { limit });
  const parts = [`#${id}`];
  if (title) parts.push(`"${title}"`);
  if (body) parts.push(`- ${body}`);
  if (url) parts.push(`(${url})`);
  return parts.join(" ");
}

// Hex shape gate: only 64 hex characters (32 bytes) can be a sha256 digest.
// Validating the shape *before* comparing means attacker-controlled non-ASCII
// input (e.g. "é".repeat(64), 128 UTF-8 bytes) returns false instead of making
// timingSafeEqual throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH. Shape failures
// return false; genuine internal errors (bad secret type, crypto failure)
// propagate so the request handler can fail closed and count them.
const SHA256_HEX = /^[0-9a-f]{64}$/;

function verifySignature(secret, rawBody, header) {
  if (!secret || typeof header !== "string") return false;
  const provided = header.replace(/^sha256=/i, "").trim().toLowerCase();
  if (!SHA256_HEX.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(provided, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}

// Shared-secret bearer token for senders that cannot produce an HMAC (Fider
// only emits X-Fider-UserID). Both sides are hashed to a fixed 32-byte digest
// before comparison so timingSafeEqual never sees mismatched lengths.
function verifyToken(expected, header) {
  if (!expected || typeof header !== "string" || !header) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(header).digest();
  return timingSafeEqual(a, b);
}

// Deterministic proposals from a triaged item. The AI writes the analysis;
// this only decides what *kind* of action is even allowed.
function propose({ kind, title = "" }) {
  const text = `${kind} ${title}`.toLowerCase();
  if (kind === "bug" || /\b(crash|broken|error|bug|regression|freeze|stuck)\b/.test(text)) return "fix-pr";
  if (kind === "balance" || /\b(damage|energy|nerf|buff|speed|too fast|too slow)\b/.test(text)) return "matchmaking-proposal";
  if (kind === "feature" || /\b(add|idea|suggest|feature|would be|request)\b/.test(text)) return "prototype-pr";
  return "discuss";
}

class CommunityQueue {
  constructor({ maxItems = 500 } = {}) {
    this.items = new Map();
    this.maxItems = maxItems;
  }
  ingest(post = {}) {
    // The id becomes a Map key, is echoed in the 202 body, and is pasted into
    // PRs and comments by the worker, so it is guarded and capped like any
    // other post-derived string rather than trusted to be a small number.
    const id = guardPublicText(String(post.id ?? post.number ?? ""), { limit: 40 });
    if (!id) return null;
    const title = guardPublicText(post.title, { limit: 200 });
    if (!title) return null;
    const kind =
      (typeof post.kind === "string" && ["bug", "feature", "balance", "question"].includes(post.kind) && post.kind) ||
      (() => {
        const match = title.match(/^\[(bug|feature|balance|question)\]/i);
        return match ? match[1].toLowerCase() : "question";
      })();
    const description = guardPublicText(post.description, { limit: 4000 });
    // Guarding neutralises the text; it does not make the link safe to use. The
    // worker pastes this into PRs and comments as the canonical link to a
    // report, so only http(s) survives — a `javascript:` or `data:` URL must
    // never be handed downstream.
    const rawUrl = guardPublicText(post.url, { limit: 400 });
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    const reference = guardPublicText(post.reference, { limit: 120 }) || null;
    const votes = Number.isFinite(Number(post.votes)) ? Number(post.votes) : 0;
    // Only a real post number is meaningful. `[1,2]` or an object would be
    // stored and echoed straight back out to the worker.
    const number = Number.isInteger(post.number) ? post.number : null;
    // A repeat delivery is a retry or a status-change webhook, not new work.
    // Replacing the entry would erase the action record and hand an already
    // triaged post back to the worker as though nobody had seen it, so merge
    // into what we already hold and keep status, action and first receipt.
    const prev = this.items.get(id);
    if (prev) {
      // Overwrite only with what this delivery actually carried. A second,
      // leaner webhook template (docs/AUTOMATION.md tells the operator to add
      // one) must not blank out fields the richer template populated.
      prev.title = title;
      if (description) prev.description = description;
      if (url) prev.url = url;
      if (reference) prev.reference = reference;
      if (Number.isFinite(Number(post.votes))) prev.votes = votes;
      if (number !== null) prev.number = number;
      // Re-derive routing only while nothing has been decided for this item.
      if (prev.status === "new") {
        prev.kind = kind;
        prev.proposal = propose({ kind, title });
      }
      return prev;
    }
    const item = {
      id,
      number,
      title,
      kind,
      description,
      url,
      reference,
      votes,
      status: "new",
      proposal: propose({ kind, title }),
      receivedAt: new Date().toISOString(),
      action: null,
    };
    this.items.set(id, item);
    // Bound memory: drop oldest by insertion order.
    while (this.items.size > this.maxItems) this.items.delete(this.items.keys().next().value);
    return item;
  }
  list({ status } = {}) {
    return [...this.items.values()].filter((i) => !status || i.status === status);
  }
  get(id) { return this.items.get(String(id)) || null; }
  record(id, action) {
    const item = this.items.get(String(id));
    if (!item) return null;
    item.status = "actioned";
    item.action = { ...action, at: new Date().toISOString() };
    return item;
  }
  // Gate: an AI action may open a PR/branch, never merge or close a post.
  static allowedActions() { return ["open-fix-pr", "open-prototype-pr", "comment", "flag-duplicate", "request-info"]; }
}

module.exports = { CommunityQueue, verifySignature, verifyToken, propose, clean, guardPublicText, formatQueueDetail };
