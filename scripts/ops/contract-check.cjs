#!/usr/bin/env node
// Contract check for a SaucerJam deployment (D4). One line per check, non-zero
// exit on any failure. Works against prod or a local `npm run serve`.
//   node scripts/ops/contract-check.cjs [baseUrl]
// The community-queue check needs COMMUNITY_ACTION_TOKEN in the environment.
const base = String(process.argv[2] || "https://saucerjam.com").replace(/\/+$/, "");
const token = process.env.COMMUNITY_ACTION_TOKEN || "";

async function probe(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, body: await res.text() };
}

(async () => {
  const lines = [];
  let failed = 0;
  const report = (ok, name, detail) => {
    if (!ok) failed++;
    lines.push(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
  };
  try {
    const health = await probe(`${base}/health`);
    report(health.status === 200, "/health", `status=${health.status} (want 200)`);
  } catch (error) {
    report(false, "/health", `error=${error.message}`);
  }
  try {
    const metrics = await probe(`${base}/metrics`);
    report(metrics.status === 200 && metrics.body.includes("saucerjam_rooms"), "/metrics",
      `status=${metrics.status} contains_saucerjam_rooms=${metrics.body.includes("saucerjam_rooms")}`);
  } catch (error) {
    report(false, "/metrics", `error=${error.message}`);
  }
  try {
    if (!token) throw new Error("COMMUNITY_ACTION_TOKEN not set");
    const queue = await probe(`${base}/api/community/queue?status=new`, { "x-community-token": token });
    report(queue.status === 200, "/api/community/queue", `status=${queue.status} (want 200 with token)`);
  } catch (error) {
    report(false, "/api/community/queue", `error=${error.message}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(failed ? 1 : 0);
})();
