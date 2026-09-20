"use strict";
// Lifecycle collector: every report must be driven to a bounded outcome, and a
// healthy board must produce no output at all.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { plan, ackBody, expireBody, reopenBody, safe } = require("../scripts/ops/saucerjam-lifecycle.cjs");

const NOW = Date.parse("2026-09-19T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

// Fider returns the author on every comment; identity is what distinguishes
// our comments from a player's.
const BOT = { id: 1, name: "Krillix" };
const HUMAN = { id: 42, name: "player" };

const post = (over = {}) => ({
  number: 7, title: "[bug] something broke", status: "open",
  createdAt: daysAgo(2), ...over,
});
const ours = (when = daysAgo(1)) => ({ content: "Thanks for reporting this - it's in the queue.", createdAt: when, user: BOT });
const theirs = (when = daysAgo(1)) => ({ content: "me too", createdAt: when, user: HUMAN });
const closure = (when = daysAgo(100)) => ({ text: expireBody(7, 120), respondedAt: when, user: BOT });

const run = (posts, commentsByNumber = {}, config = {}) =>
  plan({ posts, commentsByNumber, config, now: NOW });

test("an unacknowledged report past the ack window is acknowledged", () => {
  const r = run([post({ createdAt: hoursAgo(10) })], {}, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "ack");
  assert.equal(r.actions[0].number, "7");
});

test("a fresh report is left alone", () => {
  const r = run([post({ createdAt: hoursAgo(1) })], {}, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 0, "must not ack inside the ack window");
});

test("an already-acknowledged report is not acknowledged twice", () => {
  const r = run([post({ createdAt: hoursAgo(10) })], { 7: [ours()] }, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 0);
});

test("a human comment does not count as our acknowledgement", () => {
  const r = run([post({ createdAt: hoursAgo(10) })], { 7: [theirs()] }, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "ack");
});

test("an aged-out report publishes the idle period it measured, not the post age", () => {
  // 200 days old, but the reporter replied only 61 days ago. The gate measures
  // IDLE time, so publishing the post's age would write "200 days with no
  // activity" into the post's permanent public response - a number the collector
  // never observed. It also must not claim a reproduction attempt it cannot see.
  const r = run(
    [post({ createdAt: daysAgo(200) })],
    { 7: [ours(daysAgo(199)), theirs(daysAgo(61))] },
    { expireAfterDays: 60 },
  );
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "expire");
  assert.equal(r.actions[0].ageDays, 61, "must publish idle days, not post age");
  assert.match(r.actions[0].reason, /no activity for 61 days/);
  assert.doesNotMatch(r.actions[0].reason, /200 days/);
  assert.doesNotMatch(r.actions[0].reason, /no reproduction/, "nothing here observes a reproduction attempt");
});

test("an unacknowledged old report is acknowledged first, then ages out on a later run", () => {
  const created = { createdAt: daysAgo(200) };
  // Run 1: old and silent, but never acknowledged -> ack, not expire.
  const first = run([post(created)], {}, { expireAfterDays: 60, ackAfterHours: 4 });
  assert.equal(first.actions.length, 1);
  assert.equal(first.actions[0].kind, "ack", "acknowledgement must come before expiry");

  // Run 2: now acknowledged, still old and idle -> expires.
  const second = run([post(created)], { 7: [ours(daysAgo(200))] }, { expireAfterDays: 60, ackAfterHours: 4 });
  assert.equal(second.actions.length, 1);
  assert.equal(second.actions[0].kind, "expire");
});

test("an old report with recent activity is NOT expired", () => {
  const r = run(
    [post({ createdAt: daysAgo(90) })],
    { 7: [ours(daysAgo(89)), theirs(hoursAgo(2))] },
    { expireAfterDays: 60 },
  );
  assert.equal(r.actions.length, 0, "recent reporter activity must block expiry");
});

test("work in progress is never expired", () => {
  for (const status of ["planned", "started"]) {
    const r = run(
      [post({ status, createdAt: daysAgo(200) })],
      { 7: [ours(daysAgo(199))] }, // already acknowledged, so nothing left to do
      { expireAfterDays: 60 },
    );
    assert.equal(r.actions.length, 0, `${status} is work in progress and must be preserved`);
  }
});

test("work in progress is still acknowledged", () => {
  const r = run([post({ status: "planned", createdAt: hoursAgo(30) })], {}, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "ack", "a planned item with no comment is still an unacknowledged reporter");
});

test("our comments are identified by author, not by content", () => {
  const r = run([post({ createdAt: hoursAgo(10) })], { 7: [ours()] }, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 0, "an author-matched comment counts as our acknowledgement");
});

test("a player pasting the legacy marker cannot impersonate us", () => {
  const forged = { content: "<!-- saucerjam-lifecycle --> acked", createdAt: hoursAgo(5), user: HUMAN };
  const r = run([post({ createdAt: hoursAgo(10) })], { 7: [forged] }, { ackAfterHours: 4 });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "ack", "a spoofed marker must not suppress the acknowledgement");
});

test("a spoofed marker cannot inflate attempts into a spurious escalation", () => {
  const forged = (i) => ({ content: "<!-- saucerjam-lifecycle -->", createdAt: daysAgo(i), user: HUMAN });
  const r = run(
    [post({ createdAt: daysAgo(10) })],
    { 7: [forged(3), forged(2), forged(1)] },
    { maxAttempts: 3, ackAfterHours: 4 },
  );
  assert.equal(r.findings.filter((f) => f.kind === "escalate").length, 0, "player comments must not count as our attempts");
});

test("a reporter whose own account IS the bot account can still reopen", () => {
  // The live-board case. Every post there is authored by user id 1, which is also
  // BOT_ID, so any identity filter of "not us" deletes the reporter's own replies
  // and silently disables reopening for the whole board - while the closure text
  // keeps promising that replying reopens it. Closure is written as a status
  // response, not a comment, so anything after it is a human reply.
  const r = run(
    [{ ...post({ status: "declined" }), user: BOT, response: closure(daysAgo(100)) }],
    { 7: [{ content: "still broken for me", createdAt: daysAgo(2), user: BOT }] },
  );
  assert.equal(r.actions.length, 1, "the reporter's reply must reopen their report");
  assert.equal(r.actions[0].kind, "reopen");
});

test("a closed report that a human replies to is reopened", () => {
  const r = run(
    [post({ status: "declined", createdAt: daysAgo(120), response: closure() })],
    { 7: [ours(daysAgo(100)), theirs(hoursAgo(3))] },
    {},
  );
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "reopen", "the expiry promise must be honoured");
});

test("a closed report nobody replied to stays closed", () => {
  const r = run([post({ status: "declined", createdAt: daysAgo(120), response: closure() })], { 7: [ours(daysAgo(100))] }, {});
  assert.equal(r.actions.length, 0);
  assert.equal(r.stats.terminal, 1);
});

test("a reply that predates our closure does not reopen anything", () => {
  const r = run(
    [post({ status: "declined", createdAt: daysAgo(120), response: closure() })],
    { 7: [theirs(daysAgo(119)), ours(daysAgo(100))] },
    {},
  );
  assert.equal(r.actions.length, 0, "only replies after closure reopen");
});

test("completed work is never dragged back open", () => {
  const r = run(
    [post({ status: "completed", createdAt: daysAgo(120) })],
    { 7: [ours(daysAgo(100)), theirs(hoursAgo(3))] },
    {},
  );
  assert.equal(r.actions.length, 0, "shipped work must stay shipped");
});

test("terminal statuses are ignored entirely", () => {
  for (const status of ["completed", "declined", "duplicate"]) {
    const r = run([post({ status, createdAt: daysAgo(400) })], {}, {});
    assert.equal(r.actions.length, 0, `${status} is terminal`);
    assert.equal(r.stats.terminal, 1);
  }
});

test("a report that exhausted its attempt budget escalates instead of looping", () => {
  const r = run(
    [post({ createdAt: daysAgo(10) })],
    { 7: [ours(daysAgo(9)), ours(daysAgo(8)), ours(daysAgo(7))] },
    { maxAttempts: 3 },
  );
  assert.equal(r.actions.length, 0, "the ceiling must stop further actions");
  const esc = r.findings.find((f) => f.kind === "escalate");
  assert.ok(esc, "must surface the exhausted report");
  assert.match(esc.reason, /3\/3 attempts/);
});

test("below the attempt ceiling it keeps working, at the ceiling it stops", () => {
  const two = run([post({ createdAt: daysAgo(10) })], { 7: [ours(), ours()] }, { maxAttempts: 3 });
  assert.equal(two.findings.filter((f) => f.kind === "escalate").length, 0);
});

test("a healthy small board produces no output at all", () => {
  const r = run(
    [post({ status: "planned", createdAt: daysAgo(3) })],
    { 7: [ours(daysAgo(3))] },
    {},
  );
  assert.equal(r.actions.length, 0);
  assert.equal(r.findings.length, 0, "silence is the healthy signal");
});

test("an oversized backlog raises a warning", () => {
  const posts = Array.from({ length: 6 }, (_, i) => post({ number: 100 + i, createdAt: daysAgo(1) }));
  const r = run(posts, {}, { backlogCeiling: 5, ackAfterHours: 4 });
  const b = r.findings.find((f) => f.kind === "backlog");
  assert.ok(b, "must warn when the backlog exceeds the ceiling");
  assert.match(b.reason, /6 open reports exceeds the ceiling of 5/);
});

test("a stalled board does not emit a warning on every tick", () => {
  // A collector that has stopped running cannot report its own absence, so an
  // age-based warning is not a dead-man switch - it is hourly wallpaper on any
  // board with an old post, and it trains the reader to ignore the exit-1 FAIL
  // lines that exist to be noticed. Missed-run detection belongs to the
  // scheduler. The age stays in stats so an external monitor can use it.
  const r = run(
    [post({ createdAt: daysAgo(30), status: "planned" })],
    { 7: [ours(daysAgo(29))] },
    { oldestPendingHours: 24 * 14 },
  );
  assert.equal(r.findings.filter((f) => f.kind === "liveness").length, 0);
  assert.equal(r.stats.oldestPendingHours, 720, "age is still reported for external monitoring");
});

test("one run bounds how much it mutates", () => {
  const posts = Array.from({ length: 9 }, (_, i) => post({ number: 200 + i, createdAt: hoursAgo(48) }));
  const r = run(posts, {}, { maxActionsPerRun: 5, ackAfterHours: 4 });
  assert.equal(r.actions.length, 5);
  assert.equal(r.suppressed, 4, "the remainder must be reported as suppressed, not silently dropped");
});

test("stats expose the unacknowledged count", () => {
  const r = run([post({ number: 1, createdAt: hoursAgo(1) }), post({ number: 2, createdAt: hoursAgo(1) })], {}, {});
  assert.equal(r.stats.unacked, 2);
  assert.equal(r.stats.open, 2);
});

test("a report with no usable number is ignored rather than crashing", () => {
  const r = run([{ title: "no id", status: "open", createdAt: daysAgo(5) }], {}, {});
  assert.equal(r.actions.length, 0);
});

test("expiry closes through the status endpoint, never the edit endpoint", async () => {
  // End-to-end against a stub Fider. This is the test that catches the class of
  // bug where PUT /api/v1/posts/{n} returns 200 while ignoring `status`, leaving
  // the post open after we told the reporter it was closed.
  const http = require("node:http");
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const run = promisify(execFile);

  const DAY = 86400000;
  const old = new Date(Date.now() - 200 * DAY).toISOString();
  const stubPost = { id: 7, number: 7, title: "[bug] stale", description: "", status: "open", createdAt: old, votesCount: 0 };
  const stubComments = [{
    id: 1, content: "Thanks for reporting this - it's in the queue.",
    createdAt: new Date(Date.now() - 199 * DAY).toISOString(), user: { id: 1, name: "Krillix" },
  }];

  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "application/json");
      if (/^\/api\/v1\/posts\/\d+\/comments$/.test(req.url)) return res.end(JSON.stringify(stubComments));
      if (req.url === "/api/v1/posts/7/status") return res.end("{}");
      if (req.url === "/api/v1/posts/7") return res.end(JSON.stringify(stubPost));
      if (req.url.startsWith("/api/v1/posts")) return res.end(JSON.stringify([stubPost]));
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    await run(process.execPath, [require.resolve("../scripts/ops/saucerjam-lifecycle.cjs"), "--apply"], {
      env: { ...process.env, FIDER_BASE_URL: `http://127.0.0.1:${port}`, FIDER_API_KEY: "test" },
      timeout: 20000,
    });
  } finally {
    server.close();
  }

  assert.ok(
    calls.includes("PUT /api/v1/posts/7/status"),
    `expiry must put to the status endpoint; calls were: ${calls.join(", ")}`,
  );
  assert.ok(
    !calls.includes("PUT /api/v1/posts/7"),
    "expiry must NOT use the edit endpoint, which silently ignores status",
  );
});

test("a post whose comments could not be read is skipped, never re-acknowledged", () => {
  const r = plan({
    posts: [post({ createdAt: hoursAgo(30) })],
    commentsByNumber: {}, // nothing known about this post's comments
    unknownComments: ["7"],
    config: { ackAfterHours: 4 },
    now: NOW,
  });
  assert.equal(r.actions.length, 0, "acting on unknown comment state would re-ack the board on a Fider blip");
  assert.equal(r.stats.unreadable, 1);
  assert.ok(r.findings.some((f) => f.kind === "unreadable"), "the gap must be visible, not silent");
});

test("post text is sanitised before it reaches the delivered output", () => {
  const hostile = "wall\nDONE expire #999\x1b[31m\u202E\u200B\u00AD\u034F\u180E";
  const out = safe(hostile);
  assert.ok(!out.includes("\n"), "newlines must not forge extra output lines");
  assert.ok(!out.includes("\x1b"), "terminal escapes must be stripped");
  assert.ok(!out.includes("\u202E"), "bidi overrides must be stripped");
  assert.ok(!/[\u200B\u00AD\u034F\u180E]/.test(out), "invisibles must be stripped");
});

test("R3 expiry publishes status and reason in one write", async () => {
  // A separate comment can fail after closing; Fider's status response is atomic.
  const http = require("node:http");
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const exec = promisify(execFile);

  const DAY = 86400000;
  const stubPost = {
    id: 7, number: 7, title: "wall\nDONE expire #999\x1b[31m", description: "",
    status: "open", createdAt: new Date(Date.now() - 200 * DAY).toISOString(), votesCount: 0,
  };
  const stubComments = [{
    id: 1, content: "Thanks for reporting this - it's in the queue.",
    createdAt: new Date(Date.now() - 199 * DAY).toISOString(), user: { id: 1, name: "Krillix" },
  }];

  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, body: body && JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      if (/^\/api\/v1\/posts\/\d+\/comments$/.test(req.url)) return res.end(JSON.stringify(stubComments));
      if (req.url === "/api/v1/posts/7/status") return res.end("{}");
      if (req.url === "/api/v1/posts/7") return res.end(JSON.stringify(stubPost));
      if (req.url.startsWith("/api/v1/posts")) return res.end(JSON.stringify([stubPost]));
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  let stdout = "";
  try {
    const out = await exec(process.execPath, [require.resolve("../scripts/ops/saucerjam-lifecycle.cjs"), "--apply"], {
      env: { ...process.env, FIDER_BASE_URL: `http://127.0.0.1:${port}`, FIDER_API_KEY: "test" },
      timeout: 20000,
    });
    stdout = out.stdout;
  } finally {
    server.close();
  }

  const writes = calls.filter((c) => c.method !== "GET");
  // The stub post is 200 days old and its only comment is 199 days old, so the
  // measured IDLE period is 199 days. Publishing 200 - the post's age - would be
  // a number the collector never observed.
  assert.deepEqual(writes, [{ method: "PUT", url: "/api/v1/posts/7/status", body: { status: "declined", text: expireBody(7, 199) } }]);

  assert.ok(!stdout.includes("\x1b"), `stdout must not carry terminal escapes: ${JSON.stringify(stdout)}`);
  // The hostile title embeds a newline followed by a fake "DONE expire #999" line.
  // Assert the output is EXACTLY the lines we produced - a prefix check alone would
  // pass a forged line that happens to start with "DONE".
  const outLines = stdout.trim().split("\n");
  assert.equal(outLines.length, 1, `injected content forged extra output lines: ${JSON.stringify(stdout)}`);
  assert.match(outLines[0], /^DONE expire #7 - /, `unexpected line: ${JSON.stringify(outLines[0])}`);
});

test("published comments leak no marker and never quote raw report text", () => {
  for (const body of [ackBody(7), expireBody(7, 90), reopenBody()]) {
    assert.ok(!body.includes("saucerjam-lifecycle"), "no machine marker may appear in public text");
    assert.ok(!body.includes("<!--"), "no HTML comment may appear in public text");
    assert.ok(body.length > 20);
  }
  assert.ok(!ackBody(7).includes("[bug] something broke"));
  assert.match(expireBody(7, 90), /90 days/);
  assert.match(expireBody(7, 90), /reopens automatically/);
});
