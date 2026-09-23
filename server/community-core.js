// Shared community vocabulary and text guarding. Kept free of node:fs so the
// Fider client (`community-fider.js`) and the durable journal
// (`community-queue.js`) can both depend on it, and so the Fider integration
// stays the only place that talks to the network.
//
// A7: any string derived from a Fider post that reaches an alert, a log line,
// or a public artifact must be neutralised first. This stops a post title from
// being a prompt-injection or terminal-escape vector.
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

const clean = (v, limit) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, limit) : "");

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

// Deterministic proposals from a triaged item. The AI writes the analysis;
// this only decides what *kind* of action is even allowed.
function propose({ kind, title = "" }) {
  const text = `${kind} ${title}`.toLowerCase();
  if (kind === "bug" || /\b(crash|broken|error|bug|regression|freeze|stuck)\b/.test(text)) return "fix-pr";
  if (kind === "balance" || /\b(damage|energy|nerf|buff|speed|too fast|too slow)\b/.test(text)) return "matchmaking-proposal";
  if (kind === "feature" || /\b(add|idea|suggest|feature|would be|request)\b/.test(text)) return "prototype-pr";
  return "discuss";
}

module.exports = { clean, formatQueueDetail, guardPublicText, propose };
