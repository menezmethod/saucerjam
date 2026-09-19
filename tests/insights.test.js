// Behavioural friction metrics: allow-listed, aggregated, exposed on /metrics.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGameServer } = require("../server/server");

async function withServer(fn) {
  const game = createGameServer({ tick: false, rankingsFile: null });
  await new Promise((r) => game.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(url); } finally { await game.close(); }
}
const post = (url, body) => fetch(`${url}/api/insights`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("insights accept allow-listed events and reject unknown ones", async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, { events: ["practice_start", "menu_opened", "not_a_real_event"], device: "touch", platform: "portrait" })).status, 204);
    const text = await (await fetch(`${url}/metrics`)).text();
    assert.match(text, /insight_events_total\{event="practice_start",device="touch",platform="portrait"\} 1/);
    assert.match(text, /insight_events_total\{event="menu_opened",device="touch",platform="portrait"\} 1/);
    assert.ok(!text.includes("not_a_real_event"), "unknown events must be dropped");
  });
});

test("friction ratios are derived and bounded [0,1]", async () => {
  await withServer(async (url) => {
    for (let i = 0; i < 4; i++) await post(url, { events: ["menu_opened_repeatedly", "died_without_kill"], device: "desktop", platform: "landscape" });
    const text = await (await fetch(`${url}/metrics`)).text();
    const line = text.split("\n").find((l) => l.includes('signal="died_without_kill_per_session"'));
    assert.ok(line, "ratio emitted");
    const value = Number(line.split(" ").pop());
    assert.ok(value >= 0 && value <= 1, `ratio out of range: ${value}`);
    assert.equal(text.match(/insight_events_total/g).length >= 2, true);
  });
});

test("insights ingest is rate limited", async () => {
  await withServer(async (url) => {
    let limited = false;
    for (let i = 0; i < 200 && !limited; i++) {
      const res = await post(url, { events: ["menu_opened"] });
      if (res.status === 429) limited = true;
    }
    assert.ok(limited, "flood of insight posts should be limited");
  });
});
