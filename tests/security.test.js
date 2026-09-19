const { test } = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { createGameServer } = require("../server/server");

test("security guardrails add headers, throttle health checks, and reject foreign origins", async (t) => {
  const game = createGameServer({ tick: false, maxConnections: 8, maxConnectionsPerIp: 8 });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  t.after(async () => game.close());

  const first = await fetch(`${url}/health`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-powered-by"), null);
  assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  assert.equal(first.headers.get("referrer-policy"), "no-referrer");
  for (let i = 1; i < 30; i++) assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/health`)).status, 429);

  const denied = io(url, { extraHeaders: { origin: "https://evil.example" }, reconnection: false });
  const error = await new Promise((resolve) => denied.once("connect_error", resolve));
  assert.ok(error);
  assert.equal(denied.connected, false);
  denied.close();
});

test("arena chat is room-scoped and rate-limited", async (t) => {
  const game = createGameServer({ tick: false, maxConnections: 8, maxConnectionsPerIp: 8 });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const pilot = io(url, { reconnection: false });
  const observer = io(url, { reconnection: false });
  t.after(async () => { pilot.close(); observer.close(); await game.close(); });
  await Promise.all([
    new Promise((resolve) => pilot.once("connect", resolve)),
    new Promise((resolve) => observer.once("connect", resolve)),
  ]);
  const room = await new Promise((resolve) => pilot.emit("join", { mode: "create", name: "Pilot", bots: false }, resolve));
  await new Promise((resolve, reject) => observer.emit("join", { mode: "join", code: room.code, name: "Observer" }, (response) => response?.error ? reject(new Error(response.error)) : resolve()));
  const received = new Promise((resolve) => observer.once("chat", resolve));
  pilot.emit("chat", { text: "  hello   arena  " });
  assert.equal((await received).text, "hello arena");
  const limited = await new Promise((resolve) => pilot.emit("chat", { text: "again" }, resolve));
  assert.match(limited.error, /cooling down/);
});
