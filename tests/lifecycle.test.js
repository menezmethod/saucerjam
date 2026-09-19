"use strict";
// Lifecycle collector: every report must be driven to a bounded outcome, and a
// healthy board must produce no output at all.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { plan, ackBody, expireBody, reopenBody } = require("../scripts/ops/saucerjam-lifecycle.cjs");

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

test("an old, never-reproduced, idle report ages out with a reason", () => {
  const r = run(
    [post({ createdAt: daysAgo(90) })],
    { 7: [ours(daysAgo(89))] },
    { expireAfterDays: 60 },
  );
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "expire");
  assert.match(r.actions[0].reason, /no reproduction/);
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

test("a closed report that a human replies to is reopened", () => {
  const r = run(
    [post({ status: "declined", createdAt: daysAgo(120) })],
    { 7: [ours(daysAgo(100)), theirs(hoursAgo(3))] },
    {},
  );
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].kind, "reopen", "the expiry promise must be honoured");
});

test("a closed report nobody replied to stays closed", () => {
  const r = run([post({ status: "declined", createdAt: daysAgo(120) })], { 7: [ours(daysAgo(100))] }, {});
  assert.equal(r.actions.length, 0);
  assert.equal(r.stats.terminal, 1);
});

test("a reply that predates our closure does not reopen anything", () => {
  const r = run(
    [post({ status: "declined", createdAt: daysAgo(120) })],
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

test("an over-age pending report raises the liveness warning", () => {
  const r = run(
    [post({ createdAt: daysAgo(30), status: "planned" })],
    { 7: [ours(daysAgo(29))] },
    { oldestPendingHours: 24 * 14 },
  );
  const l = r.findings.find((f) => f.kind === "liveness");
  assert.ok(l, "a stalled loop must be visible even when the board is small");
  assert.match(l.reason, /oldest open report is 720h/);
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
