#!/usr/bin/env node
"use strict";
// Run serially, with no other lifecycle tests/editors active: this temporarily
// restores each pre-fix implementation, then ALWAYS restores the working file.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const file = "scripts/ops/saucerjam-lifecycle.cjs";
const target = path.join(root, file);
const fixed = fs.readFileSync(target, "utf8");
const old = execFileSync("git", ["show", `9c5e63d:${file}`], { cwd: root, encoding: "utf8" });
const block = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing mutation anchors: ${start} / ${end}`);
  return source.slice(a, b);
};
const restoreBlock = (source, start, end) => source.replace(block(source, start, end), block(old, start, end));
const mutations = [
  ["R1", (s) => s.replace('  return JSON.parse(text);', '  try { return JSON.parse(text); } catch { return null; }')
    .replace(block(s, 'function readList(', '\nasync function collect()'), 'function readList(value, key) { return Array.isArray(value) ? value : (value && value[key]) || []; }\n')
    .replace(block(s, '      const comments = readList(', '\n    } catch {'), '      commentsByNumber[number] = Array.isArray(res) ? res : (res && res.comments) || [];')],
  ["R2", (s) => restoreBlock(s, '  const lines = [];', '\n}\n\nmodule.exports')],
  ["R3", (s) => s.replace(block(s, 'async function setStatus(', '\nfunction readList('), block(old, 'async function setStatus(', '\nasync function collect()'))],
  ["R4", (s) => restoreBlock(s, '    if (status === "declined") {', '\n    if (isTerminal(status))')],
  ["R5", (s) => restoreBlock(s, 'function isOurs(', '\nfunction lastActivityMs(').replace('"use strict";', '"use strict";\nconst BOT_NAME = "Krillix";\nconst LEGACY_MARKER = "saucerjam-lifecycle";')],
  ["R6", (s) => s.replace(block(s, '  // Fider supports limit=all', '\n  const commentsByNumber = {};'), block(old, '  const listed = await api(', '\n  const commentsByNumber = {};').replace('DEFAULTS.pageLimit', '50'))],
  ["R7", (s) => s.replace(block(s, '  for (const key of Object.keys(DEFAULTS)) {', '\n  const actions = [];'), '')],
];
const env = { ...process.env };
delete env.FIDER_API_KEY;
delete env.FIDER_BASE_URL;
const log = [`Node ${process.version}; baseline 9c5e63d; each mutation restores the actual pre-fix behavior.`];
const run = (id) => spawnSync(process.execPath, ["--test", `--test-name-pattern=^${id} `, "tests/lifecycle-reliability.test.js", "tests/lifecycle.test.js"], { cwd: root, env, encoding: "utf8", timeout: 30000 });
try {
  for (const [id, undo] of mutations) {
    const mutant = undo(fixed);
    assert.notEqual(mutant, fixed, `${id}: mutation did nothing`);
    let broken;
    try {
      fs.writeFileSync(target, mutant);
      broken = run(id);
    } finally {
      fs.writeFileSync(target, fixed);
    }
    const restored = run(id);
    log.push(`\n${id} REVERTED: exit ${broken.status}\n${broken.stdout}${broken.stderr}\n${id} RESTORED: exit ${restored.status}\n${restored.stdout}${restored.stderr}`);
    assert.equal(broken.error, undefined);
    assert.equal(broken.status, 1, `${id}: reverted fix did not fail its test`);
    assert.match(broken.stdout, /ERR_ASSERTION/, `${id}: must fail an assertion, not a syntax/import error`);
    assert.equal(restored.status, 0, `${id}: restored fix did not pass`);
    console.log(`${id}: reverted FAIL (1), restored PASS (0)`);
  }
} finally {
  fs.writeFileSync(target, fixed);
  fs.writeFileSync(path.join(root, "docs/ship-evidence/mutations.txt"), log.join("\n") + "\n");
}
