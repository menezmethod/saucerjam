#!/usr/bin/env node
"use strict";
// Deterministic auto-merge gate. Runs from the default branch inside
// .github/workflows/automerge.yml, never from PR code. A PR is eligible only if
// every changed file (old and new path) is inside the low-risk allowlist and
// outside the denylist. Labels, PR text and agent output cannot widen this.
//
// Usage: automerge-eligible.cjs <files.json>   (gh api .../files --paginate --slurp)
// Exit 0 = eligible, 1 = not eligible (reason on stdout), 2 = bad input.

// ponytail: path prefixes, not globs — nothing here needs more than startsWith.
const ALLOW = ["src/styles/", "src/index.html", "src/manifest.webmanifest", "docs/", "README.md", "CHANGELOG.md"];
// Anything that grants, describes or runs agent/release authority stays human-reviewed.
const DENY = [
  "docs/AUTOMATION.md", "docs/SRE.md", "docs/COMMUNITY-", "docs/HERMES-", "docs/LOOP", "docs/RELEASE-LOOP.md",
  "docs/HOSTING", "docs/loop/", "docs/agent-work/",
];
const MAX_FILES = 20;

function verdict(files) {
  if (!Array.isArray(files) || files.length === 0) return "no changed files reported";
  if (files.length > MAX_FILES) return `too many files (${files.length} > ${MAX_FILES})`;
  for (const f of files) {
    if (!f || typeof f.filename !== "string") return "malformed file entry";
    for (const p of [f.filename, f.previous_filename].filter((x) => x !== undefined)) {
      if (typeof p !== "string" || !p) return "malformed file entry";
      if (p.includes("..")) return `path traversal: ${p}`;
      if (DENY.some((d) => p.startsWith(d))) return `protected path: ${p}`;
      if (!ALLOW.some((a) => p === a || (a.endsWith("/") && p.startsWith(a)))) return `outside allowlist: ${p}`;
    }
  }
  return null;
}

module.exports = { verdict, ALLOW, DENY };

if (require.main === module) {
  let files;
  try {
    // --paginate --slurp yields an array of pages; flatten it.
    files = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8")).flat();
  } catch (error) {
    process.stdout.write(`bad input: ${error.message}\n`);
    process.exit(2);
  }
  const reason = verdict(files);
  process.stdout.write(reason ? `not eligible: ${reason}\n` : "eligible\n");
  process.exit(reason ? 1 : 0);
}
