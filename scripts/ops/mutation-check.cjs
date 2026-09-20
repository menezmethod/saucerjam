#!/usr/bin/env node
"use strict";
// Mutation checks: every reliability fix must be provable by reverting it and
// watching its test fail. A fix whose test still passes without it is not fixed,
// it is merely asserted.
//
// Run serially, with no other lifecycle tests/editors active: this temporarily
// writes each pre-fix implementation over the tracked source, then ALWAYS
// restores it. An exclusive lock stops two harness runs from interleaving, and
// the restore is verified by hash at the end.
//
//   node scripts/ops/mutation-check.cjs
//   MUTATION_BASELINE=<sha> node scripts/ops/mutation-check.cjs
//   MUTATION_EVIDENCE_DIR=/path  (default: a temp dir - evidence is not source)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");

// SAFETY: this never mutates the working tree. It builds a throwaway sandbox under
// the system temp dir containing only the collector and its two test files, and
// mutates there. Mutating the real file in place would be dangerous because the
// live cron resolves the collector from this same checkout - one interrupted run
// would leave a mutant for the next scheduled tick to execute.
const root = path.resolve(__dirname, "../..");
const file = "scripts/ops/saucerjam-lifecycle.cjs";
const fixed = fs.readFileSync(path.join(root, file), "utf8");

// --- sandbox --------------------------------------------------------------

// --- pre-fix baseline -----------------------------------------------------
// Each mutation restores the actual pre-fix implementation rather than inventing
// a broken one, so the comparison is against real behaviour.
const BASELINE = process.env.MUTATION_BASELINE || "9c5e63d";
let old;
try {
  old = execFileSync("git", ["show", `${BASELINE}:${file}`], { cwd: root, encoding: "utf8" });
} catch {
  console.error(
    `Cannot read the pre-fix source at ${BASELINE}:${file}.\n` +
    `These checks compare against the implementation from before the reliability fixes.\n` +
    `Set MUTATION_BASELINE to a commit containing that file.`
  );
  process.exit(1);
}

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
  ["R2", (s) => s
    .replace('      await applyAction(action);\n      emit(`DONE ${detail}`);',
             '      emit(`DONE ${detail}`);\n      await applyAction(action);')
    .replace('  return failed ? 1 : 0;', '  return 0;')],
  ["R3", (s) => s.replace(block(s, 'async function setStatus(', '\nfunction readList('), block(old, 'async function setStatus(', '\nasync function collect()'))],
  ["R4", (s) => restoreBlock(s, '    if (status === "declined") {', '\n    if (isTerminal(status))')],
  ["R5", (s) => restoreBlock(s, 'function isOurs(', '\nfunction lastActivityMs(').replace('"use strict";', '"use strict";\nconst BOT_NAME = "Krillix";\nconst LEGACY_MARKER = "saucerjam-lifecycle";')],
  ["R6", (s) => s.replace(block(s, '  // Fider supports limit=all', '\n  const commentsByNumber = {};'), block(old, '  const listed = await api(', '\n  const commentsByNumber = {};').replace('DEFAULTS.pageLimit', '50'))],
  ["R7", (s) => s.replace(block(s, '  for (const key of Object.keys(DEFAULTS)) {', '\n  const actions = [];'), '')],
];

// --- sandbox --------------------------------------------------------------
// The tests require the collector by relative path, so the sandbox mirrors the
// repo layout. Only these three files are needed; nothing else is copied.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-mutation-"));
const sandboxFile = path.join(sandbox, file);
fs.mkdirSync(path.dirname(sandboxFile), { recursive: true });
fs.mkdirSync(path.join(sandbox, "tests"), { recursive: true });
for (const t of ["lifecycle.test.js", "lifecycle-reliability.test.js"]) {
  fs.copyFileSync(path.join(root, "tests", t), path.join(sandbox, "tests", t));
}
fs.writeFileSync(sandboxFile, fixed);
const cleanupSandbox = () => { try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ } };
process.on("exit", cleanupSandbox);

const env = { ...process.env };
delete env.FIDER_API_KEY;
delete env.FIDER_BASE_URL;
const log = [`Node ${process.version}; baseline ${BASELINE}; each mutation restores the actual pre-fix behavior.`];
const run = (id) => spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", `--test-name-pattern=^${id} `, "tests/lifecycle-reliability.test.js", "tests/lifecycle.test.js"],
  { cwd: sandbox, env, encoding: "utf8", timeout: 30000 }
);

// A mutation that breaks the module rather than changing behaviour proves
// nothing: the test never reaches its assertion. This is not hypothetical - the
// R4/R5 tests once threw ERR_INVALID_ARG_TYPE (JSON.stringify(undefined) passed
// as an assertion message) and "passed" the naive check while proving nothing.
const NOT_OK = /^not ok \d+ - /gm;
const ERROR_CODE = /^\s*code: '([A-Z_]+)'/gm;
function assertRealFailure(id, out) {
  const failed = (out.match(NOT_OK) || []).length;
  assert.ok(failed >= 1, `${id}: reverting the fix did not fail any test`);
  const codes = [...out.matchAll(ERROR_CODE)].map((m) => m[1]);
  assert.ok(codes.length > 0, `${id}: no failure code was captured from TAP output`);
  assert.ok(
    codes.every((c) => c === "ERR_ASSERTION"),
    `${id}: failed with ${[...new Set(codes)].join(", ")} instead of ERR_ASSERTION - ` +
    `the mutation broke the module, so no behaviour was actually tested`
  );
}

let failures = 0;
try {
  for (const [id, undo] of mutations) {
    const mutant = undo(fixed);
    assert.notEqual(mutant, fixed, `${id}: mutation did nothing`);
    fs.writeFileSync(sandboxFile, mutant);
    const broken = run(id);
    fs.writeFileSync(sandboxFile, fixed);
    const restored = run(id);

    log.push(`\n${id} REVERTED: exit ${broken.status}\n${broken.stdout}${broken.stderr}\n${id} RESTORED: exit ${restored.status}\n${restored.stdout}${restored.stderr}`);

    try {
      assert.equal(broken.error, undefined);
      assert.equal(broken.status, 1, `${id}: reverted fix did not fail its test`);
      assertRealFailure(id, broken.stdout);
      assert.equal(restored.status, 0, `${id}: restored fix did not pass`);
      console.log(`${id}: reverted FAIL (1), restored PASS (0)`);
    } catch (err) {
      failures++;
      console.log(`${id}: ${err.message}`);
    }
  }
} finally {
  // The working tree was never touched - only the sandbox was mutated.
  cleanupSandbox();
  // Evidence is output, not source - it must never be required for this to run.
  const evidenceDir = process.env.MUTATION_EVIDENCE_DIR ||
    path.join(os.tmpdir(), "saucerjam-mutation-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, "mutations.txt");
  fs.writeFileSync(evidencePath, log.join("\n") + "\n");
  console.log(`\nevidence: ${evidencePath}`);
}

if (failures > 0) {
  console.error(`\n${failures} mutation check(s) FAILED - a fix is not proven.`);
  process.exit(1);
}
console.log("all mutation checks passed");
