"use strict";
// A standing queue must not be re-announced every tick.
//
// The bug: COOLDOWN_MS was 30 minutes and the cron fires every 30 minutes, so the
// guard `now - notifiedAt < COOLDOWN_MS` never tripped. The condition key is the
// item ids (`queue:13,36`), which do not change while items sit untriaged, so the
// same two reports were delivered forever — nine identical messages in one
// afternoon of real use.
//
// State is seeded directly rather than by faking the clock: the guard reads
// `notifiedAt` from the state file, so writing that file IS the clock.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OPS = path.join(__dirname, "..", "scripts", "ops", "saucerjam-ops.cjs");

function queueFixture(ids) {
  return {
    health: { status: 200, body: "{}" },
    metrics: { status: 200, body: "saucerjam_rooms 0\n" },
    queue: {
      status: 200,
      body: JSON.stringify({
        items: ids.map((n) => ({ id: String(n), number: n, title: `t${n}`, description: `d${n}`, url: `https://community.example/posts/${n}` })),
      }),
    },
  };
}

// Run the ops community check against a fixture, with a pre-seeded state dir.
function runCheck({ ids, stateCondition, notifiedAgoMs }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-standing-"));
  const fixturePath = path.join(tmp, "fx.json");
  fs.writeFileSync(fixturePath, JSON.stringify(queueFixture(ids)));
  const stateDir = path.join(tmp, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  if (stateCondition !== undefined) {
    fs.writeFileSync(
      path.join(stateDir, "community.state.json"),
      JSON.stringify({
        condition: stateCondition,
        since: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
        notifiedAt: Date.now() - notifiedAgoMs,
      }),
    );
  }
  const res = spawnSync("node", [OPS, "community", "check"], {
    encoding: "utf8",
    env: { ...process.env, SAUCERJAM_FIXTURE: fixturePath, SAUCERJAM_OPS_STATE_DIR: stateDir },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("a standing queue is NOT re-announced on the next tick", () => {
  // Exactly the production failure: same ids, notified one tick (30m) ago.
  const res = runCheck({ ids: [13, 36], stateCondition: "queue:13,36", notifiedAgoMs: 30 * 60_000 });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.equal(
    res.stdout.trim(),
    "",
    `a queue notified 30m ago must stay silent, got: ${JSON.stringify(res.stdout.slice(0, 200))}`,
  );
});

test("a standing queue still re-announces eventually (not silently parked)", () => {
  const res = runCheck({ ids: [13, 36], stateCondition: "queue:13,36", notifiedAgoMs: 25 * 60 * 60_000 });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /CommunityQueue: 2 new item/, "past the standing floor it must speak again");
});

test("a CHANGED queue notifies immediately, even within the floor", () => {
  // A new report arrives: the key changes, so the standing floor must not apply.
  const res = runCheck({ ids: [13, 36, 37], stateCondition: "queue:13,36", notifiedAgoMs: 60_000 });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /CommunityQueue: 3 new item/, "a new report must never be suppressed");
});

test("a cleared queue announces RESOLVED once, then goes quiet", () => {
  // An empty queue after a standing condition is a real state transition: the
  // operator is told the queue cleared, exactly once. State is then cleared so it
  // cannot repeat — that one-shot property is the thing worth pinning.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-standing-empty-"));
  const fixturePath = path.join(tmp, "fx.json");
  fs.writeFileSync(fixturePath, JSON.stringify({ health: { status: 200, body: "{}" }, metrics: { status: 200, body: "" }, queue: { status: 200, body: JSON.stringify({ items: [] }) } }));
  const stateDir = path.join(tmp, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "community.state.json"), JSON.stringify({ condition: "queue:13,36", since: new Date().toISOString(), notifiedAt: Date.now() - 60_000 }));
  const env = { ...process.env, SAUCERJAM_FIXTURE: fixturePath, SAUCERJAM_OPS_STATE_DIR: stateDir };

  const first = spawnSync("node", [OPS, "community", "check"], { encoding: "utf8", env });
  assert.equal(first.status, 0);
  assert.match(first.stdout, /RESOLVED queue:13,36/, "clearing a standing queue is announced once");

  const second = spawnSync("node", [OPS, "community", "check"], { encoding: "utf8", env });
  assert.equal(second.status, 0);
  assert.equal(second.stdout.trim(), "", "RESOLVED must not repeat on the next tick");
});
