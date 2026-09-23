"use strict";
// SRE heal contract. Everything here drives the ops script through local HTTP
// fixtures: no real restart, no Coolify call, no production endpoint.
//
// The heal sequence being pinned down: fresh confirmation, credentials, second
// sample, budget/cooldown/deployment guard, restart, bounded recovery check.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OPS = path.join(__dirname, "..", "scripts", "ops", "saucerjam-ops.cjs");
const HEALTHY = '{"status":"ok","rankings":"ok","community":{"status":"ok"}}';
const METRICS = 'saucerjam_rooms 0\nsaucerjam_rankings_status{status="ok"} 1\n';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-heal-"));

// A minimal local stand-in for a broken SaucerJam. Health stays down until the
// restart endpoint has been called enough times, and it answers the Coolify
// deployment listing so the deployment guard can be exercised.
async function brokenServer({ recoverAfterRestarts = 0, activeDeployment = false } = {}) {
  const state = { restarts: 0, healthy: false };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/v1/deployments")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(activeDeployment ? [{ status: "in_progress" }] : []));
    }
    if (req.url.startsWith("/api/v1/applications/") && req.url.endsWith("/restart")) {
      state.restarts += 1;
      if (state.restarts > recoverAfterRestarts) state.healthy = true;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url === "/health") {
      res.writeHead(state.healthy ? 200 : 503, { "content-type": "application/json" });
      return res.end(state.healthy ? HEALTHY : '{"status":"down"}');
    }
    if (req.url === "/metrics") {
      res.writeHead(state.healthy ? 200 : 503, { "content-type": "text/plain" });
      return res.end(state.healthy ? METRICS : "");
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, state, base: `http://127.0.0.1:${server.address().port}` };
}

function runHeal({ base, stateDir, env = {} }) {
  return spawnSync("node", [OPS, "sre", "heal"], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      SAUCERJAM_URL: base,
      COOLIFY_URL: base,
      COOLIFY_TOKEN: "fixture-token",
      COOLIFY_APP_SAUCERJAM: "fixture-app",
      SAUCERJAM_OPS_STATE_DIR: stateDir,
      SAUCERJAM_HEAL_CONFIRM_DELAY_MS: "1",
      SAUCERJAM_HEAL_COOLDOWN_MS: "0",
      SAUCERJAM_HEAL_POLL_MS: "5",
      SAUCERJAM_HEAL_BUDGET_MS: "3000",
      ...env,
    },
  });
}

test("heal does not act on a saved state when the service is healthy right now", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer();
  try {
    // A stale saved down state, exactly what the old implementation trusted.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "sre.state.json"), JSON.stringify({ condition: "down", notifiedAt: Date.now() }));
    state.healthy = true;
    const result = runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 0, "a healthy service must never be restarted because a stale file said down");
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "", "a cleared incident stays silent");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heal reports a degraded condition instead of restarting", async () => {
  const dir = tmpDir();
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"status":"ok","rankings":"degraded","community":{"status":"ok"}}');
    }
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end('saucerjam_rooms 0\nsaucerjam_rankings_status{status="degraded"} 1\n');
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = runHeal({ base, stateDir: dir });
    assert.notEqual(result.status, 0, "a degraded ranking is an alert");
    assert.match(result.stdout, /not a restart condition/, "the reason must say a restart is not the remedy");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heal restarts once and verifies recovery", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer({ recoverAfterRestarts: 0 });
  try {
    const result = runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 1, "one confirmed failure earns exactly one restart");
    assert.equal(result.status, 0, `heal must succeed when recovery is verified: ${result.stdout}`);
    assert.match(result.stdout, /recovered after restart/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, "sre.state.json"), "utf8"), /restarts/, "a verified recovery clears the budget");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an accepted restart that never recovers is reported and stays counted", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer({ recoverAfterRestarts: 99 });
  try {
    const first = runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 1);
    assert.notEqual(first.status, 0, "an accepted POST is not recovery");
    assert.match(first.stdout, /did not recover/);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "sre.state.json"), "utf8"));
    assert.equal(saved.incident.restarts, 1, "an accepted-but-down restart must spend budget");
    assert.equal(saved.incident.lastRestartAccepted, true);

    const second = runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 2, "the second attempt is still allowed");
    assert.notEqual(second.status, 0);

    const third = runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 2, "the restart budget must not be exceeded across invocations");
    assert.notEqual(third.status, 0);
    assert.match(third.stdout, /budget exhausted|cooldown/i);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a healthy sample clears the incident and renews the restart budget", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer({ recoverAfterRestarts: 99 });
  try {
    runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 1);
    state.healthy = true;
    const recovered = runHeal({ base, stateDir: dir });
    assert.equal(recovered.status, 0);
    assert.equal(state.restarts, 1, "no restart is attempted once the service is healthy");
    assert.doesNotMatch(fs.readFileSync(path.join(dir, "sre.state.json"), "utf8"), /restarts/, "the incident budget is cleared by a healthy sample");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heal respects a cooldown so two ticks cannot stack restarts", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer({ recoverAfterRestarts: 99 });
  try {
    runHeal({ base, stateDir: dir, env: { SAUCERJAM_HEAL_COOLDOWN_MS: "600000" } });
    assert.equal(state.restarts, 1);
    const second = runHeal({ base, stateDir: dir, env: { SAUCERJAM_HEAL_COOLDOWN_MS: "600000" } });
    assert.equal(state.restarts, 1, "the cooldown must hold the second restart back");
    assert.notEqual(second.status, 0);
    assert.match(second.stdout, /cooldown/i);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heal defers while a deployment is active for the application", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer({ activeDeployment: true });
  try {
    const result = runHeal({ base, stateDir: dir });
    assert.equal(state.restarts, 0, "an active deployment must block a restart");
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /deployment is active/i);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heal requires credentials before it will restart anything", async () => {
  const dir = tmpDir();
  const { server, state, base } = await brokenServer();
  try {
    const result = spawnSync("node", [OPS, "sre", "heal"], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        SAUCERJAM_URL: base,
        SAUCERJAM_OPS_STATE_DIR: dir,
        COOLIFY_URL: "",
        COOLIFY_TOKEN: "",
        SAUCERJAM_HEAL_CONFIRM_DELAY_MS: "1",
      },
    });
    assert.notEqual(result.status, 0);
    assert.equal(state.restarts, 0, "without credentials nothing may be restarted");
    assert.match(result.stdout, /MISSING ENV/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("heal stops on a second sample that has already recovered", async () => {
  const dir = tmpDir();
  let restarts = 0;
  let healthCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      healthCalls += 1;
      const healthy = healthCalls > 1;
      res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      return res.end(healthy ? HEALTHY : '{"status":"down"}');
    }
    if (req.url === "/metrics") {
      res.writeHead(503).end();
      return;
    }
    if (req.url.endsWith("/restart")) {
      restarts += 1;
      res.writeHead(200).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = runHeal({ base, stateDir: dir, env: { SAUCERJAM_HEAL_CONFIRM_DELAY_MS: "5" } });
    assert.equal(restarts, 0, "a single flapping sample must not spend a restart");
    assert.match(result.stdout, /not confirmed/i);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
