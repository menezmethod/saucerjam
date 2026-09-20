// The production image copies `server/` into the runtime stage. A server module
// that the Dockerfile does not copy boots the container straight into a crash
// loop (Node throws MODULE_NOT_FOUND on the first require). That is the
// regression that shipped with server/agents/jev.js.
//
// This test reads the Dockerfile's own COPY lines, builds exactly the server
// tree they produce in a temp dir, and resolves every transitive relative
// require from the real entrypoint *without* falling back to the source tree.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Every COPY line that targets ./server, in Dockerfile order.
function serverCopyLines() {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  return dockerfile
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^COPY\s+server(\s|$)/i.test(line));
}

// Reproduce what the COPY lines place in the image's /server directory.
function buildImageServerTree(stage) {
  const files = new Set();
  let wholeTree = false;
  for (const line of serverCopyLines()) {
    // COPY <src...> <dest>
    const parts = line.split(/\s+/).slice(1);
    const dest = parts.pop();
    for (const src of parts) {
      const source = path.join(ROOT, src);
      const target = path.join(stage, dest);
      if (!fs.existsSync(source)) continue;
      if (fs.statSync(source).isDirectory()) {
        // Docker copies a directory's contents recursively, so a single
        // `COPY server ./server` brings every nested module with it.
        fs.mkdirSync(target, { recursive: true });
        fs.cpSync(source, target, { recursive: true });
        for (const file of fs.readdirSync(target, { recursive: true, withFileTypes: true })) {
          if (!file.isDirectory()) files.add(path.relative(stage, path.join(file.parentPath, file.name)));
        }
        if (src === "server" && dest === "./server") wholeTree = true;
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        files.add(path.relative(stage, target));
      }
    }
  }
  return { files, wholeTree };
}

test("the production image can resolve every server require it ships", () => {
  assert.ok(serverCopyLines().length, "the runtime image must copy server code");

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "saucerjam-image-"));
  try {
    const { wholeTree } = buildImageServerTree(stage);
    // The image drops the volume-backed data dir after copying.
    fs.rmSync(path.join(stage, "server", "data"), { recursive: true, force: true });
    // shared/ is copied separately; agents require it as ../../shared.
    fs.cpSync(path.join(ROOT, "shared"), path.join(stage, "shared"), { recursive: true });
    // node_modules must resolve only real dependencies, never source files.
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(stage, "node_modules"));

    const entry = path.join(stage, "server", "server.js");
    assert.ok(fs.existsSync(entry), "server.js must be copied into the image");

    const missing = [];
    const seen = new Set();
    const walk = (file) => {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/require\("(\.[^"]+)"\)/g)) {
        const target = path.resolve(path.dirname(file), match[1]);
        let resolved;
        try {
          // Resolve from the staged file, exactly as the container would.
          resolved = Module.createRequire(file).resolve(target);
        } catch {
          missing.push(`${match[1]} (from ${path.relative(stage, file)})`);
          continue;
        }
        // A resolution that escapes the staged image tree means the file was
        // never copied; the container has no source checkout to fall back on.
        if (resolved.startsWith(ROOT + path.sep) && !resolved.includes("node_modules")) {
          missing.push(`${match[1]} resolved outside the image (${path.relative(ROOT, resolved)})`);
          continue;
        }
        if (!seen.has(resolved)) {
          seen.add(resolved);
          walk(resolved);
        }
      }
    };
    walk(entry);

    assert.equal(
      missing.length,
      0,
      `server modules missing from the production image: ${missing.join("; ")}`,
    );

    if (wholeTree) {
      // COPY server ./server copies everything, so nothing can be forgotten.
      assert.ok(fs.existsSync(path.join(stage, "server", "agents")), "whole-tree copy keeps server/agents");
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});
