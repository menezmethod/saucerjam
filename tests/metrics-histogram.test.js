"use strict";
// A3: Prometheus histogram `_bucket` series must be cumulative (le = count of
// observations <= le), and overflow must count toward +Inf only.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Metrics } = require("../server/metrics");

test("histogram buckets render cumulatively and overflow counts only toward +Inf", () => {
  const metrics = new Metrics();
  const hist = metrics.histogram("test_cumulative_seconds", "test fixture", [1, 2]);
  for (const value of [0.5, 0.75, 1.5, 3]) hist.observe({}, value);

  const text = metrics.render();
  const sample = (le) => {
    const prefix = `test_cumulative_seconds_bucket{le="${le}"}`;
    const line = text.split("\n").find((l) => l.startsWith(prefix));
    assert.ok(line, `missing bucket ${le}`);
    return Number(line.split(" ").pop());
  };

  assert.equal(sample(1), 2, "le=1 counts 0.5 and 0.75");
  assert.equal(sample(2), 3, "le=2 is cumulative (adds 1.5)");
  assert.equal(sample("+Inf"), 4, "overflow 3 counts toward +Inf only");
  const count = Number(text.split("\n").find((l) => l.startsWith("test_cumulative_seconds_count ")).split(" ").pop());
  const sum = Number(text.split("\n").find((l) => l.startsWith("test_cumulative_seconds_sum ")).split(" ").pop());
  assert.equal(count, 4);
  assert.equal(sum, 5.75);
});
