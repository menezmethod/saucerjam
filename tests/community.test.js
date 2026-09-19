"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGameServer } = require("../server/server");

const reply = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

test("community report verifies Supabase identity and creates an impersonated Fider post", async (t) => {
  const originalFetch = global.fetch;
  const request = (...args) => originalFetch(...args);
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user"))
      return reply({
        id: "user-123",
        email: "pilot@example.com",
        email_confirmed_at: "2026-09-18T00:00:00.000Z",
        user_metadata: { full_name: "Pilot One" },
      });
    if (String(url).endsWith("/api/v1/users")) return reply({ id: 44 });
    if (String(url).endsWith("/api/v1/posts")) return reply({ number: 17, slug: "broken-map" });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  t.after(() => { global.fetch = originalFetch; });
  const game = createGameServer({
    tick: false,
    supabaseUrl: "https://auth.example",
    supabasePublishableKey: "publishable",
    fiderBaseUrl: "https://community.example",
    fiderApiKey: "server-only-key",
  });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  t.after(() => game.close());

  const response = await request(`${url}/api/community/report`, {
    method: "POST",
    headers: { authorization: "Bearer supabase-token", "content-type": "application/json" },
    body: JSON.stringify({
      kind: "bug",
      title: "Portal clips through wall",
      description: "A portal edge is visible through the cover after reconnecting.",
      context: { mode: "online", mapId: "confluence", device: "desktop" },
    }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, url: "https://community.example/posts/17", number: 17 });
  const createUser = calls.find((call) => call.url.endsWith("/api/v1/users"));
  const createPost = calls.find((call) => call.url.endsWith("/api/v1/posts"));
  assert.equal(createUser.options.headers.authorization, "Bearer server-only-key");
  assert.equal(JSON.parse(createUser.options.body).reference, "supabase:user-123");
  assert.equal(createPost.options.headers["x-fider-userid"], "44");
  assert.match(JSON.parse(createPost.options.body).description, /Map: confluence/);
  assert.doesNotMatch(JSON.stringify(JSON.parse(createPost.options.body)), /supabase-token/);

  const limited = await request(`${url}/api/community/report`, {
    method: "POST",
    headers: { authorization: "Bearer supabase-token", "content-type": "application/json" },
    body: JSON.stringify({ title: "Another report", description: "This should be rate limited." }),
  });
  assert.equal(limited.status, 429);
});

test("community reports reject guests and unconfirmed accounts", async (t) => {
  const originalFetch = global.fetch;
  const request = (...args) => originalFetch(...args);
  global.fetch = async (url) => String(url).endsWith("/auth/v1/user")
    ? reply({ id: "user-456", email: "unverified@example.com" })
    : reply({ id: 1 });
  t.after(() => { global.fetch = originalFetch; });
  const game = createGameServer({
    tick: false,
    supabaseUrl: "https://auth.example",
    supabasePublishableKey: "publishable",
    fiderBaseUrl: "https://community.example",
    fiderApiKey: "server-only-key",
  });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  t.after(() => game.close());
  assert.equal((await request(`${url}/api/community/report`, { method: "POST" })).status, 401);
  assert.equal((await request(`${url}/api/community/report`, { method: "POST", headers: { authorization: "Bearer token" } })).status, 403);
});
