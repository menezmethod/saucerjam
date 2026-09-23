"use strict";
// Phase-1 acceptance for the recoverable intake and truthful recovery bundle.
//
// Every test here must fail if its guarantee is removed. The journal is driven
// from temporary state files and local fixtures; no test touches Fider, Coolify,
// GitHub, or any production service.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createGameServer } = require("../server/server");
const { CommunityQueue } = require("../server/community-queue");
const { FiderReconciler } = require("../server/community-fider");

const OPS = path.join(__dirname, "..", "scripts", "ops", "saucerjam-ops.cjs");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-durability-"));
const statePath = (dir, name = "community.json") => path.join(dir, name);

async function withServer(fn, options = {}) {
  const game = createGameServer({ tick: false, rankingsFile: null, fiderBaseUrl: "", fiderApiKey: "", ...options });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try {
    await fn(url, game);
  } finally {
    await game.close();
  }
}

const api = (url, route, options = {}) =>
  fetch(`${url}${route}`, {
    ...options,
    headers: { "content-type": "application/json", "x-community-token": "tok", ...(options.headers || {}) },
  });

const claim = (url, workerId = "hermes") => api(url, "/api/community/claim", { method: "POST", body: JSON.stringify({ workerId }) });
const complete = (url, body) => api(url, "/api/community/action", { method: "POST", body: JSON.stringify(body) });
const webhook = (url, body, token = "hook") =>
  fetch(`${url}/api/community/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

// --- durable state ----------------------------------------------------------

test("the durable journal survives a restart with attempts, lease and receipts intact", () => {
  const dir = tmpDir();
  const file = statePath(dir);
  const first = new CommunityQueue({ stateFile: file });
  first.ingest({ number: 11, title: "[bug] catcher", description: "body", createdAt: "2026-09-20T00:00:00Z" });
  assert.equal(first.claim({ workerId: "w1" }).status, "claimed");

  const second = new CommunityQueue({ stateFile: file });
  const item = second.get("11");
  assert.equal(item.status, "in_progress", "a restart must not reset in-flight work");
  assert.ok(item.lease, "the lease must survive the restart");
  assert.equal(item.sourceUpdatedAt, "2026-09-20T00:00:00.000Z", "Fider createdAt is preserved");
  assert.equal(second.claim({ workerId: "w2" }).status, "empty", "a leased item must not be handed to a second worker");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a state file is written atomically and leaves no temp file behind", () => {
  const dir = tmpDir();
  const queue = new CommunityQueue({ stateFile: statePath(dir) });
  queue.ingest({ number: 5, title: "[bug] atomic" });
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(statePath(dir), "utf8")), "the stored document is complete JSON");
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), [], "no temp file survives a successful rename");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a corrupt store fails closed, reports nonhealthy, and is never replaced with empty state", () => {
  const dir = tmpDir();
  const file = statePath(dir);
  const corrupted = '{"version":1,"items":[{"key":"1","title":"broken"';
  fs.writeFileSync(file, corrupted);
  const queue = new CommunityQueue({ stateFile: file });
  assert.equal(queue.status().healthy, false, "a corrupt store must not look healthy");
  assert.match(queue.status().loadError, /corrupt/, "loadError must name the corruption");
  assert.equal(queue.claim({ workerId: "w" }).status, "unavailable", "a corrupt store must not hand out work");
  assert.equal(queue.write(), false, "a corrupt store must refuse to write");
  assert.equal(fs.readFileSync(file, "utf8"), corrupted, "the operator's file is left for repair, not overwritten");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a store whose shape is wrong is rejected rather than adopted as empty", () => {
  const dir = tmpDir();
  const file = statePath(dir);
  fs.writeFileSync(file, JSON.stringify({ version: 99, items: [] }));
  assert.equal(new CommunityQueue({ stateFile: file }).status().loadError, "corrupt:unrecognized_schema");
  fs.writeFileSync(file, JSON.stringify({ version: 1, items: [{ title: "no key" }] }));
  assert.equal(new CommunityQueue({ stateFile: file }).status().healthy, false, "a record that cannot be rehydrated must not be silently dropped");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an unwritable state file is surfaced and refuses to hand out a lease", () => {
  const dir = tmpDir();
  // Make the state path a directory: reading it fails and the atomic rename can
  // never replace it, which is the real "cannot persist" condition.
  const file = path.join(dir, "community.json");
  fs.mkdirSync(file, { recursive: true });
  const queue = new CommunityQueue({ stateFile: file });
  queue.ingest({ number: 3, title: "[bug] in memory only" });
  const claimed = queue.claim({ workerId: "w" });
  assert.equal(claimed.status, "unavailable", "a lease that cannot be persisted must not be issued");
  assert.equal(queue.status().healthy, false, "an unusable store must not look healthy");
  assert.match(queue.status().loadError || "", /unreadable/, "the store failure must be visible");
  assert.equal(queue.get("3").lease, null, "the refused claim must not leave a lease behind");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reaching capacity refuses new intake instead of evicting unfinished work", () => {
  const dir = tmpDir();
  const queue = new CommunityQueue({ stateFile: statePath(dir), maxItems: 3 });
  for (const number of [1, 2, 3]) queue.ingest({ number, title: `[bug] ${number}` });
  assert.equal(queue.ingest({ number: 4, title: "[bug] four" }), null, "intake past capacity must be refused, not accepted and evicted");
  assert.equal(queue.status().capacityReached, true, "capacity pressure must be visible");
  for (const number of [1, 2, 3]) assert.ok(queue.get(number), `item ${number} must still be held`);
  queue.reconcile([{ number: 1, title: "[bug] 1", status: "completed", createdAt: "2026-09-20T00:00:00Z" }]);
  assert.ok(queue.ingest({ number: 4, title: "[bug] four" }), "intake must resume once there is room");
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- claims, leases, attempts ----------------------------------------------

test("concurrent claims never return the same item", () => {
  const queue = new CommunityQueue();
  for (let number = 1; number <= 4; number += 1) queue.ingest({ number, title: `[bug] ${number}` });
  const seen = new Set();
  for (let i = 0; i < 4; i += 1) {
    const claimed = queue.claim({ workerId: `w${i}` });
    assert.equal(claimed.status, "claimed");
    assert.ok(!seen.has(claimed.item.key), `item ${claimed.item.key} was handed out twice`);
    seen.add(claimed.item.key);
  }
  assert.equal(queue.claim({ workerId: "w9" }).status, "empty", "no item may be claimed twice");
});

test("claim answers cheaply with no lease when there is no work", async () => {
  await withServer(async (url) => {
    const res = await claim(url);
    assert.equal(res.status, 200, "no work is a cheap 200, not an error");
    const body = await res.json();
    assert.equal(body.item, null);
    assert.equal(body.leaseToken, undefined, "no work must not mint a lease");
  }, { communityActionToken: "tok" });
});

test("three real attempts exhaust to dead_letter with growing backoff", () => {
  const queue = new CommunityQueue();
  // A controllable clock: the retry deadline is a wall-clock condition, so the
  // harness advances time rather than sleeping through the backoff.
  let clock = Date.parse("2026-09-22T00:00:00Z");
  queue.now = () => clock;
  queue.retryBaseMs = 10_000;
  queue.retryCapMs = 300_000;
  queue.ingest({ number: 8, title: "[bug] fails" });
  const gaps = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const claimed = queue.claim({ workerId: "w" });
    assert.equal(claimed.status, "claimed", `attempt ${attempt + 1} must be claimable`);
    assert.equal(claimed.attempt, attempt + 1);
    queue.record("8", "fail", {});
    const item = queue.get("8");
    if (item.nextAttemptAt) {
      gaps.push(Date.parse(item.nextAttemptAt) - clock);
      assert.equal(queue.isClaimable(item, clock + gaps[gaps.length - 1] - 1), false, "the item must not be claimable before its backoff expires");
      // Jump past the backoff and try again.
      clock += gaps[gaps.length - 1] + 1;
    }
  }
  const item = queue.get("8");
  assert.equal(item.status, "dead_letter", "the fourth attempt must not be offered");
  assert.equal(item.attempts.length, 3, "exactly three attempts are recorded");
  assert.match(item.deadLetterReason, /attempts_exhausted:3/);
  assert.equal(queue.claim({ workerId: "w" }).status, "empty", "a dead-lettered item is not claimable");
  assert.ok(gaps.every((gap) => gap > 0), `every retry must be delayed: ${JSON.stringify(gaps)}`);
  assert.ok(gaps[1] > gaps[0], `backoff must grow: ${JSON.stringify(gaps)}`);
});

test("an expired lease counts as a failed attempt and returns the item", async () => {
  const queue = new CommunityQueue();
  let clock = Date.parse("2026-09-22T00:00:00Z");
  queue.now = () => clock;
  queue.leaseTtlMs = 60_000;
  queue.retryBaseMs = 1_000;
  queue.ingest({ number: 6, title: "[bug] abandoned" });
  assert.equal(queue.claim({ workerId: "w" }).status, "claimed");
  // The worker never comes back. The next claim after the TTL observes the
  // expiry, and the claim after that (once the backoff has passed) gets the item.
  clock += 61_000;
  assert.equal(queue.claim({ workerId: "w" }).status, "empty", "the expiry re-queues the item behind its backoff");
  const item = queue.get("6");
  assert.equal(item.attempts.length, 1, "the abandoned attempt is counted");
  assert.equal(item.attempts[0].outcome, "lease_expired");
  assert.equal(item.status, "new", "the item returns to the queue, not to a terminal state");
  clock += 60_000;
  assert.equal(queue.claim({ workerId: "w" }).status, "claimed", "the abandoned item must come back");
});

test("an item that exhausts its attempts on an expired lease is still dead-lettered", () => {
  const queue = new CommunityQueue();
  let clock = Date.parse("2026-09-22T00:00:00Z");
  queue.now = () => clock;
  queue.leaseTtlMs = 1_000;
  queue.retryBaseMs = 1_000;
  queue.ingest({ number: 7, title: "[bug] never returns" });
  // Three abandoned leases. Each pass jumps past the previous backoff window, so
  // the item is genuinely claimable again before the next expiry.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clock += 20_000;
    assert.equal(queue.claim({ workerId: "w" }).status, "claimed", `attempt ${attempt + 1} must be offered`);
    clock += 20_000;
    // Claiming again after the expiry is what records the failed attempt.
    queue.claim({ workerId: "w" });
  }
  const item = queue.get("7");
  assert.equal(item.status, "dead_letter", "three abandoned leases exhaust the budget");
  assert.equal(item.attempts.length, 3);
  assert.equal(item.attempts.filter((a) => a.outcome === "lease_expired").length, 3);
  assert.match(item.deadLetterReason, /attempts_exhausted:3/);
  assert.equal(queue.claim({ workerId: "w" }).status, "empty");
});

// --- completion, conflicts, idempotency ------------------------------------

test("an exact completion replay is accepted and adds no second receipt", async () => {
  await withServer(
    async (url) => {
      assert.equal((await webhook(url, { post_number: 12, post_title: "[bug] replay" })).status, 202);
      const claimed = await (await claim(url)).json();
      assert.equal(claimed.item.number, 12);
      const body = { id: "12", action: "open-fix-pr", detail: "https://github.com/menezmethod/saucerjam/pull/7", leaseToken: claimed.leaseToken, inputHash: claimed.inputHash };
      const first = await complete(url, body);
      assert.equal(first.status, 200);
      const firstItem = (await first.json()).item;
      const second = await complete(url, body);
      assert.equal(second.status, 200, "an identical replay is not an error");
      assert.equal((await second.json()).item.actions.length, firstItem.actions.length, "a replay must not add a second receipt");
      assert.equal(firstItem.status, "actioned", "a PR receipt is actioned, not done");
    },
    { communityActionToken: "tok", fiderWebhookToken: "hook" },
  );
});

test("a stale lease is refused after the reporter edits the post", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 21, title: "[bug] before the edit", description: "original" });
  const claimed = queue.claim({ workerId: "w" });
  queue.reconcile([{ number: 21, title: "[bug] after the edit", description: "changed", status: "open", createdAt: "2026-09-20T00:00:00Z" }]);
  assert.equal(
    queue.complete({ id: "21", action: "actioned", leaseToken: claimed.leaseToken, inputHash: claimed.inputHash }).status,
    "stale_input",
    "work derived from superseded content must not complete",
  );
});

test("a completion with a wrong or missing lease is refused", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 30, title: "[bug] guarded" });
  const claimed = queue.claim({ workerId: "w" });
  assert.equal(queue.complete({ id: "30", action: "actioned", leaseToken: "not-the-token", inputHash: claimed.inputHash }).status, "bad_lease");
  assert.equal(queue.complete({ id: "30", action: "actioned", inputHash: claimed.inputHash }).status, "no_lease");
  assert.equal(queue.complete({ id: "30", action: "actioned", leaseToken: claimed.leaseToken }).status, "accepted");
});

test("a completion against a consumed lease conflicts", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 31, title: "[bug] consumed" });
  const claimed = queue.claim({ workerId: "w" });
  queue.record("31", "actioned", {});
  assert.equal(queue.complete({ id: "31", action: "request_info", leaseToken: claimed.leaseToken }).status, "no_lease");
});

test("request-info parks the item instead of reporting it actioned", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 33, title: "[question] how do I aim" });
  assert.equal(queue.claim({ workerId: "w" }).status, "claimed");
  queue.record("33", "request_info", { detail: "asked for the build number" });
  assert.equal(queue.get("33").status, "request_info", "waiting on the reporter is not actioned");
  assert.equal(queue.claim({ workerId: "w" }).status, "empty", "a parked item must not be re-claimed");
});

test("a PR receipt is actioned, never done, and only an exact repository URL is accepted", async () => {
  await withServer(
    async (url) => {
      assert.equal((await webhook(url, { post_number: 41, post_title: "[bug] pr receipt" })).status, 202);
      const claimed = await (await claim(url)).json();
      for (const bad of [
        "https://github.com/someone-else/saucerjam/pull/1",
        "https://github.com/menezmethod/saucerjam/pull/abc",
        "https://github.com/menezmethod/other/pull/1",
        "https://evil.example/github.com/menezmethod/saucerjam/pull/1",
        "opened #42",
      ]) {
        const rejected = await complete(url, { id: "41", action: "open-fix-pr", detail: bad, leaseToken: claimed.leaseToken, inputHash: claimed.inputHash });
        assert.equal(rejected.status, 400, `${bad} must not be accepted as a PR receipt`);
      }
      const good = await complete(url, { id: "41", action: "open-fix-pr", detail: "https://github.com/menezmethod/saucerjam/pull/42", leaseToken: claimed.leaseToken, inputHash: claimed.inputHash });
      assert.equal(good.status, 200);
      const item = (await good.json()).item;
      assert.equal(item.status, "actioned", "a worker cannot assert production completion");
      assert.notEqual(item.status, "done", "only verified Fider state may terminalize");
    },
    { communityActionToken: "tok", fiderWebhookToken: "hook" },
  );
});

test("a comment is an acknowledgement, distinct from a terminal outcome", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 51, title: "[bug] ack me" });
  queue.record("51", "comment", { detail: "we have your report" });
  const item = queue.get("51");
  assert.equal(item.status, "new", "an acknowledgement must not mark the work actioned");
  assert.ok(item.acknowledgedAt, "the acknowledgement is recorded on its own field");
  assert.equal(item.actions[0].action, "comment");
  assert.notEqual(item.status, "done", "an acknowledgement is not terminal");
});

test("a state-changing completion without a lease is refused over HTTP", async () => {
  await withServer(
    async (url) => {
      assert.equal((await webhook(url, { post_number: 52, post_title: "[bug] no lease" })).status, 202);
      const refused = await complete(url, { id: "52", action: "open-fix-pr", detail: "https://github.com/menezmethod/saucerjam/pull/1" });
      assert.equal(refused.status, 428, "a completion must present the lease the claim issued");
    },
    { communityActionToken: "tok", fiderWebhookToken: "hook" },
  );
});

// --- reconciliation ---------------------------------------------------------

test("terminal Fider state closes work, and a reopen returns it to the queue", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 61, title: "[bug] terminal" });
  queue.reconcile([{ number: 61, title: "[bug] terminal", status: "completed", createdAt: "2026-09-20T00:00:00Z" }]);
  assert.equal(queue.get("61").status, "done", "completed must close the item");
  assert.match(queue.get("61").terminalReason, /fider:completed/);
  queue.reconcile([{ number: 61, title: "[bug] terminal", status: "open", createdAt: "2026-09-20T00:00:00Z" }]);
  assert.equal(queue.get("61").status, "new", "a reopen must return the item to the queue");
  assert.equal(queue.get("61").attempts.length, 0, "a reopen restarts the attempt budget");
});

test("declined and duplicate are terminal too, and planned/started are not", () => {
  const queue = new CommunityQueue();
  for (const [number, status, expected] of [
    [71, "declined", "done"],
    [72, "duplicate", "done"],
    [73, "planned", "new"],
    [74, "started", "new"],
    [75, "open", "new"],
  ]) {
    queue.ingest({ number, title: `[bug] ${number}` });
    queue.reconcile([{ number, title: `[bug] ${number}`, status, createdAt: "2026-09-20T00:00:00Z" }]);
    assert.equal(queue.get(number).status, expected, `status ${status} must map to ${expected}`);
  }
});

test("repeated reconciliation passes do not reset attempts or re-announce work", () => {
  const queue = new CommunityQueue();
  queue.retryBaseMs = 60_000;
  queue.ingest({ number: 81, title: "[bug] stable" });
  queue.claim({ workerId: "w" });
  queue.record("81", "fail", {});
  const attempts = queue.get("81").attempts.length;
  const hash = queue.get("81").inputHash;
  const snapshot = [{ number: 81, title: "[bug] stable", status: "open", createdAt: "2026-09-20T00:00:00Z" }];
  for (let pass = 0; pass < 5; pass += 1) queue.reconcile(snapshot);
  assert.equal(queue.get("81").attempts.length, attempts, "a pass must not consume an attempt");
  assert.equal(queue.get("81").inputHash, hash, "unchanged content keeps its hash");
  assert.equal(queue.get("81").status, "new", "a pass must not change local work state");
});

test("an empty queue is backfilled from Fider state", () => {
  const queue = new CommunityQueue();
  assert.equal(queue.status().size, 0);
  queue.reconcile([
    { number: 11, title: "[bug] eleven", description: "d", status: "open", createdAt: "2026-09-19T17:00:00Z" },
    { number: 13, title: "[feature] thirteen", status: "planned", createdAt: "2026-09-19T18:00:00Z" },
  ]);
  assert.equal(queue.status().size, 2, "a missed webhook must be recovered by reconciliation");
  assert.equal(queue.get("13").fiderStatus, "planned");
});

test("a partial or unreadable Fider snapshot never terminalizes or resets anything", async () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 91, title: "[bug] keep me" });
  queue.claim({ workerId: "w" });
  const before = queue.get("91").status;
  const reconciler = new FiderReconciler({
    baseUrl: "https://fider.example",
    apiKey: "key",
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  const result = await reconciler.pass(queue);
  assert.equal(result.ok, false, "a failed fetch must not look like a successful pass");
  assert.equal(queue.get("91").status, before, "a failed snapshot must not change local state");
  assert.ok(queue.get("91").lease, "a failed snapshot must not clear a lease");
});

test("the reconciler treats a non-array body as a failure, not as no posts", async () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 92, title: "[bug] survives" });
  const reconciler = new FiderReconciler({
    baseUrl: "https://fider.example",
    apiKey: "key",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ posts: [] }) }),
  });
  const result = await reconciler.pass(queue);
  assert.equal(result.ok, false, "a malformed body is not an empty post list");
  assert.equal(queue.get("92").status, "new");
});

test("the reconciler excludes only the documented smoke posts", async () => {
  const queue = new CommunityQueue();
  const post = (number, title) => ({ id: number, number, title, description: "", createdAt: "2026-09-19T00:00:00Z", status: "open" });
  const reconciler = new FiderReconciler({
    baseUrl: "https://fider.example",
    apiKey: "key",
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes("view=all")
          ? [post(9, "[bug] smoke"), post(10, "[bug] smoke two"), post(11, "[bug] real"), post(12, "[bug] real two")]
          : [],
    }),
  });
  const result = await reconciler.pass(queue);
  assert.equal(result.ok, true);
  assert.equal(queue.get("9"), null, "the documented smoke post is excluded");
  assert.equal(queue.get("10"), null, "the documented smoke post is excluded");
  assert.ok(queue.get("11"), "a real post must not be excluded");
  assert.ok(queue.get("12"), "a real post must not be excluded");
  assert.deepEqual(reconciler.health().excludedPosts, [9, 10]);
});

test("the excluded smoke set is configurable", () => {
  const reconciler = new FiderReconciler({ baseUrl: "b", apiKey: "k", excluded: new Set([12]) });
  assert.deepEqual(reconciler.health().excludedPosts, [12]);
});

test("posts are ordered by Fider createdAt so a backfill is not served last", () => {
  const queue = new CommunityQueue();
  queue.ingest({ number: 3, title: "[bug] newest", createdAt: "2026-09-21T00:00:00Z" });
  queue.ingest({ number: 1, title: "[bug] oldest", createdAt: "2026-09-19T00:00:00Z" });
  queue.ingest({ number: 2, title: "[bug] middle", createdAt: "2026-09-20T00:00:00Z" });
  const order = [];
  for (let i = 0; i < 3; i += 1) order.push(queue.claim({ workerId: "w" }).item.number);
  assert.deepEqual(order, [1, 2, 3], "the oldest report is served first");
});

// --- truthful checks --------------------------------------------------------

test("a malformed /health body is an alert, not a healthy silence", () => {
  const dir = tmpDir();
  const fixture = path.join(dir, "fx.json");
  fs.writeFileSync(fixture, JSON.stringify({
    health: { status: 200, body: "<html>error</html>" },
    metrics: { status: 200, body: "saucerjam_rooms 0\n" },
  }));
  const result = spawnSync("node", [OPS, "sre", "check"], {
    encoding: "utf8",
    env: { ...process.env, SAUCERJAM_FIXTURE: fixture, SAUCERJAM_OPS_STATE_DIR: path.join(dir, "state") },
  });
  assert.notEqual(result.status, 0, "a 200 with an unparsable body must fail loudly");
  assert.match(result.stdout, /Malformed/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("degraded rankings in the metrics are an alert, not a healthy silence", () => {
  const dir = tmpDir();
  const fixture = path.join(dir, "fx.json");
  fs.writeFileSync(fixture, JSON.stringify({
    health: { status: 200, body: '{"status":"ok","rankings":"degraded","community":{"status":"ok"}}' },
    metrics: { status: 200, body: 'saucerjam_rooms 0\nsaucerjam_rankings_status{status="degraded"} 1\n' },
  }));
  const result = spawnSync("node", [OPS, "sre", "check"], {
    encoding: "utf8",
    env: { ...process.env, SAUCERJAM_FIXTURE: fixture, SAUCERJAM_OPS_STATE_DIR: path.join(dir, "state") },
  });
  assert.notEqual(result.status, 0, "a degraded ranking must not read as healthy");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the queue endpoint answers non-200 from an unhealthy store", async () => {
  const dir = tmpDir();
  const file = statePath(dir);
  fs.writeFileSync(file, "{ not json");
  await withServer(
    async (url) => {
      const res = await api(url, "/api/community/queue");
      assert.equal(res.status, 503, "a broken store must not report an empty queue");
      const health = await (await fetch(`${url}/health`)).json();
      assert.equal(health.community.status, "degraded", "an unhealthy store must surface in /health");
      assert.equal(health.status, "ok", "the game itself is still healthy");
      const metrics = await (await fetch(`${url}/metrics`)).text();
      assert.match(metrics, /saucerjam_community_queue_healthy 0/, "an unhealthy store must be visible in metrics");
    },
    { communityActionToken: "tok", communityStateFile: file },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a healthy game with no Fider configured stays healthy", async () => {
  await withServer(
    async (url) => {
      const health = await (await fetch(`${url}/health`)).json();
      assert.equal(health.status, "ok");
      assert.equal(health.community.status, "ok", "a missing optional integration is not a degradation");
      assert.equal(health.community.reconcile.configured, false);
    },
    { communityActionToken: "tok", communityStateFile: null },
  );
});

test("community metrics carry no report text or post ids as labels", async () => {
  await withServer(
    async (url) => {
      await webhook(url, { post_number: 71, post_title: "[bug] secret title 4711" });
      const metrics = await (await fetch(`${url}/metrics`)).text();
      const community = metrics.split("\n").filter((line) => line.startsWith("saucerjam_community"));
      assert.ok(community.length > 0, "community series exist");
      for (const line of community) {
        assert.ok(!line.includes("secret title 4711"), `report text leaked into a label: ${line}`);
        assert.ok(!/\bnumber=|\bid=/.test(line), `a post identity leaked into a label: ${line}`);
      }
    },
    { communityActionToken: "tok", fiderWebhookToken: "hook" },
  );
});
