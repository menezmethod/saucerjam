"use strict";
// A7: any string derived from a Fider post that reaches an alert, a log line,
// or a public artifact is NFKC-normalised, stripped of control/bidi/zero-width
// and ANSI escapes, whitespace-collapsed, and length-capped.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { guardPublicText, formatQueueDetail } = require("../server/community");

const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

test("guardPublicText normalises, strips escapes/controls, and caps", () => {
  assert.equal(guardPublicText("  \u202eEVIL\u202c\u200b\u200d\u2066x\u2069\u001b[31mRED\u001b[0m \u0007  "), "EVILxRED");
  assert.equal(guardPublicText("ＡＢＣ"), "ABC", "NFKC normalisation");
  assert.equal(guardPublicText("a\nb\tc"), "a b c", "whitespace collapses");
  assert.equal(guardPublicText(undefined), "");
  const capped = guardPublicText("\u202e" + "A".repeat(5000));
  assert.equal(Array.from(capped).length, 200, "capped to 200 code points");
  assert.equal(capped, "A".repeat(200));
});

test("formatQueueDetail caps and neutralises a hostile title, body, and URL", () => {
  const item = {
    id: 7,
    title: "\u202eOwned\u202c\u200b\u001b[31m" + "T".repeat(5000),
    description: "B".repeat(5000) + "\u2069\u001b[0m",
    url: "https://community.example/posts/7\u202e",
  };
  const out = formatQueueDetail(item);
  assert.doesNotMatch(out, FORBIDDEN, "no control/bidi/zero-width characters survive");
  assert.doesNotMatch(out, /\u001b/, "no escape characters survive");
  assert.doesNotMatch(out, /T{201}/, "the title is length-capped");
  assert.ok(Array.from(out).length <= 700, `rendered line is bounded (${Array.from(out).length})`);
  assert.match(out, /#7/);
});

test("the ops community alert path renders guarded post text", () => {
  const OPS = path.join(__dirname, "..", "scripts", "ops", "saucerjam-ops.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-guard-"));
  const title = "\u202eOwned\u202c\u200b\u001b[31m" + "T".repeat(5000);
  const fixture = {
    health: { status: 200, body: "{}" },
    metrics: { status: 200, body: "saucerjam_rooms 0\n" },
    queue: {
      status: 200,
      body: JSON.stringify({
        items: [{ id: "7", number: 7, title, description: "B".repeat(5000), url: "https://community.example/posts/7\u202e" }],
      }),
    },
  };
  const fixturePath = path.join(tmp, "fx.json");
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const res = spawnSync("node", [OPS, "community", "check"], {
    encoding: "utf8",
    env: { ...process.env, SAUCERJAM_FIXTURE: fixturePath, SAUCERJAM_OPS_STATE_DIR: path.join(tmp, "state") },
  });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  const out = res.stdout.replace(/\n+$/, ""); // the line terminator is not byproduct text
  assert.match(out, /CommunityQueue: 1 new item/);
  // The message is multi-line by design, so a line feed is the only permitted
  // control character. Everything else — bidi overrides, zero-width joiners,
  // ANSI escapes — must have been stripped before the text reached stdout.
  assert.doesNotMatch(
    out.replace(/\n/g, ""),
    FORBIDDEN,
    "ops output must not carry control/bidi/zero-width characters",
  );
  assert.ok(out.length <= 1200, `ops output is bounded (${out.length})`);
});
