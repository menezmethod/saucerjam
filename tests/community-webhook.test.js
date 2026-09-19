"use strict";
// A1: webhook credential verification must never throw on attacker-controlled
// input, must evaluate HMAC and bearer independently, and must fail closed
// (401, counted) rather than 500.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createGameServer } = require("../server/server");
const { verifySignature, verifyToken } = require("../server/community");

async function withWebhookServer(fn, options = {}) {
  const game = createGameServer({ tick: false, rankingsFile: null, fiderBaseUrl: "", fiderApiKey: "", ...options });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(url); } finally { await game.close(); }
}

test("verifySignature returns false (not throws) on malformed and multibyte headers", () => {
  const secret = "s3cret";
  const body = "{}";
  // 64 characters but 128 UTF-8 bytes: must not reach timingSafeEqual.
  assert.equal(verifySignature(secret, body, "é".repeat(64)), false);
  assert.equal(verifySignature(secret, body, "a".repeat(65)), false);
  assert.equal(verifySignature(secret, body, "sha256=" + "z".repeat(64)), false);
  assert.equal(verifySignature(secret, body, ""), false);
  assert.equal(verifySignature(secret, body, undefined), false);
  assert.equal(verifySignature(secret, body, null), false);
  const good = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignature(secret, body, good), true);
  assert.equal(verifySignature(secret, body, "sha256=" + good.toUpperCase()), true);
  assert.equal(verifyToken("tok", "tok"), true);
  assert.equal(verifyToken("tok", "other"), false);
});

test("webhook accepts a valid bearer token even with a bogus signature header", async () => {
  await withWebhookServer(
    async (url) => {
      const body = JSON.stringify({ post_number: 31, post_title: "[bug] crash" });
      const res = await fetch(`${url}/api/community/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer good-token", "x-fider-signature": "é".repeat(64) },
        body,
      });
      assert.equal(res.status, 202);
    },
    { fiderWebhookToken: "good-token", fiderWebhookSecret: "hmac-secret" },
  );
});

test("webhook accepts a valid HMAC even with a bogus bearer token", async () => {
  await withWebhookServer(
    async (url) => {
      const body = JSON.stringify({ post_number: 32, post_title: "[bug] crash" });
      const sig = createHmac("sha256", "hmac-secret").update(body).digest("hex");
      const res = await fetch(`${url}/api/community/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong", "x-fider-signature": sig },
        body,
      });
      assert.equal(res.status, 202);
    },
    { fiderWebhookToken: "good-token", fiderWebhookSecret: "hmac-secret" },
  );
});

test("webhook rejects a malformed signature with 401 (never 500) and counts bad_credential", async () => {
  await withWebhookServer(
    async (url) => {
      const body = JSON.stringify({ post_number: 33, post_title: "[bug] crash" });
      const res = await fetch(`${url}/api/community/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-fider-signature": "é".repeat(64) },
        body,
      });
      assert.equal(res.status, 401);
      const metrics = await (await fetch(`${url}/metrics`)).text();
      assert.match(metrics, /saucerjam_community_webhook_rejected_total\{reason="bad_credential"\} 1/);
    },
    { fiderWebhookToken: "good-token", fiderWebhookSecret: "hmac-secret" },
  );
});
