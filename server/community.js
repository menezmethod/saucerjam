// Community intake: Fider webhook -> signed queue -> AI triage actions.
// The AI (Hermes) reads GET /api/community/queue and acts through POST
// /api/community/claim and /api/community/action. Nothing here auto-merges:
// every proposal must clear a maintainer/community gate (docs/AUTOMATION.md).
//
// This file is the compatibility surface. The implementation lives in:
//   community-core.js  - vocabulary and text guarding, no I/O
//   community-queue.js - the durable journal, leases, attempts, receipts
//   community-fider.js - the read-only Fider reconciliation client
// Everything exported here is re-exported unchanged so existing callers,
// tests, and ops scripts keep working.
const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { clean, formatQueueDetail, guardPublicText, propose } = require("./community-core");
const { CommunityQueue, TERMINAL_STATUSES, WORKING_STATUSES, isTerminalStatus, normalizeError, sourceTime } = require("./community-queue");

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


module.exports = {
  CommunityQueue,
  TERMINAL_STATUSES,
  WORKING_STATUSES,
  clean,
  formatQueueDetail,
  guardPublicText,
  isTerminalStatus,
  normalizeError,
  propose,
  sourceTime,
  verifySignature,
  verifyToken,
};
