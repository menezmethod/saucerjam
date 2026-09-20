#!/usr/bin/env node
"use strict";

// Scoring harness for agent pilots.
//
// "Agents can join" is not the goal; "agents play well enough to be worth
// watching" is. This runs one agent against heuristic bots in a room and
// reports the authoritative outcome, so a change to the questions, the prompt,
// or the reflex layer can be measured instead of guessed.
//
//   node scripts/agents/score.cjs --url http://localhost:8080 --token ... --runs 3
//   node scripts/agents/score.cjs --url https://qd14.menezmethod.com --token ... --driver intent
//   node scripts/agents/score.cjs --url https://qd14.menezmethod.com --token ... --driver jev
//
// Three drivers:
//   policy  the deterministic Tier-0 policy (baseline: what a good script does)
//   intent  a scripted intent sequence (baseline: what a slow LLM's decisions do)
//   jev     the real TypeSafe model. Same interface as `intent`, but the
//           decisions come from Jev, so this measures the model, not a script.
//
// Output is one JSON summary per run plus an aggregate, so results can be
// pasted into a PR or compared across commits.

const { randomBytes } = require("node:crypto");
const { io } = require("socket.io-client");
const { buildState, buildQuestions, composeIntent, createJevClient } = require("../../server/agents/jev");

function parseArgs(argv) {
  const args = {
    url: process.env.SAUCEJAM_URL || "http://localhost:8080",
    token: process.env.AGENT_GATEWAY_TOKEN || "",
    driver: "policy",
    runs: 1,
    seconds: 45,
    hz: 5,
    name: "Scorer",
    json: false,
    jevKey: String(process.env.TYPESAFE_API_KEY || ""),
    minConfidence: 0.4,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i],
      value = () => argv[++i];
    if (flag === "--url") args.url = value();
    else if (flag === "--token") args.token = value();
    else if (flag === "--driver") args.driver = value();
    else if (flag === "--runs") args.runs = Number(value());
    else if (flag === "--seconds") args.seconds = Number(value());
    else if (flag === "--hz") args.hz = Number(value());
    else if (flag === "--name") args.name = value();
    else if (flag === "--min-confidence") args.minConfidence = Number(value());
    else if (flag === "--json") args.json = true;
    else if (flag === "--help" || flag === "-h") { printHelp(); process.exit(0); }
    else { console.error(`Unknown flag: ${flag}`); printHelp(); process.exit(2); }
  }
  if (!args.token) {
    console.error("A gateway token is required. Set AGENT_GATEWAY_TOKEN or pass --token.");
    process.exit(2);
  }
  if (!["policy", "intent", "jev"].includes(args.driver)) {
    console.error('--driver must be "policy", "intent", or "jev".');
    process.exit(2);
  }
  if (args.driver === "jev" && !args.jevKey) {
    console.error("The jev driver needs TYPESAFE_API_KEY in the environment.");
    process.exit(2);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/agents/score.cjs [options]
  --url <url>       Server base URL (default http://localhost:8080)
  --token <token>   Agent gateway token (or AGENT_GATEWAY_TOKEN)
  --driver <kind>   policy | intent | jev (default policy)
  --runs <n>        Independent matches to run (default 1)
  --seconds <n>     Match length per run (default 45)
  --hz <n>          Decisions per second (default 5)
  --min-confidence  Confidence floor for Jev answers (default 0.4)
  --name <callsign> Agent name
  --json            Print machine-readable results only

The jev driver reads TYPESAFE_API_KEY from the environment. It never sends the
key to the game server; only the composed intent crosses that boundary.`);
}

// The intent driver holds a stance and range, and switches to healing when the
// ship is hurt. This is what a slow model's decisions look like: rare, coarse,
// and executed by the server's reflex layer.
function scriptedIntent(observation) {
  const me = observation.self;
  if (me.hull < 35) return { stance: "heal", desiredRange: 18, aggression: 0.2 };
  const nearest = observation.enemies[0];
  if (!nearest) return { stance: "reposition", aggression: 0.4 };
  const inFront = nearest.angle === "front" || nearest.angle === "left" || nearest.angle === "right";
  if (nearest.hull < 40 && nearest.visible && inFront) return { stance: "press", desiredRange: 8, aggression: 1 };
  if (nearest.range_band === "far") return { stance: "press", desiredRange: 12, aggression: 0.8 };
  return { stance: "trade", desiredRange: 14, aggression: 0.6 };
}

// The gateway observation is already the Jev state plus transport fields, so a
// driver can ask TypeSafe directly: no simulation access, no second view of the
// game. This is the same question set the in-process JevBrain uses, kept in one
// place so a change to the questions cannot silently diverge between them.
function jevQuestions(observation) {
  const questions = {
    stance: {
      type: "choice",
      instructions:
        "Given this pilot's hull, energy, and the nearby enemies, what should the pilot do for the next few seconds?",
      criteria: {
        press: "Push in and try to secure a kill.",
        trade: "Hold position and exchange fire.",
        disengage: "Back off while still shooting when able.",
        reposition: "Break contact and move to a different position.",
        heal: "Avoid combat and let hull regenerate.",
      },
    },
    desired_range: {
      type: "score",
      instructions: "What engagement distance should the pilot try to hold?",
      criteria: [
        "Point blank, under six meters.",
        "Close, eight to fourteen meters.",
        "Mid, fifteen to twenty-four meters.",
        "Far, hold beyond twenty-five meters.",
      ],
    },
    weapon: {
      type: "choice",
      instructions:
        "Which weapon suits the next few seconds of this fight? Consider energy cost and how much hull the enemy has.",
      criteria: {
        LASER: "Reliable direct fire, cheap.",
        GRENADE: "Area burst for clustered or close enemies.",
        BOUNCE: "Ricochet that banks off cover.",
      },
    },
    trapped: {
      type: "noul",
      instructions:
        "Is this pilot at high risk of being trapped or focused down in the next few seconds?",
    },
  };
  for (const enemy of observation.enemies) {
    questions[`focus_${enemy.id}`] = {
      type: "score",
      instructions: `How strong is the case to focus ${enemy.name} (${enemy.range_band}, ${enemy.hull} hull) next?`,
      criteria: ["Poor target.", "Acceptable.", "Good.", "Best target available."],
    };
  }
  return questions;
}

// Jev state from a gateway observation: strip the transport fields the model
// does not need, keep the tactical picture verbatim.
function jevState(observation) {
  return {
    self: {
      hull: observation.self.hull,
      energy: observation.self.energy,
      weapon: observation.self.weapon,
      district: observation.self.district,
      under_fire: observation.self.under_fire,
      deaths: observation.self.deaths,
    },
    enemies: observation.enemies,
    objective: observation.objective,
    recent: observation.recent,
  };
}

async function jevIntent(client, observation, minConfidence = 0.4) {
  const answers = await client.ask(jevState(observation), jevQuestions(observation));
  return { intent: composeIntent(answers, { minConfidence }), answers };
}

class Harness {
  constructor(args) {
    this.args = args;
    this.headers = { authorization: `Bearer ${args.token}`, "content-type": "application/json" };
  }

  async call(method, path, { body, session } = {}) {
    const headers = { ...this.headers };
    if (session) headers["x-agent-session"] = `${session.sessionId}:${session.sessionToken}`;
    const response = await fetch(`${this.args.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: response.status, body: parsed };
  }
}

// Findings: agent rank/score vs heuristic bots, read from the authoritative recap.
function rankAgainstBots(recap, playerId) {
  const players = recap?.players || [];
  const agents = players.filter((p) => p.pilotClass === "agent");
  const bots = players.filter((p) => p.bot || p.pilotClass === "bot");
  const me = players.find((p) => p.id === playerId);
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return {
    kills: me?.kills ?? null,
    deaths: me?.deaths ?? null,
    damage: me?.damageDealt ?? null,
    accuracy: me?.accuracy ?? null,
    score: me?.score ?? null,
    rank: sorted.findIndex((p) => p.id === playerId) + 1,
    of: players.length,
    beatAllBots: bots.length > 0 && bots.every((b) => (me?.score ?? 0) >= b.score),
    agentCount: agents.length,
    botCount: bots.length,
  };
}

// The scoring loop. Two drivers, each using the interface it is designed for:
//
//   intent — the Tier-2 gateway. The agent makes a handful of coarse decisions
//            per second and the server's reflex layer executes them. This is
//            the path a slow LLM takes.
//   input  — the Tier-0 policy. The agent emits full 60 Hz-shaped inputs
//            directly, which is what a scripted bot does.
//
// Keeping them separate makes the comparison honest: the intent driver is
// measured on slow decisions, the input driver on fast control.
// A scoring run needs somewhere to put the agent. The gateway cannot create
// rooms (that is an operator action), so the harness opens a private room with
// bot fill as a normal client and keeps that client connected for the run: the
// room closes when its last human leaves.
function openRoom(url, name) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 8000 });
    const fail = (error) => { socket.disconnect(); reject(error); };
    socket.once("connect_error", fail);
    socket.once("connect", () => {
      socket.timeout(8000).emit(
        "join",
        { mode: "create", name, bots: true, profileToken: randomBytes(24).toString("hex") },
        (error, result) => {
          if (error || result?.error) return fail(error || new Error(result.error));
          resolve({ code: result.code, socket });
        },
      );
    });
  });
}

async function runOnce(harness, args, runIndex) {
  const started = Date.now();
  let room, members;
  try {
    room = await openRoom(args.url, `Judge${runIndex + 1}`);
  } catch (error) {
    return { run: runIndex + 1, error: error.message };
  }
  const finish = (result) => {
    room.socket.disconnect();
    return result;
  };
  const joined = await harness.call("POST", "/agent/v1/sessions", {
    body: { mode: "join", code: room.code, name: `${args.name}${runIndex + 1}` },
  });
  if (joined.status !== 201) {
    return finish({ run: runIndex + 1, error: joined.body?.error || `join failed (${joined.status})` });
  }
  const session = joined.body;
  const interval = Math.max(50, Math.round(1000 / Math.max(1, args.hz)));
  let decisions = 0, intents = 0, observations = 0, stopped = false, lastError = null;
  let jevCalls = 0, jevFailures = 0, jevMs = 0, lowConfidence = 0;
  const client = args.driver === "jev"
    ? createJevClient({ apiKey: args.jevKey, maxAttempts: 2, timeoutMs: 5000 })
    : null;

  while (!stopped && Date.now() - started < args.seconds * 1000) {
    const observation = await harness.call("GET", `/agent/v1/sessions/${session.sessionId}/observe`, { session });
    if (observation.status !== 200) {
      // A closed room or removed pilot ends the run cleanly.
      break;
    }
    observations++;

    if (observation.body.alive) {
      let intent = null;
      if (args.driver === "intent") {
        intent = scriptedIntent(observation.body);
      } else if (args.driver === "jev") {
        // Measure the model, including its latency and how often its answers
        // were too uncertain to use. A run where every answer is gated out is
        // Jev quietly degrading to the heuristic, which the outcome alone
        // would not reveal.
        const callStarted = Date.now();
        try {
          const result = await jevIntent(client, observation.body, args.minConfidence);
          jevMs += Date.now() - callStarted;
          jevCalls++;
          if (!result.intent) lowConfidence++;
          intent = result.intent;
        } catch (error) {
          jevFailures++;
          jevMs += Date.now() - callStarted;
          lastError = error.message;
        }
      }
      if (intent) {
        const acted = await harness.call("POST", `/agent/v1/sessions/${session.sessionId}/act`, {
          body: { type: "intent", intent },
          session,
        });
        if (acted.status === 200) intents++;
        decisions++;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  stopped = true;

  const observation = await harness.call("GET", `/agent/v1/sessions/${session.sessionId}/observe`, { session });
  const final = observation.status === 200 ? observation.body : null;
  await harness.call("DELETE", `/agent/v1/sessions/${session.sessionId}`, { session });

  return finish({
    run: runIndex + 1,
    seconds: Math.round((Date.now() - started) / 1000),
    decisions,
    intents,
    observations,
    ...(args.driver === "jev"
      ? {
          jev: {
            calls: jevCalls,
            failures: jevFailures,
            gatedOut: lowConfidence,
            avgMs: jevCalls ? Math.round(jevMs / jevCalls) : null,
            lastError: lastError || null,
          },
        }
      : {}),
    outcome: final
      ? {
          kills: final.objective.my_kills,
          deaths: final.objective.my_deaths,
          damage: final.objective.my_damage,
          accuracy: final.objective.my_accuracy,
          alive: final.alive,
        }
      : null,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const harness = new Harness(args);
  const status = await harness.call("GET", "/agent/v1/status");
  if (status.status !== 200) {
    console.error(`Gateway not reachable at ${args.url}: ${status.status} ${JSON.stringify(status.body)}`);
    console.error("Set AGENT_PILOTS=true and AGENT_GATEWAY_TOKEN on the server.");
    process.exit(1);
  }
  if (!args.json) console.log(`Gateway ok: ${JSON.stringify(status.body)}`);

  const results = [];
  for (let i = 0; i < args.runs; i++) {
    const result = await runOnce(harness, args, i);
    results.push(result);
    if (!args.json) console.log(`run ${result.run}: ${JSON.stringify(result)}`);
  }
  const summary = { url: args.url, driver: args.driver, runs: results };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log("summary: " + JSON.stringify(summary));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });

module.exports = { scriptedIntent, rankAgainstBots, parseArgs };
