"use strict";
// Findings from the 2026-09-20 independent audits (Astra + Opus), and from Opus's
// validation of the first attempt at fixing them. Every test here must fail if
// its fix is reverted — a test that passes on the broken baseline is decoration,
// and the first version of this file had three of those.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createGameServer } = require("../server/server");
const { CommunityQueue } = require("../server/community");

const WEBHOOK_OPTS = { fiderWebhookToken: "good-token", fiderWebhookSecret: "hmac-secret" };

async function withServer(fn, options = {}) {
  const game = createGameServer({ tick: false, rankingsFile: null, fiderBaseUrl: "", fiderApiKey: "", ...options });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(url); } finally { await game.close(); }
}

function post(url, body, headers = {}, path = "/api/community/webhook") {
  return fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer good-token", ...headers },
    body,
  });
}

const bigBody = (kb) => JSON.stringify({ post_number: 88, post_title: "[bug] big", post_description: "x".repeat(kb * 1024) });

async function exhaustApiLimiter(url) {
  for (let i = 0; i < 200; i += 1) {
    if ((await fetch(`${url}/api/definitely-not-a-route`)).status === 429) return true;
  }
  return false;
}

// --- B1 / Opus CONFIRMED: a repeat delivery must not erase triage state ------

test("a replayed webhook does not reset an already-actioned item", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 13, title: "[bug] ships clip through the arena wall" });
  const receivedAt = q.get(13).receivedAt;
  q.record(13, { action: "open-fix-pr", detail: "PR #99" });
  assert.equal(q.get(13).status, "actioned");

  q.ingest({ id: 13, title: "[bug] ships clip through the arena wall" });

  const after = q.get(13);
  assert.equal(after.status, "actioned", "replay must not downgrade an actioned item back to new");
  assert.deepEqual(after.action?.action, "open-fix-pr", "replay must not erase the recorded action");
  assert.equal(after.receivedAt, receivedAt, "replay must not rewrite the first receipt time");
  assert.equal(q.list({ status: "new" }).length, 0, "an actioned item must not reappear as new work");
});

test("a replay refreshes content but does not re-derive a decision already made", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 7, title: "[bug] crash on join", votes: 3 });
  q.record(7, { action: "open-fix-pr", detail: "PR #5" });
  // The reporter edits the post after triage; the new title routes differently.
  q.ingest({ id: 7, title: "[feature] please add replays", votes: 41 });

  const item = q.get(7);
  assert.equal(item.votes, 41, "votes should still track Fider");
  assert.equal(item.title, "[feature] please add replays");
  assert.equal(item.status, "actioned", "an edit is not new work");
  assert.equal(item.proposal, "fix-pr", "the recorded action must keep describing what was acted on");
});

test("a delivery that omits fields does not blank what a richer template set", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 4, title: "[bug] x", description: "repro steps", url: "https://example.com/p/4", votes: 9 });
  // A second, leaner webhook template (the docs tell operators to add one).
  q.ingest({ id: 4, title: "[bug] x" });
  const item = q.get(4);
  assert.equal(item.description, "repro steps", "an absent description must not erase the stored one");
  assert.equal(item.url, "https://example.com/p/4");
  assert.equal(item.votes, 9);
});

test("an unrecognised id still creates a new item (the merge must not swallow all)", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 1, title: "[bug] one" });
  q.ingest({ id: 2, title: "[bug] two" });
  assert.equal(q.list().length, 2, "distinct posts must still both enqueue");
});

// --- Opus MAJOR-10 / P2: nothing post-derived reaches the worker raw ---------

test("ingest guards bidi, zero-width and control characters in every text field", () => {
  const q = new CommunityQueue();
  q.ingest({
    id: "5\u202E\u200B",
    title: "[bug] \u202Ecrash\u200B\u2066x",
    description: "body\u202Ewith\u200Bhidden",
    url: "https://example.com/\u202Eevil",
    reference: "ref\u200B",
  });
  const [item] = q.list();
  for (const [field, value] of [["id", item.id], ["title", item.title], ["description", item.description], ["url", item.url], ["reference", item.reference]]) {
    assert.ok(!/[\u202a-\u202e\u200b-\u200f\u2066-\u2069\ufeff]/.test(value), `${field} kept bidi/zero-width: ${JSON.stringify(value)}`);
  }
  assert.ok(item.title.includes("crash"), "guarding must not destroy legitimate text");
});

test("a hostile id cannot smuggle a newline or unbounded length into the queue", () => {
  const q = new CommunityQueue();
  q.ingest({ id: "7\u202E\nX" + "A".repeat(50000), title: "[bug] x" });
  const [item] = q.list();
  assert.ok(!/[\n\r]/.test(item.id), "an id must never carry a line break into a downstream artifact");
  assert.ok(item.id.length <= 40, `id must be capped, got ${item.id.length}`);
});

test("a non-integer post number is not stored as-is", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 12, number: [1, 2], title: "[bug] x" });
  assert.ok(!Array.isArray(q.get(12).number), "an array post_number must not be echoed back out");
});

test("a non-http(s) url is not handed downstream as the canonical link", () => {
  const q = new CommunityQueue();
  q.ingest({ id: 3, title: "[bug] x", url: "javascript:alert(1)" });
  assert.equal(q.get(3).url, null, "the worker pastes this link into PRs and comments");
  q.ingest({ id: 4, title: "[bug] y", url: "data:text/html,<script>" });
  assert.equal(q.get(4).url, null);
  q.ingest({ id: 5, title: "[bug] z", url: "https://community.menezmethod.com/posts/5/x" });
  assert.equal(q.get(5).url, "https://community.menezmethod.com/posts/5/x");
});

// --- Astra B3: unbounded metric cardinality from anonymous requests ----------

test("an anonymous request cannot invent a metric series", async () => {
  await withServer(async (url) => {
    await fetch(`${url}/zzq-unique-probe-path-abc123`);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    assert.ok(!metrics.includes("zzq-unique-probe-path-abc123"), "the raw request path was used as a metric label");
  });
});

test("many distinct junk paths leave no trace in the metrics", async () => {
  await withServer(async (url) => {
    const names = [];
    for (let i = 0; i < 25; i += 1) {
      const n = `junk-${i}-${Math.random().toString(36).slice(2)}`;
      names.push(n);
      await fetch(`${url}/${n}`);
    }
    const metrics = await (await fetch(`${url}/metrics`)).text();
    // Assert the junk is ABSENT. The first version of this test counted
    // route="unmatched" series, which is 0 on the unfixed build — so it passed
    // precisely when the bug was present.
    for (const n of names) assert.ok(!metrics.includes(n), `junk path ${n} was used as a metric label`);
    const junkSeries = metrics.split("\n").filter((l) => l.startsWith("saucerjam_http_requests_total") && l.includes("junk-")).length;
    assert.equal(junkSeries, 0, "no junk-derived series may exist");
  });
});

test("a rate-limited /api request still names a route for the alert annotation", async () => {
  await withServer(async (url) => {
    await exhaustApiLimiter(url);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    const limited = metrics.split("\n").filter((l) => l.startsWith("saucerjam_rate_limited_total"));
    assert.ok(limited.length > 0, "expected the limiter to have fired");
    assert.ok(limited.some((l) => l.includes('route="/api"')), `a 429 must not be labelled unknown: ${limited.join(" | ")}`);
    assert.ok(!limited.some((l) => l.includes('route="unmatched"')), "the runbook tells operators to read this label");
  });
});

// --- Opus BLOCKER-1: one non-2xx permanently disables the Fider webhook ------

test("the webhook is exempt from the shared /api limiter", async () => {
  await withServer(async (url) => {
    assert.ok(await exhaustApiLimiter(url), "the /api limiter did not engage, so this test proves nothing");
    const res = await post(url, JSON.stringify({ post_number: 77, post_title: "[bug] still arrives" }));
    assert.notEqual(res.status, 429, "the webhook was rate limited; Fider would now silently disable it");
    assert.equal(res.status, 202);
  }, WEBHOOK_OPTS);
});

// Express routes these to the SAME handler, so the exemption must not depend on
// the URL being spelled one particular way.
for (const [label, path] of [["a trailing slash", "/api/community/webhook/"], ["mixed case", "/API/Community/Webhook"]]) {
  test(`the webhook is protected when Fider is configured with ${label}`, async () => {
    await withServer(async (url) => {
      await exhaustApiLimiter(url);
      const res = await post(url, bigBody(300), {}, path);
      assert.notEqual(res.status, 429, `${path} was rate limited; Fider would now silently disable it`);
      assert.notEqual(res.status, 413, `${path} answered 413; that permanently disables the webhook`);
      assert.equal(res.status, 202);
    }, WEBHOOK_OPTS);
  });
}

test("an oversized body answers 202 rather than a parser 413", async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, bigBody(300))).status, 202, "a 413 here permanently disables the Fider webhook");
  }, WEBHOOK_OPTS);
});

test("a body under the cap is still accepted (the cap was raised, not just guarded)", async () => {
  await withServer(async (url) => {
    const res = await post(url, bigBody(100));
    assert.equal(res.status, 202);
    assert.equal((await res.json()).ok, true, "a 100kb post must be ingested, not dropped by the cap");
  }, WEBHOOK_OPTS);
});

test("a wrong bearer with no signature is rejected before the body is read", async () => {
  await withServer(async (url) => {
    // 300kb deliberately exceeds the body cap. WITH the pre-body check the
    // request is rejected on its header, the parser never runs, and this is 401.
    // WITHOUT it the parser rejects the oversized body and the route-scoped
    // handler answers 202 — which is how this test distinguishes the two. A
    // small body could not: the main handler also returns 401 when both
    // credentials fail, so the earlier 100kb version passed with and without the
    // middleware and was killed only by an unrelated cap change.
    const res = await post(url, bigBody(300), { authorization: "Bearer wrong-token" });
    assert.equal(res.status, 401, "a wrong bearer must be rejected before the body is buffered");
  }, WEBHOOK_OPTS);
});

test("the webhook meter drops with a counted 202 and never answers 429", async () => {
  await withServer(async (url) => {
    // The meter is the only thing bounding how much body an anonymous caller can
    // make this process buffer, on the one route that must never answer 429.
    // Deleting the middleware used to leave the entire suite green.
    let sawDropped = false;
    for (let i = 0; i < 640 && !sawDropped; i += 1) {
      const res = await post(url, JSON.stringify({ post_number: 900 + i, post_title: `[bug] flood ${i}` }));
      assert.notEqual(res.status, 429, "the webhook answered 429; Fider would permanently disable it");
      if (res.status === 202 && (await res.json()).ok === false) sawDropped = true;
    }
    assert.ok(sawDropped, "the webhook meter never engaged, so nothing bounds anonymous ingress");
    const metrics = await (await fetch(`${url}/metrics`)).text();
    assert.match(metrics, /saucerjam_community_webhook_rejected_total\{reason="rate_limited"\} [1-9]/, "a dropped delivery must be counted");
    assert.ok(!/status="429"/.test(metrics), "the webhook must never answer 429");
  }, WEBHOOK_OPTS);
});

test("a valid HMAC still opens the gate when the bearer is wrong (independent evaluation)", async () => {
  await withServer(async (url) => {
    const body = JSON.stringify({ post_number: 91, post_title: "[bug] hmac path" });
    const sig = createHmac("sha256", "hmac-secret").update(body).digest("hex");
    const res = await post(url, body, { authorization: "Bearer wrong-token", "x-fider-signature": sig });
    assert.equal(res.status, 202, "a valid signature must not be discarded because the bearer was wrong");
    assert.equal((await res.json()).ok, true);
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
    assert.equal(Number(line.trim().split(" ").pop()), 1, "two identical deliveries are one item");
  }, WEBHOOK_OPTS);
});

test("a replayed hostile id does not double-count either", async () => {
  await withServer(async (url) => {
    // ingest() stores under the guarded id, so the replay check has to look up
    // the GUARDED id too. It looked up the raw one, so any id that guarding
    // changes counted as a brand-new item on every delivery.
    const body = JSON.stringify({ post_id: "7\u202E\u200B", post_title: "[bug] guarded id" });
    await post(url, body);
    await post(url, body);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    const line = metrics.split("\n").find((l) => l.startsWith("saucerjam_community_ingest_total"));
    assert.equal(Number(line.trim().split(" ").pop()), 1, "the guarded id must match on replay too");
  }, WEBHOOK_OPTS);
});

// --- Opus P4: unescaped labels poison the whole scrape -----------------------

test("an anonymous insights payload cannot emit an invalid exposition line", async () => {
  await withServer(async (url) => {
    await fetch(`${url}/api/insights`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: ["landing_view"], device: 'a"b', platform: "x\\" }),
    });
    const metrics = await (await fetch(`${url}/metrics`)).text();
    const lines = metrics.split("\n").filter((l) => l.startsWith("insight_events_total"));
    assert.ok(lines.length > 0, "expected the insight to be recorded");
    // Prometheus rejects the entire scrape on one malformed line, so every label
    // value must be escaped.
    for (const l of lines) {
      assert.match(l, /^insight_events_total\{event="(?:[^"\\]|\\.)*",device="(?:[^"\\]|\\.)*",platform="(?:[^"\\]|\\.)*"\} \d+$/, `invalid exposition line: ${l}`);
    }
  });
});

test("the insight series cap bounds the map regardless of the rate limiter", () => {
  // Deliberately a unit test, not an HTTP one. /api/insights sits behind the
  // shared /api limiter at 120/min, so an HTTP test can never create enough
  // series to reach the cap — it passed with and without the fix, which makes it
  // decoration. The cap still matters in production because the limiter window
  // resets every minute and this map lives for the life of the process.
  const { Insights } = require("../server/insights");
  const insights = new Insights();
  for (let i = 0; i < 2000; i += 1) insights.track({ event: "landing_view", device: `d${i}`, platform: `p${i}` });
  assert.ok(insights.counts.size <= 205, `series cap not enforced: ${insights.counts.size} series`);
});
