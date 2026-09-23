"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verdict } = require("../scripts/ops/automerge-eligible.cjs");

const f = (filename, previous_filename) => ({ filename, ...(previous_filename ? { previous_filename } : {}) });

test("allowlisted presentation and docs changes are eligible", () => {
  assert.equal(verdict([f("src/styles/hud.css"), f("docs/ROADMAP.md"), f("README.md")]), null);
});

test("anything outside the allowlist or on the denylist blocks", () => {
  for (const path of [".github/workflows/ci.yml", "server/server.js", "package.json", "Dockerfile",
    "scripts/ops/automerge-eligible.cjs", "src/world/Physics.js", "docs/SRE.md", "docs/COMMUNITY-QUEUE.md",
    "deploy/hermes/saucerjam-community-triage.md", "docs/agent-work/x.md", "docs/../server/x.js"]) {
    assert.ok(verdict([f(path)]), `${path} must not be eligible`);
  }
});

test("a rename out of a protected path blocks even if the new path is allowed", () => {
  assert.match(verdict([f("docs/notes.md", "server/server.js")]), /outside allowlist/);
});

test("empty, malformed and oversized inputs fail closed", () => {
  assert.ok(verdict([]));
  assert.ok(verdict(null));
  assert.ok(verdict([{}]));
  assert.ok(verdict([{ filename: "docs/a.md", previous_filename: "" }]));
  assert.ok(verdict(Array.from({ length: 21 }, (_, i) => f(`docs/${i}.md`))));
});
