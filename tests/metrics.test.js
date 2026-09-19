// SRE contract: /metrics must render valid Prometheus text and reflect real activity.
const test = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { createGameServer } = require("../server/server");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withServer(fn, options = {}) {
  const game = createGameServer({ tick: false, rankingsFile: null, ...options });
  await new Promise((r) => game.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(game, url); } finally { await game.close(); }
}

const connect = (url) => new Promise((resolve, reject) => {
  const socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 8000 });
  socket.once("connect", () => resolve(socket));
  socket.once("connect_error", reject);
});
const join = (socket, request) => new Promise((resolve, reject) =>
  socket.timeout(8000).emit("join", request, (err, response) => (err ? reject(err) : resolve(response))));

function parseMetrics(text) {
  const samples = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[\d.eE+]+)$/);
    if (!match) throw new Error(`Malformed Prometheus line: ${line}`);
    samples.set(`${match[1]}${match[2] || ""}`, Number(match[3]));
  }
  return samples;
}

test("/metrics renders valid Prometheus text with help/type and process gauges", async () => {
  await withServer(async (_game, url) => {
    const res = await fetch(`${url}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/plain/);
    const text = await res.text();
    assert.match(text, /# HELP saucerjam_rooms/);
    assert.match(text, /# TYPE saucerjam_rooms gauge/);
    const samples = parseMetrics(text); // throws on malformed lines
    assert.equal(samples.get("saucerjam_rooms"), 0);
    assert.equal(samples.get("saucerjam_players"), 0);
    assert.ok(samples.get("saucerjam_process_uptime_seconds") >= 0);
    assert.ok(samples.get("saucerjam_process_resident_memory_bytes") > 0);
  });
});

test("metrics reflect joins, human/bot gauges, and retention tokens", async () => {
  await withServer(async (_game, url) => {
    const socket = await connect(url);
    const joined = await join(socket, { mode: "create", bots: true, name: "Metric Pilot", profileToken: "a".repeat(40) });
    assert.ok(!joined.error, joined.error);
    await wait(50);
    const text = await (await fetch(`${url}/metrics`)).text();
    const samples = parseMetrics(text);
    assert.ok(samples.get('saucerjam_joins_total{mode="create",map="confluence"}') >= 1, "join counter");
    assert.equal(samples.get("saucerjam_players"), 1, "human gauge");
    assert.ok(samples.get("saucerjam_bots") >= 1, "bot gauge");
    assert.equal(samples.get("saucerjam_distinct_pilots_7d"), 1, "retention token counted");
    socket.disconnect();
    await wait(50);
    const after = parseMetrics(await (await fetch(`${url}/metrics`)).text());
    assert.equal(after.get("saucerjam_players"), 0, "human gauge returns to zero");
    assert.ok(after.get('saucerjam_leaves_total{cause="client"}') >= 1);
  });
});

test("join failures are counted by reason and rate limiting is visible", async () => {
  await withServer(
    async (_game, url) => {
      const socket = await connect(url);
      // join() debounces within 400ms, so wait past it before the real request.
      await wait(450);
      const missing = await join(socket, { mode: "join", code: "ZZZZZZ", name: "Lost" });
      assert.match(missing.error, /not found/i);
      await wait(30);
      const samples = parseMetrics(await (await fetch(`${url}/metrics`)).text());
      assert.ok(samples.get('saucerjam_join_failures_total{reason="room_not_found"}') >= 1);
      socket.disconnect();
    },
    { joinAttemptsPerIp: 1000 },
  );
});
