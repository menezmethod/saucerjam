// Product/business metrics: retention windows, session duration, first-round
// time, and the session denominator for friction ratios. These feed the
// Product & growth dashboard (docs/SRE.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { createGameServer } = require("../server/server");
const { Metrics } = require("../server/metrics");

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

const sample = (text, name) => {
  const found = text.split("\n").find((l) => l.startsWith(`${name} `) || l.startsWith(`${name}{`));
  assert.ok(found, `metric missing: ${name}`);
  return Number(found.split(" ").pop());
};

test("retention windows, session count, and session duration are reported", async () => {
  await withServer(async (_game, url) => {
    const socket = await connect(url);
    const joined = await join(socket, { mode: "create", bots: true, name: "Prod Pilot", profileToken: "b".repeat(40) });
    assert.ok(!joined.error, joined.error);
    await wait(80);

    let text = await (await fetch(`${url}/metrics`)).text();
    assert.match(text, /# TYPE saucerjam_distinct_pilots_1d gauge/);
    assert.match(text, /# TYPE saucerjam_distinct_pilots_30d gauge/);
    assert.equal(sample(text, "saucerjam_distinct_pilots_1d"), 1, "counted in 24h");
    assert.equal(sample(text, "saucerjam_distinct_pilots_7d"), 1, "counted in 7d");
    assert.equal(sample(text, "saucerjam_distinct_pilots_30d"), 1, "counted in 30d");
    assert.ok(sample(text, "insight_sessions_total") >= 1, "a connection is a session");

    socket.disconnect();
    await wait(80);
    text = await (await fetch(`${url}/metrics`)).text();
    assert.ok(sample(text, "saucerjam_session_seconds_count") >= 1, "session duration observed on disconnect");
  });
});

test("Metrics renders first-round and session histograms", () => {
  const metrics = new Metrics();
  metrics.sessionDuration.observe({}, 42);
  metrics.firstRound.observe({}, 120);
  const text = metrics.render();
  assert.match(text, /# TYPE saucerjam_first_round_seconds histogram/);
  assert.match(text, /# TYPE saucerjam_session_seconds histogram/);
  assert.match(text, /saucerjam_first_round_seconds_count 1/);
  assert.match(text, /saucerjam_first_round_seconds_sum 120/);
  assert.match(text, /saucerjam_session_seconds_count 1/);
});

test("a short window query does not evict longer retention windows", () => {
  const metrics = new Metrics();
  const token = "c".repeat(40);
  metrics.seeToken(token);
  // Simulate an old token by rewinding its timestamp beyond 7d but within 30d.
  const hash = require("node:crypto").createHash("sha256").update(token).digest("hex");
  metrics.tokens.set(hash, Date.now() - 10 * 24 * 60 * 60_000);
  assert.equal(metrics.distinctTokens(24 * 60 * 60_000), 0, "outside the 1d window");
  // The 1d call must not delete it: still inside the 30d window.
  assert.equal(metrics.distinctTokens(30 * 24 * 60 * 60_000), 1, "retained for 30d");
});
