"use strict";
// A4: the community loop contract is the single source of truth, and the SRE
// docs must not authorise an automatic production deploy.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("docs/COMMUNITY-LOOP-CONTRACT.md pins lifecycle, invariant, retries, and forbidden actions", () => {
  const contract = read("docs/COMMUNITY-LOOP-CONTRACT.md");
  assert.ok(contract.split("\n").length <= 120, "contract must stay short (<= 120 lines)");
  for (const state of ["new", "in_progress", "actioned", "done", "request_info", "dead_letter"]) {
    assert.match(contract, new RegExp(`\\b${state}\\b`), `missing lifecycle state: ${state}`);
  }
  assert.match(contract, /terminal/i);
  for (const topic of ["invariant", "\\back\\b", "idempotenc", "backoff", "dead.?letter", "attempt"]) {
    assert.match(contract, new RegExp(topic, "i"), `missing contract topic: ${topic}`);
  }
  assert.match(contract, /2026-09-19T16:30:00Z/, "must state the enforcement start instant");
  for (const forbidden of ["merge", "main", "deploy"]) {
    assert.match(contract, new RegExp(`\\b${forbidden}\\b`, "i"), `missing forbidden action: ${forbidden}`);
  }
});

test("SRE docs do not authorise an automatic Coolify deploy", () => {
  const sre = read("docs/SRE.md");
  assert.match(sre, /no automatic deploy/i, "SRE.md must forbid automatic deploys");
  // The endpoint may only appear in a line that forbids it.
  for (const line of sre.split("\n").filter((l) => /\/api\/v1\/deploy/.test(l))) {
    assert.match(line, /\b(never|no|not)\b/i, `deploy endpoint mentioned without a prohibition: ${line.trim()}`);
  }
});
