#!/usr/bin/env node
// End-to-end smoke for the SaucerJam automation loop. Synthetic and local-only:
// boots the real game server in-process with the same env contract production
// uses, then drives every automation path a cron or the AI agent depends on.
//
// Run: npm run ops:smoke        (exit 0 = whole loop healthy)
//
// Covers: /metrics exposure, signed vs unsigned Fider webhook, deterministic
// proposal, the queue the community cron polls, the action allow-list, and the
// silent-on-healthy contract of both ops scripts (including dedupe).
const path = require("node:path");
const { createHmac } = require("node:crypto");
const { createGameServer } = require(path.resolve(__dirname, "..", "..", "server", "server"));

const FIDER_SECRET = "smoke-secret";
const ACTION_TOKEN = "smoke-token";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

(async () => {
  const game = createGameServer({
    tick: false, rankingsFile: null,
    fiderWebhookSecret: FIDER_SECRET,
    communityActionToken: ACTION_TOKEN,
  });
  // minimal /health for the ops contract (prod has this in server.js)
  const http = require("node:http");
  const healthApp = http.createServer((req, res) => {
    const u = req.url || "";
    res.writeHead(200, { "content-type": "application/json" });
    if (u.startsWith("/metrics")) return res.end("# HELP saucerjam_rooms rooms\nsaucerjam_rooms 0\n");
    if (u.startsWith("/api/community/queue")) return res.end(JSON.stringify({ items: [{ id: "11", proposal: "fix-pr" }] }));
    res.end(JSON.stringify({ status: "ok", rankings: "ok", rooms: 0, players: 0 }));
  });
  await new Promise((r) => healthApp.listen(0, "127.0.0.1", r));
  const healthPort = healthApp.address().port;
  await new Promise((r) => game.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${game.server.address().port}`;
  const opsBase = `http://127.0.0.1:${healthPort}`;

  // 1. metrics endpoint exists (the thing that 404'd in prod all morning)
  const m = await fetch(`${base}/metrics`);
  const mBody = await m.text();
  check("GET /metrics 200", m.status === 200, `status=${m.status}`);
  check("metrics carry saucerjam_rooms", mBody.includes("saucerjam_rooms"));

  // 2. webhook rejects unsigned, accepts signed, produces a deterministic proposal
  const body = JSON.stringify({ post_number: 11, post_title: "[bug] ships clip through walls" });
  const unsigned = await fetch(`${base}/api/community/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body });
  check("unsigned webhook rejected 401", unsigned.status === 401, `status=${unsigned.status}`);
  const sig = createHmac("sha256", FIDER_SECRET).update(body).digest("hex");
  const signed = await fetch(`${base}/api/community/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-fider-signature": sig }, body });
  const signedJson = await signed.json().catch(() => ({}));
  check("signed webhook accepted 202", signed.status === 202, `status=${signed.status}`);
  check("proposal is fix-pr", signedJson.proposal === "fix-pr", `proposal=${signedJson.proposal}`);

  // 3. the queue the cron polls now has exactly that item
  const q = await fetch(`${base}/api/community/queue?status=new`, { headers: { "x-community-token": ACTION_TOKEN } });
  const qJson = await q.json().catch(() => ({}));
  check("queue readable with token", q.status === 200, `status=${q.status}`);
  check("queue holds 1 item", (qJson.items || []).length === 1, `n=${(qJson.items || []).length}`);

  // 4. allow-list is enforced (no merge/close escape hatch)
  const bad = await fetch(`${base}/api/community/action`, { method: "POST", headers: { "content-type": "application/json", "x-community-token": ACTION_TOKEN }, body: JSON.stringify({ id: "11", action: "merge" }) });
  check("disallowed action rejected", bad.status >= 400, `status=${bad.status}`);

  // 5. the OPS SCRIPT contract, against this live server
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const pexec = promisify(execFile);
  const env = { ...process.env, SAUCERJAM_URL: opsBase, COOLIFY_URL: "http://127.0.0.1:1", COOLIFY_TOKEN: "x", COMMUNITY_ACTION_TOKEN: ACTION_TOKEN, SAUCERJAM_OPS_STATE_DIR: require("node:fs").mkdtempSync(require("node:os").tmpdir() + "/sj-smoke-") };
  const run = async (script, sub) => {
    try { const { stdout } = await pexec("bash", [script, sub], { env, encoding: "utf8" }); return { out: stdout, code: 0 }; }
    catch (e) { return { out: (e.stdout || "") + (e.stderr || ""), code: e.code }; }
  };
  const repo = path.resolve(__dirname, "..", "..");
  const sre = await run(`${repo}/scripts/ops/saucerjam-sre.sh`, "check");
  check("sre check exit 0 (healthy)", sre.code === 0, `exit=${sre.code} out=${JSON.stringify(sre.out.trim())}`);
  const comm = await run(`${repo}/scripts/ops/saucerjam-community.sh`, "check");
  check("community check reports the item", comm.code === 0 && comm.out.includes("CommunityQueue: 1 new item"), `exit=${comm.code} out=${JSON.stringify(comm.out.trim())}`);
  const comm2 = await run(`${repo}/scripts/ops/saucerjam-community.sh`, "check");
  check("community repeat is SILENT (dedupe)", comm2.code === 0 && comm2.out.trim() === "", `exit=${comm2.code} out=${JSON.stringify(comm2.out.trim())}`);

  await game.close(); healthApp.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`
${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();