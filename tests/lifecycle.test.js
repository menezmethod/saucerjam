"use strict";
// Lifecycle collector: every report must be driven to a bounded outcome, and a
// healthy board must produce no output at all.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { plan, MARKER, ackBody, expireBody } = require("../scripts/ops/saucerjam-lifecycle.cjs");

const NOW = Date.parse("2026-09-19T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

const post = (over = {}) => ({
  number: 7, title: "[bug] something broke", status: "open",
  createdAt: daysAgo(2), ...over,
});
const ours = (when = daysAgo(1)) => ({ content: `${MARKER}\nacked`, createdAt: when });
const theirs = (when = daysAgo(1)) => ({ content: "me too", createdAt: when });

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

test("the published comments carry a machine marker and never quote raw report text", () => {
  for (const body of [ackBody(7), expireBody(7, 90)]) {
    assert.ok(body.includes(MARKER), "comments must be identifiable as ours");
  }
  assert.ok(!ackBody(7).includes("[bug] something broke"));
  assert.match(expireBody(7, 90), /90 days/);
  assert.match(expireBody(7, 90), /reopens immediately/);
});
