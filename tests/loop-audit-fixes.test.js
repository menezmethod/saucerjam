"use strict";
// Findings from the 2026-09-20 independent audits (Astra + Opus). Each test
// below fails if its corresponding fix is reverted — the point is to make these
// specific regressions impossible to reintroduce silently, not to raise the
// pass count.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGameServer } = require("../server/server");
const { CommunityQueue } = require("../server/community");

const WEBHOOK_OPTS = { fiderWebhookToken: "good-token", fiderWebhookSecret: "hmac-secret" };

async function withServer(fn, options = {}) {
  const game = createGameServer({ tick: false, rankingsFile: null, fiderBaseUrl: "", fiderApiKey: "", ...options });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(url); } finally { await game.close(); }
}

function post(url, body, headers = {}) {
  return fetch(`${url}/api/community/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good-token", ...headers },
    body,
  });
}

// --- B1 / Opus CONFIRMED: a repeat delivery must not erase triage state ------

test("a replayed webhook does not reset an already-actioned item", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 13, title: "[bug] ships clip through the arena wall" });
  const first = q.get(13);
  const receivedAt = first.receivedAt;
  q.record(13, { action: "open-fix-pr", detail: "PR #99" });
  assert.equal(q.get(13).status, "actioned");

  // The same post delivered again — this is what the change_status webhook does.
  q.ingest({ id: 13, title: "[bug] ships clip through the arena wall" });

  const after = q.get(13);
  assert.equal(after.status, "actioned", "replay must not downgrade an actioned item back to new");
  assert.deepEqual(after.action?.action, "open-fix-pr", "replay must not erase the recorded action");
  assert.equal(after.receivedAt, receivedAt, "replay must not rewrite the first receipt time");
  assert.equal(q.list({ status: "new" }).length, 0, "an actioned item must not reappear as new work");
});

test("a replay still refreshes mutable content without touching decisions", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 7, title: "[feature] add replays", votes: 3 });
  q.record(7, { action: "open-prototype-pr", detail: "branch" });
  q.ingest({ id: 7, title: "[feature] add replays", votes: 41, description: "now with detail" });

  const item = q.get(7);
  assert.equal(item.votes, 41, "votes should track Fider");
  assert.equal(item.description, "now with detail");
  assert.equal(item.status, "actioned");
  assert.equal(item.proposal, "prototype-pr", "a routing decision already acted on is not re-derived");
});

test("an unrecognised id still creates a new item (replay fix is not a swallow-all)", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 1, title: "[bug] one" });
  assert.equal(q.list().length, 1);
  q.ingest({ id: 2, title: "[bug] two" });
  assert.equal(q.list().length, 2, "distinct posts must still both enqueue");
});

// --- Opus MAJOR-10: the queue path pasted into PRs/comments was unguarded ----

test("ingest strips bidi overrides and zero-width characters from title and body", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 5, title: "[bug] \u202Ecrash\u200B\u2066x", description: "body\u202Ewith\u200Bhidden" });
  const item = q.get(5);
  for (const [field, value] of [["title", item.title], ["description", item.description]]) {
    assert.ok(!/[\u202a-\u202e\u200b-\u200f\u2066-\u2069]/.test(value), `${field} kept bidi/zero-width: ${JSON.stringify(value)}`);
  }
  assert.ok(item.title.includes("crash"), "guarding must not destroy legitimate text");
});

test("list() returns nothing that could forge a line in a downstream artifact", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 9, title: "[bug] x\r\nRESOLVED queue:1" });
  const [item] = q.list();
  assert.ok(!/\n|\r/.test(item.title), "a CR/LF in a title must never survive into the queue");
});

// --- Astra B3: unbounded metric cardinality from anonymous requests ----------

test("an unmatched path does not become its own metric label", async () => {
  await withServer(async (url) => {
    const probe = "/zzq-unique-probe-path-abc123";
    const res = await fetch(`${url}${probe}`);
    assert.equal(res.status, 404);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    assert.ok(!metrics.includes("zzq-unique-probe-path-abc123"), "the raw request path was used as a metric label");
    assert.ok(metrics.includes('route="unmatched"'), "unmatched requests should collapse into one bounded label");
  });
});

test("many distinct unmatched paths do not multiply metric series", async () => {
  await withServer(async (url) => {
    for (let i = 0; i < 25; i += 1) await fetch(`${url}/junk-${i}-${Math.random().toString(36).slice(2)}`);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    const unmatched = metrics.split("\n").filter((l) => l.includes('route="unmatched"') && l.startsWith("saucerjam_http_requests_total")).length;
    assert.ok(unmatched <= 6, `expected a bounded number of unmatched series, saw ${unmatched}`);
  });
});

// --- Opus BLOCKER-1: one non-2xx permanently disables the Fider webhook ------

test("the webhook is exempt from the shared /api rate limiter", async () => {
  await withServer(async (url) => {
    // Exhaust the bucket on a normal API path and prove the limiter is live.
    let sawLimit = false;
    for (let i = 0; i < 200 && !sawLimit; i += 1) {
      const r = await fetch(`${url}/api/definitely-not-a-route`);
      if (r.status === 429) sawLimit = true;
    }
    assert.ok(sawLimit, "the /api limiter did not engage, so this test proves nothing");

    // With the bucket exhausted the webhook must still be accepted: a 429 here
    // makes Fider disable the webhook permanently and drop every future report.
    const res = await post(url, JSON.stringify({ post_number: 77, post_title: "[bug] still arrives" }));
    assert.notEqual(res.status, 429, "the webhook was rate limited; Fider would now silently disable it");
    assert.equal(res.status, 202);
  }, WEBHOOK_OPTS);
});

test("an oversized body answers 202 rather than a parser 413", async () => {
  await withServer(async (url) => {
    // Fider caps a title at 100 chars but not the description, so a pasted log
    // can exceed the raw-body limit. The parser rejects before the handler runs,
    // so the handler's "always answer 2xx" protection cannot cover this path.
    const huge = JSON.stringify({ post_number: 88, post_title: "[bug] big", post_description: "x".repeat(600 * 1024) });
    const res = await post(url, huge);
    assert.equal(res.status, 202, "a 413 here permanently disables the Fider webhook");
  }, WEBHOOK_OPTS);
});

// --- Opus MINOR-1: the ingest counter counted deliveries, not items ----------

test("a replayed delivery does not inflate the ingest counter", async () => {
  await withServer(async (url) => {
    const body = JSON.stringify({ post_number: 64, post_title: "[bug] counted once" });
    await post(url, body);
    await post(url, body);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    const line = metrics.split("\n").find((l) => l.startsWith("saucerjam_community_ingest_total"));
    const value = Number(line.trim().split(" ").pop());
    assert.equal(value, 1, `expected one ingested item for two identical deliveries, got ${value}`);
  }, WEBHOOK_OPTS);
});
