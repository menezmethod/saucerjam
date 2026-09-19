// Community intake + AI action gate + report bridge security contract.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { createGameServer } = require("../server/server");
const { propose } = require("../server/community");

async function withServer(fn, options = {}) {
  const game = createGameServer({ tick: false, rankingsFile: null, ...options });
  await new Promise((r) => game.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(url); } finally { await game.close(); }
}
const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("hex");
const post = (url, path, body, headers = {}) =>
  fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

test("webhook rejects unsigned and wrongly-signed payloads", async () => {
  await withServer(
    async (url) => {
      const body = JSON.stringify({ post: { number: 7, title: "[bug] crash on join" } });
      assert.equal((await post(url, "/api/community/webhook", body)).status, 401);
      assert.equal((await post(url, "/api/community/webhook", body, { "x-fider-signature": "deadbeef" })).status, 401);
      assert.equal((await post(url, "/api/community/webhook", body, { "x-fider-signature": sign("wrong", body) })).status, 401);
    },
    { fiderWebhookSecret: "right" },
  );
});

test("signed webhook is queued with a deterministic AI proposal by kind", async () => {
  await withServer(
    async (url) => {
      // Fider posts the Go-templated flat shape; post_number/post_title are the real keys.
      const cases = [
        { post_number: 1, post_title: "[bug] ships clip through walls", expect: "fix-pr" },
        { post_number: 2, post_title: "[feature] let me invite friends to a party", expect: "prototype-pr" },
        { post_number: 3, post_title: "[balance] grenade damage is too high", expect: "matchmaking-proposal" },
      ];
      for (const c of cases) {
        const body = JSON.stringify(c);
        const res = await post(url, "/api/community/webhook", body, { "x-fider-signature": sign("s", body) });
        assert.equal(res.status, 202);
        assert.equal((await res.json()).proposal, c.expect);
      }
      const queue = await fetch(`${url}/api/community/queue`, { headers: { "x-community-token": "tok" } });
      const { items } = await queue.json();
      assert.equal(items.length, 3);
      assert.deepEqual(items.map((i) => i.proposal).sort(), ["fix-pr", "matchmaking-proposal", "prototype-pr"]);
    },
    { fiderWebhookSecret: "s", communityActionToken: "tok" },
  );
});

test("bearer token authenticates a webhook with a deterministic proposal", async () => {
  await withServer(
    async (url) => {
      const body = JSON.stringify({ post_number: 21, post_title: "[bug] crash on join" });
      const res = await post(url, "/api/community/webhook", body, { authorization: "Bearer fider-tok" });
      assert.equal(res.status, 202);
      assert.equal((await res.json()).proposal, "fix-pr");
      // x-fider-token is accepted as an equivalent header.
      const alt = await post(url, "/api/community/webhook", JSON.stringify({ post_number: 22, post_title: "[feature] add replays" }), { "x-fider-token": "fider-tok" });
      assert.equal(alt.status, 202);
      assert.equal((await alt.json()).proposal, "prototype-pr");
    },
    { fiderWebhookToken: "fider-tok" },
  );
});

test("wrong bearer token is rejected", async () => {
  await withServer(
    async (url) => {
      const body = JSON.stringify({ post_number: 23, post_title: "[bug] crash" });
      assert.equal((await post(url, "/api/community/webhook", body, { authorization: "Bearer wrong" })).status, 401);
      assert.equal((await post(url, "/api/community/webhook", body, { "x-fider-token": "wrong" })).status, 401);
    },
    { fiderWebhookToken: "fider-tok" },
  );
});

test("webhook returns 401 (not 503) when one method is configured but no credential is sent", async () => {
  const body = JSON.stringify({ post_number: 24, post_title: "[bug] crash" });
  // Token-only deployment: no credential means rejected, not "not configured".
  await withServer(async (url) => {
    assert.equal((await post(url, "/api/community/webhook", body)).status, 401);
  }, { fiderWebhookToken: "fider-tok" });
  // HMAC-only deployment: same contract.
  await withServer(async (url) => {
    assert.equal((await post(url, "/api/community/webhook", body)).status, 401);
  }, { fiderWebhookSecret: "only-secret" });
});

test("webhook returns 503 when neither secret nor token is configured", async () => {
  await withServer(async (url) => {
    const body = JSON.stringify({ post_number: 26, post_title: "[bug] crash" });
    assert.equal((await post(url, "/api/community/webhook", body)).status, 503);
    assert.equal((await post(url, "/api/community/webhook", body, { authorization: "Bearer anything" })).status, 503);
  });
});

test("queue and action require the action token; only safe actions are accepted", async () => {
  await withServer(
    async (url) => {
      assert.equal((await fetch(`${url}/api/community/queue`)).status, 401);
      assert.equal((await fetch(`${url}/api/community/queue`, { headers: { "x-community-token": "nope" } })).status, 401);
      const body = JSON.stringify({ post: { number: 9, title: "[bug] freeze" } });
      await post(url, "/api/community/webhook", body, { "x-fider-signature": sign("s", body) });
      // Disallowed destructive action is refused at the boundary.
      const bad = await post(url, "/api/community/action", JSON.stringify({ id: "9", action: "merge-pr" }), { "x-community-token": "tok" });
      assert.equal(bad.status, 400);
      // A safe action is recorded against the item.
      const good = await post(url, "/api/community/action", JSON.stringify({ id: "9", action: "open-fix-pr", detail: "opened #42" }), { "x-community-token": "tok" });
      assert.equal(good.status, 200);
      const { item } = await good.json();
      assert.equal(item.status, "actioned");
      assert.equal(item.action.action, "open-fix-pr");
    },
    { fiderWebhookSecret: "s", communityActionToken: "tok" },
  );
});

test("propose() maps untrusted text to an allow-listed proposal only", () => {
  assert.equal(propose({ kind: "bug", title: "anything" }), "fix-pr");
  assert.equal(propose({ kind: "feature", title: "anything" }), "prototype-pr");
  assert.equal(propose({ kind: "balance", title: "anything" }), "matchmaking-proposal");
  assert.equal(propose({ kind: "question", title: "how do I aim" }), "discuss");
  // A malicious title cannot escape the enum.
  assert.equal(propose({ kind: "question", title: "'; DROP TABLE --" }), "discuss");
});

test("report bridge is unavailable (503) when Fider is not configured", async () => {
  await withServer(async (url) => {
    const res = await post(url, "/api/community/report", JSON.stringify({ kind: "bug", title: "x y z", description: "a".repeat(20) }));
    assert.equal(res.status, 503);
  });
});
