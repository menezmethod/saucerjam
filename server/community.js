// Community intake: Fider webhook -> signed queue -> AI triage actions.
// The AI (Hermes) reads GET /api/community/queue and acts through the
// restricted POST /api/community/action surface. Nothing here auto-merges:
// every proposal must clear a maintainer/community gate (see docs/AUTOMATION.md).
const { createHmac, timingSafeEqual, randomBytes } = require("node:crypto");

const clean = (v, limit) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, limit) : "");

function verifySignature(secret, rawBody, header) {
  if (!secret || typeof header !== "string") return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = header.replace(/^sha256=/i, "").trim();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
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
    const id = String(post.id ?? post.number ?? "");
    if (!id) return null;
    const title = clean(post.title, 200);
    if (!title) return null;
    const kind =
      (typeof post.kind === "string" && ["bug", "feature", "balance", "question"].includes(post.kind) && post.kind) ||
      (() => {
        const match = title.match(/^\[(bug|feature|balance|question)\]/i);
        return match ? match[1].toLowerCase() : "question";
      })();
    const item = {
      id,
      number: post.number ?? null,
      title,
      kind,
      description: clean(post.description, 4000),
      url: clean(post.url, 400) || null,
      reference: clean(post.reference, 120) || null,
      votes: Number.isFinite(Number(post.votes)) ? Number(post.votes) : 0,
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

module.exports = { CommunityQueue, verifySignature, propose, clean };
