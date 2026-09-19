#!/usr/bin/env node
// Proves the Hermes silence contract (D5) with fixtures, no network or creds:
//   healthy  -> exit 0 + empty stdout
//   broken   -> non-zero + a message
//   repeated -> silent (exit 0, empty stdout) inside the cooldown
//   recovered-> exit 0 + a RESOLVED line
//   missing  -> exactly one line naming the env var, non-zero
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OPS = path.join(__dirname, "saucerjam-ops.cjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-ops-"));
const state = path.join(tmp, "state");
const fixtures = {
  healthy: { health: { status: 200, body: "{}" }, metrics: { status: 200, body: "saucerjam_rooms 0\n" }, queue: { status: 200, body: '{"items":[]}' } },
  broken: { health: { status: 503, body: "down" }, metrics: { status: 404, body: "" }, queue: { status: 200, body: '{"items":[]}' } },
  queue: { health: { status: 200, body: "{}" }, metrics: { status: 200, body: "saucerjam_rooms 0\n" }, queue: { status: 200, body: '{"items":[{"id":"42"}]}' } },
};
const fixturePath = {};
for (const [name, value] of Object.entries(fixtures)) {
  fixturePath[name] = path.join(tmp, `${name}.json`);
  fs.writeFileSync(fixturePath[name], JSON.stringify(value));
}

function run(opsName, namespace, fixture, env = {}) {
  const childEnv = { ...process.env, SAUCERJAM_OPS_STATE_DIR: path.join(state, namespace), ...env };
  delete childEnv.SAUCERJAM_FIXTURE;
  if (fixture) childEnv.SAUCERJAM_FIXTURE = fixturePath[fixture];
  else {
    delete childEnv.COOLIFY_URL;
    delete childEnv.COOLIFY_TOKEN;
    delete childEnv.COMMUNITY_ACTION_TOKEN;
  }
  const result = spawnSync("node", [OPS, opsName, "check"], { env: childEnv, encoding: "utf8" });
  return { code: result.status, out: result.stdout };
}

let failed = 0;
function check(label, ok, detail) {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` -- ${detail}`}\n`);
}

const healthy = run("sre", "healthy", "healthy");
check("sre healthy: exit 0 and empty stdout", healthy.code === 0 && healthy.out === "", JSON.stringify(healthy));

const broken = run("sre", "broken", "broken");
check("sre broken: non-zero with a message", broken.code !== 0 && broken.out.trim() !== "", JSON.stringify(broken));

const repeated = run("sre", "broken", "broken");
check("sre repeated condition: silent (exit 0, empty stdout)", repeated.code === 0 && repeated.out === "", JSON.stringify(repeated));

const recovered = run("sre", "broken", "healthy");
check("sre recovered: exit 0 with a RESOLVED line", recovered.code === 0 && /^RESOLVED /.test(recovered.out), JSON.stringify(recovered));

const missing = run("sre", "missing", null);
check("missing required_env: one line naming the var, non-zero", missing.code !== 0 && missing.out.trim() === "MISSING ENV: COOLIFY_URL", JSON.stringify(missing));

const communityHealthy = run("community", "community", "healthy");
check("community healthy: exit 0 and empty stdout", communityHealthy.code === 0 && communityHealthy.out === "", JSON.stringify(communityHealthy));

const communityQueue = run("community", "community", "queue");
check("community new item: exit 0 with an event on stdout", communityQueue.code === 0 && /CommunityQueue: 1 new item/.test(communityQueue.out), JSON.stringify(communityQueue));

const communityRepeat = run("community", "community", "queue");
check("community identical queue: silent", communityRepeat.code === 0 && communityRepeat.out === "", JSON.stringify(communityRepeat));

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(failed ? `${failed} selftest check(s) failed\n` : "ops:selftest OK\n");
process.exit(failed ? 1 : 0);
