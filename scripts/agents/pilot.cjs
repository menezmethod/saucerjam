#!/usr/bin/env node
"use strict";

// Tier-0 agent pilot: an external process that joins a SaucerJam room over the
// same Socket.IO interface a browser uses and actually plays. No server changes
// are required to run it. It observes only the AOI-limited snapshotFor() view
// and submits only sanitized inputs, exactly like a human client.
//
//   node scripts/agents/pilot.cjs --url http://localhost:8080 --name Hal --seconds 90
//   node scripts/agents/pilot.cjs --code ABC123 --name Hal
//   node scripts/agents/pilot.cjs --create --name Hal
//
// Set AGENT_PILOTS=true on the server to have the pilot classed as an agent
// (expands the world, kept out of the human leaderboard).

const { io } = require("socket.io-client");
const { randomBytes } = require("node:crypto");
const { decide } = require("./policy.cjs");

function parseArgs(argv) {
  const args = { url: process.env.SAUCEJAM_URL || "http://localhost:8080", name: null, code: null, create: false, seconds: 120, hz: 20 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === "--url") args.url = value();
    else if (flag === "--name") args.name = value();
    else if (flag === "--code") args.code = String(value()).toUpperCase();
    else if (flag === "--create") args.create = true;
    else if (flag === "--seconds") args.seconds = Number(value());
    else if (flag === "--hz") args.hz = Number(value());
    else if (flag === "--help" || flag === "-h") { printHelp(); process.exit(0); }
    else { console.error(`Unknown flag: ${flag}`); printHelp(); process.exit(2); }
  }
  if (!args.name) args.name = `Agent-${randomBytes(2).toString("hex")}`;
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/agents/pilot.cjs [options]
  --url <url>        Server base URL (default http://localhost:8080)
  --name <callsign>  Pilot name (default random Agent-xxxx)
  --code <CODE>      Join a specific room code
  --create           Create a private room instead of quick play
  --seconds <n>      How long to play before leaving (default 120)
  --hz <n>           Input rate (default 20, server caps at 120)`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = randomBytes(24).toString("hex");
  const socket = io(args.url, { transports: ["websocket"], reconnection: false });

  let playerId = null;
  let latest = null;
  let seq = 0;
  let lastLog = 0;
  let joinedAt = 0;
  let kills = 0,
    deaths = 0;
  let stopping = false;

  const stop = (reason) => {
    if (stopping) return;
    stopping = true;
    const played = joinedAt ? Math.round((Date.now() - joinedAt) / 1000) : 0;
    console.log(`\n[${args.name}] leaving (${reason}) after ${played}s · ${kills} kills / ${deaths} deaths`);
    socket.emit("leave");
    socket.close();
    process.exit(0);
  };

  socket.on("connect", () => {
    const request = { mode: args.create ? "create" : args.code ? "join" : "quick", name: args.name, profileToken: token, agent: true, bots: true };
    if (args.code) request.code = args.code;
    socket.emit("join", request, (ack) => {
      if (!ack || ack.error) {
        console.error(`[${args.name}] join failed: ${ack?.error || "no response"}`);
        stop("join failed");
        return;
      }
      playerId = ack.playerId;
      joinedAt = Date.now();
      console.log(`[${args.name}] joined ${ack.code} as ${playerId} (map ${ack.map?.id}). Ctrl-C to leave.`);
    });
  });

  socket.on("connect_error", (error) => {
    console.error(`[${args.name}] cannot reach ${args.url}: ${error.message}`);
    stop("connection error");
  });

  socket.on("state", (state) => { latest = state; });

  socket.on("events", (events) => {
    for (const event of events) {
      if (event.type === "kill" && event.attacker === playerId) kills++;
      if (event.type === "kill" && event.player === playerId) deaths++;
    }
  });

  // Fixed-rate control loop. Reading the newest state each tick keeps the
  // agent responsive without tying input cadence to snapshot cadence.
  const interval = Math.max(20, Math.round(1000 / Math.max(1, args.hz)));
  const control = setInterval(() => {
    if (!playerId || !latest) return;
    const input = decide(latest, playerId);
    input.seq = ++seq;
    socket.volatile.emit("input", input);
  }, interval);

  const hud = setInterval(() => {
    if (!latest || !playerId) return;
    const me = latest.players?.find((p) => p.id === playerId);
    if (!me) return;
    const now = Date.now();
    if (now - lastLog < 5000) return;
    lastLog = now;
    const enemies = (latest.players || []).filter((p) => p.id !== playerId && p.alive).length;
    console.log(`[${args.name}] hull ${Math.round(me.health)} · energy ${Math.round(me.energy)} · ${kills}K/${deaths}D · ${enemies} in view`);
  }, 1000);

  process.on("SIGINT", () => stop("interrupted"));
  setTimeout(() => stop("time limit"), Math.max(1, args.seconds) * 1000);
  process.on("exit", () => { clearInterval(control); clearInterval(hud); });
}

if (require.main === module) main();

module.exports = { parseArgs };
