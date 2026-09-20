"use strict";
// A run killed mid-apply must still have reported the writes that already succeeded.
// Buffering the output until the end makes a deadline kill report nothing at all:
// the tracker changed, and the operator sees a silent timeout instead of
// "these closed, this one did not".
//
// The stub server lives in THIS process, so the collector must be spawned
// asynchronously. spawnSync would block the event loop and the server could never
// answer, which is indistinguishable from a hung collector - that is exactly how an
// earlier version of this check produced a false failure.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
const mkPost = (n) => ({ id: n, number: n, title: `[bug] post ${n}`, description: "", status: "open", createdAt: ago(2), votesCount: 0 });

function withStub(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

const collect = (port, ms) => new Promise((resolve) => {
  // Build the child env explicitly. Inheriting the shell's LIFECYCLE_* would change
  // the policy under test and make this fail spuriously.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("LIFECYCLE_") && k !== "FIDER_API_KEY" && k !== "FIDER_BASE_URL") env[k] = v;
  env.FIDER_BASE_URL = `http://127.0.0.1:${port}`;
  env.FIDER_API_KEY = "t";
  execFile("node", [path.resolve(__dirname, "../scripts/ops/saucerjam-lifecycle.cjs"), "--apply"], {
    env,
    timeout: ms,
    killSignal: "SIGKILL",
  }, (err, stdout, stderr) => resolve({ killed: Boolean(err && err.killed), stdout, stderr }));
});

test("a run killed mid-apply still reports the actions that already succeeded", async () => {
  const { server, port } = await withStub((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("content-type", "application/json");
    if (/^\/api\/v1\/posts\/\d+\/comments$/.test(url.pathname)) {
      // Collection succeeds for both; only the WRITE to #8 hangs, so the deadline
      // kills the run after #7 has already been written.
      if (Number(url.pathname.split("/")[4]) === 8 && req.method === "POST") return;
      return res.end(JSON.stringify([]));
    }
    if (url.pathname === "/api/v1/posts/7/status") return res.end("{}");
    if (/^\/api\/v1\/posts\/\d+$/.test(url.pathname)) return res.end(JSON.stringify(mkPost(Number(url.pathname.split("/")[4]))));
    if (url.pathname.startsWith("/api/v1/posts")) return res.end(JSON.stringify([mkPost(7), mkPost(8)]));
    res.end("{}");
  });

  try {
    const r = await collect(port, 6000);
    assert.ok(r.killed, `the run should have been killed by the deadline; stdout=${JSON.stringify(r.stdout)}`);
    assert.match(r.stdout, /DONE ack #7/, `a completed write must be reported before the kill; got ${JSON.stringify(r.stdout)}`);
  } finally {
    server.close();
  }
});
