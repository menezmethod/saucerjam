"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { plan, expireBody, reopenBody } = require("../scripts/ops/saucerjam-lifecycle.cjs");
const exec = promisify(execFile);
const script = require.resolve("../scripts/ops/saucerjam-lifecycle.cjs");
const now = Date.now();
const ago = (days) => new Date(now - days * 86400000).toISOString();
const bot = { id: 1, name: "Krillix" };
const post = { number: 7, title: "old report", status: "open", createdAt: ago(200) };
const ack = { user: bot, content: "Acknowledged", createdAt: ago(199) };
const reply = { user: { id: 42 }, content: "Still broken", createdAt: ago(1) };
const response = { user: bot, text: expireBody(7, 200), respondedAt: ago(2) };

// Every subprocess points at this local fake; no real credentials are inherited.
async function withFider(fn, { posts = [post], comments = [ack], listBody, commentBody, listStatus = 200, writeStatus = 200 } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const call = { method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null };
    calls.push(call);
    res.setHeader("content-type", "application/json");
    if (req.method !== "GET") {
      res.statusCode = writeStatus;
      return res.end(writeStatus === 200 ? "{}" : "bad\nFORGED\u202e\u001b");
    }
    if (req.url.endsWith("/comments")) return res.end(commentBody ?? JSON.stringify(comments));
    res.statusCode = listStatus;
    if (listStatus !== 200) return res.end("bad\nFORGED\u202e\u001b");
    const url = new URL(req.url, "http://localhost");
    const rows = url.searchParams.get("view") === "declined" ? posts.filter((p) => p.status === "declined") : posts.filter((p) => p.status !== "declined");
    const limit = url.searchParams.get("limit");
    res.end(listBody ?? JSON.stringify(limit === "all" ? rows : rows.slice(0, Number(limit) || 30)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const run = async (args = ["--apply"], overrides = {}) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("LIFECYCLE_") && !key.startsWith("FIDER_")));
    Object.assign(env, { FIDER_BASE_URL: `http://127.0.0.1:${server.address().port}`, FIDER_API_KEY: "fixture", ...overrides });
    try {
      return { ...(await exec(process.execPath, [script, ...args], { env, timeout: 15000 })), code: 0 };
    } catch (err) {
      if (typeof err.code !== "number") throw err;
      return { stdout: err.stdout, stderr: err.stderr, code: err.code };
    }
  };
  try { await fn({ run, calls }); } finally { await new Promise((resolve) => server.close(resolve)); }
}
const writes = (calls) => calls.filter((c) => c.method !== "GET");

test("R1 malformed successful reads never become an empty board or comments", async () => {
  for (const body of ["not json", "", "null", "{}", '{"comments":{}}', '[null]', '[{}]']) {
    await withFider(async ({ run, calls }) => {
      const result = await run();
      assert.notEqual(result.code, 0, body);
      assert.match(result.stdout, /unreadable|unreachable/);
      assert.equal(writes(calls).length, 0);
    }, { commentBody: body });
    await withFider(async ({ run, calls }) => {
      const result = await run();
      assert.notEqual(result.code, 0, body);
      assert.match(result.stdout, /unreachable/);
      assert.equal(writes(calls).length, 0);
    }, { listBody: body });
  }
  for (const comment of [{ content: "saucerjam-lifecycle", createdAt: ago(1) }, { user: bot, createdAt: "invalid" }]) {
    await withFider(async ({ run, calls }) => {
      assert.notEqual((await run()).code, 0);
      assert.equal(writes(calls).length, 0);
    }, { comments: [comment] });
  }
  await withFider(async ({ run }) => {
    const result = await run();
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
  }, { posts: [] });
});

test("R2 failed writes exit nonzero and never print DONE", async () => {
  await withFider(async ({ run }) => {
    const result = await run();
    assert.equal(result.code, 1);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.doesNotMatch(result.stdout, /[\u001b\u202e]/);
  }, { listStatus: 503 });
  for (const comments of [[], [ack]]) {
    await withFider(async ({ run, calls }) => {
      const result = await run();
      assert.equal(result.code, 1);
      assert.match(result.stdout, /^FAIL /);
      assert.doesNotMatch(result.stdout, /^DONE /m);
      assert.doesNotMatch(result.stdout, /[\u001b\u202e]/);
      assert.doesNotMatch(result.stdout, /^FORGED/m);
      assert.equal(writes(calls).length, 1);
    }, { comments, writeStatus: 503 });
  }
});

test("R3 reopen publishes its reason with status in one write", async () => {
  await withFider(async ({ run, calls }) => {
    const result = await run();
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(writes(calls), [{ method: "PUT", url: "/api/v1/posts/7/status", body: { status: "open", text: reopenBody() } }]);
  }, { posts: [{ ...post, status: "declined", response }], comments: [ack, reply] });
});

test("R4 only a reply after a proven lifecycle closure reopens a decline", () => {
  for (const value of [undefined, { ...response, user: { id: 42 } }, { ...response, text: "Maintainer declined" }, { ...response, respondedAt: new Date(now).toISOString() }, { ...response, respondedAt: "invalid" }]) {
    const result = plan({ posts: [{ ...post, status: "declined", response: value }], commentsByNumber: { 7: [ack, reply] }, now });
    // JSON.stringify(undefined) is undefined, which makes assert throw
    // ERR_INVALID_ARG_TYPE instead of failing cleanly - so the test would only
    // "pass" by crashing the moment the behaviour under test was removed.
    assert.equal(result.actions.length, 0, JSON.stringify(value) ?? "undefined-response");
  }
  const reopened = plan({ posts: [{ ...post, status: "declined", response }], commentsByNumber: { 7: [ack, reply] }, now });
  assert.equal(reopened.actions.length, 1, "a proven closure plus a later reply must reopen");
  assert.equal(reopened.actions[0].kind, "reopen");
});

test("R5 matching display name or legacy marker cannot replace the bot ID", () => {
  for (const user of [{ id: 42, name: "Krillix" }, { name: "Krillix" }, undefined]) {
    const result = plan({ posts: [post], commentsByNumber: { 7: [{ ...ack, user, content: "saucerjam-lifecycle" }] }, now });
    assert.equal(result.actions[0]?.kind, "ack");
  }
  const renamed = plan({ posts: [post], commentsByNumber: { 7: [{ ...ack, user: { id: 1, name: "Renamed" } }] }, now });
  assert.equal(renamed.actions.length, 1, "a renamed bot account must still be recognised by id");
  assert.equal(renamed.actions[0].kind, "expire");
});

test("R6 enumeration includes posts past 50 and declined reports", async () => {
  const posts = Array.from({ length: 55 }, (_, i) => ({ ...post, number: i + 1, status: "completed" }));
  posts.push({ ...post, number: 56 }, { ...post, number: 57, status: "declined", response });
  await withFider(async ({ run, calls }) => {
    const result = await run(["--json"]);
    assert.equal(result.code, 0, result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.stats.total, 57);
    assert.deepEqual(parsed.actions.map((a) => [a.number, a.kind]), [["57", "reopen"]]);
    assert.equal(writes(calls).length, 0);
  }, { posts, comments: [ack, reply] });
});

test("R7 invalid policy config stops before any write", async () => {
  for (const value of ["-1", "0", "NaN", "Infinity", "1.5"]) {
    await withFider(async ({ run, calls }) => {
      const result = await run(["--apply"], { LIFECYCLE_MAX_ACTIONS: value });
      assert.notEqual(result.code, 0);
      assert.match(result.stdout, /Invalid lifecycle config: maxActionsPerRun/);
      assert.equal(writes(calls).length, 0);
    }, { comments: [] });
  }
});
