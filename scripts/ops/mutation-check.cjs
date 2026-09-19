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

const root = path.resolve(__dirname, "../..");
const file = "scripts/ops/saucerjam-lifecycle.cjs";
const target = path.join(root, file);
const fixed = fs.readFileSync(target, "utf8");
const fixedHash = crypto.createHash("sha256").update(fixed).digest("hex");

// --- exclusive lock -------------------------------------------------------
// Mutating a tracked file in place is the only way these checks can work (the
// tests require the real path). That makes a concurrent `npm test` test a mutant,
// so the window is guarded rather than left open.
const lockPath = path.join(os.tmpdir(), "saucerjam-mutation.lock");
try {
  fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
} catch {
  console.error(
    `Refusing to run: ${lockPath} exists (another mutation run, or a stale lock).\n` +
    `No test may run while the source is mutated. Remove the file if no run is active.`
  );
  process.exit(1);
}
const releaseLock = () => { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } };
process.on("exit", releaseLock);

// --- pre-fix baseline -----------------------------------------------------
// Each mutation restores the actual pre-fix implementation rather than inventing
// a broken one, so the comparison is against real behaviour.
const BASELINE = process.env.MUTATION_BASELINE || "9c5e63d";
let old;
try {
  old = execFileSync("git", ["show", `${BASELINE}:${file}`], { cwd: root, encoding: "utf8" });
} catch {
  releaseLock();
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
const log = [`Node ${process.version}; baseline ${BASELINE}; each mutation restores the actual pre-fix behavior.`];
const run = (id) => spawnSync(
  process.execPath,
  ["--test", `--test-name-pattern=^${id} `, "tests/lifecycle-reliability.test.js", "tests/lifecycle.test.js"],
  { cwd: root, env, encoding: "utf8", timeout: 30000 }
);

// A mutation that breaks the module rather than changing behaviour proves
// nothing: the test never reaches its assertion. This is not hypothetical - the
// R4/R5 tests once threw ERR_INVALID_ARG_TYPE (JSON.stringify(undefined) passed
// as an assertion message) and "passed" the naive check while proving nothing.
const FAIL_COUNT = /^ℹ fail (\d+)/m;
const ERROR_LINE = /^\s*([A-Za-z]*Error)(?: \[([A-Z_]+)\])?:/gm;
function assertRealFailure(id, out) {
  const count = FAIL_COUNT.exec(out);
  assert.ok(count, `${id}: could not read a failure count from the runner output`);
  assert.ok(Number(count[1]) >= 1, `${id}: reverting the fix did not fail any test`);
  const kinds = [...out.matchAll(ERROR_LINE)].map((m) => m[1]);
  assert.ok(kinds.length > 0, `${id}: no failure detail was captured`);
  assert.ok(
    kinds.every((k) => k === "AssertionError"),
    `${id}: failed with ${[...new Set(kinds)].join(", ")} instead of AssertionError - ` +
    `the mutation broke the module, so no behaviour was actually tested`
  );
}

let failures = 0;
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
  // Always leave the tree exactly as we found it, and prove it.
  fs.writeFileSync(target, fixed);
  const after = crypto.createHash("sha256").update(fs.readFileSync(target, "utf8")).digest("hex");
  if (after !== fixedHash) {
    console.error("FATAL: the working file was not restored. Do not trust this tree.");
    process.exitCode = 2;
  }
  // Evidence is output, not source - it must never be required for this to run.
  const evidenceDir = process.env.MUTATION_EVIDENCE_DIR ||
    path.join(os.tmpdir(), "saucerjam-mutation-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, "mutations.txt");
  fs.writeFileSync(evidencePath, log.join("\n") + "\n");
  console.log(`\nevidence: ${evidencePath}`);
  releaseLock();
}

if (failures > 0) {
  console.error(`\n${failures} mutation check(s) FAILED - a fix is not proven.`);
  process.exit(1);
}
console.log("all mutation checks passed");
