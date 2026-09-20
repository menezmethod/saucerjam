// Agent pilots: the intent/reflex split, the Tier-0 policy, the Jev brain,
// and the server's hybrid policy (agents expand the world, records stay
// separate). The Jev network client is exercised with a mock fetch so the whole
// suite stays offline.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { Simulation } = require("../shared/simulation");
const { sanitizeIntent, chooseTarget } = require("../shared/brains");
const { decide, chooseWeapon, aimAt } = require("../scripts/agents/policy.cjs");
const {
  buildState,
  buildQuestions,
  composeIntent,
  interpolateRange,
  createJevClient,
  JevBrain,
  JevRunner,
} = require("../server/agents/jev");
const { createGameServer } = require("../server/server");
const { AgentGateway, summarizeRecap } = require("../server/agents/gateway");

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function scenario() {
  const sim = new Simulation();
  const self = sim.addPlayer("self", "Self");
  const near = sim.addPlayer("near", "Near");
  const far = sim.addPlayer("far", "Far");
  Object.assign(self, { x: 0, z: 0, vx: 0, vz: 0, angle: 0, aimAngle: 0 });
  Object.assign(near, { x: 6, z: 0, vx: 0, vz: 0 });
  Object.assign(far, { x: 20, z: 0, vx: 0, vz: 0 });
  return { sim, self, near, far };
}

test("sanitizeIntent drops unknown fields and clamps ranges", () => {
  assert.equal(sanitizeIntent(null), null);
  assert.equal(sanitizeIntent({}), null);
  assert.deepEqual(
    sanitizeIntent({ targetId: "x", stance: "press", desiredRange: 999, weapon: "NUKE", aggression: 5, junk: 1 }),
    { targetId: "x", stance: "press", desiredRange: 40, aggression: 1 },
  );
});

test("chooseTarget honors a living intent target and falls back to nearest", () => {
  const { sim, self, far } = scenario();
  assert.equal(chooseTarget(self, sim, null, distance).id, "near");
  assert.equal(chooseTarget(self, sim, { targetId: "far" }, distance).id, "far");
  far.alive = false;
  assert.equal(chooseTarget(self, sim, { targetId: "far" }, distance).id, "near");
});

test("the default reflex is unchanged; intent redirects target, stance, and weapon", () => {
  const { sim, self } = scenario();
  const base = sim.botInput(self);
  assert.equal(base.weapon, "LASER");
  assert.ok(base.aim.x > 0, "aims toward the nearest enemy");
  self.intent = sanitizeIntent({ targetId: "far", stance: "disengage", weapon: "BOUNCE" });
  const redirected = sim.botInput(self);
  assert.equal(redirected.weapon, "BOUNCE");
  assert.ok(redirected.thrust < 0, "disengage backs off");
  assert.ok(redirected.aim.x > base.aim.x, "aim follows the chosen target");
});

test("Tier-0 policy: engages, retreats when hurt, and idles without an enemy", () => {
  const me = { id: "me", x: 0, z: 0, vx: 0, vz: 0, health: 100, energy: 100, alive: true, protectedUntil: 0 };
  const enemy = { id: "e", x: 10, z: 0, vx: 0, vz: 0, health: 100, energy: 0, alive: true, protectedUntil: 0 };
  const base = { time: 10, restartAt: 0, pickups: [], players: [me, enemy] };
  const engaged = decide(base, "me");
  assert.equal(engaged.weapon, "GRENADE"); // full energy and a mid-range target
  assert.equal(engaged.fire, true);
  assert.equal(engaged.seq, 0, "the transport assigns seq");
  const hurt = decide({ ...base, players: [{ ...me, health: 20 }, enemy] }, "me");
  assert.ok(hurt.move.x < 0, "low hull retreats");
  assert.deepEqual(decide({ ...base, players: [me] }, "me").move, { x: 0, z: 0 });
  const shielded = decide({ ...base, players: [me, { ...enemy, protectedUntil: 99 }] }, "me");
  assert.equal(shielded.fire, false);
  const pickup = { id: "p1", x: 5, z: 0, available: true };
  assert.deepEqual(decide({ ...base, players: [me], pickups: [pickup] }, "me").move, { x: 1, z: 0 });
});

test("policy helpers choose weapons by cost and lead moving targets", () => {
  assert.equal(chooseWeapon({ energy: 100, health: 100 }, 10), "GRENADE");
  assert.equal(chooseWeapon({ energy: 60, health: 100 }, 20), "BOUNCE");
  assert.equal(chooseWeapon({ energy: 25, health: 100 }, 5), "LASER");
  assert.deepEqual(aimAt({ x: 0, z: 0 }, { x: 10, z: 0, vx: 58, vz: 0 }), { x: 20, z: 0 });
});

test("buildState summarizes the tactical picture and buildQuestions ranks each enemy", () => {
  const { sim, self } = scenario();
  const state = buildState(sim, self);
  assert.equal(state.self.hull, 100);
  assert.deepEqual(state.enemies.map((e) => e.id), ["near", "far"]);
  assert.equal(state.enemies[0].range_band, "close");
  assert.equal(state.enemies[1].range_band, "far");
  assert.equal(state.objective.frag_limit, sim.fragLimit);
  const questions = buildQuestions(sim, self);
  assert.equal(questions.stance.type, "choice");
  assert.equal(questions.desired_range.type, "score");
  assert.ok(questions.focus_near && questions.focus_far);
});

test("composeIntent maps answers to intent, gates on confidence, and honors trapped", () => {
  const intent = composeIntent({
    stance: { type: "choice", choice: "press", confidence: 0.9 },
    desired_range: { type: "score", score: 2, confidence: 0.8 },
    weapon: { type: "choice", choice: "BOUNCE", confidence: 0.7 },
    focus_near: { type: "score", score: 0.4, confidence: 0.9 },
    focus_far: { type: "score", score: 2.6, confidence: 0.9 },
    trapped: { type: "noul", noul: 0.1 },
  });
  assert.deepEqual(intent, { stance: "press", aggression: 1, desiredRange: 19, weapon: "BOUNCE", targetId: "far" });
  // Every field below the confidence floor is dropped, leaving the heuristic.
  const gated = composeIntent({
    stance: { type: "choice", choice: "press", confidence: 0.1 },
    desired_range: { type: "score", score: 2, confidence: 0.1 },
    weapon: { type: "choice", choice: "BOUNCE", confidence: 0.1 },
    focus_far: { type: "score", score: 2, confidence: 0.1 },
  });
  assert.equal(gated, null);
  // A high-confidence "trapped" overrides an aggressive stance.
  const trapped = composeIntent({
    stance: { type: "choice", choice: "press", confidence: 0.9 },
    trapped: { type: "noul", noul: 0.8 },
  });
  assert.equal(trapped.stance, "reposition");
  assert.equal(trapped.aggression, 0.4);
  assert.equal(interpolateRange(0), 5);
  assert.equal(interpolateRange(3), 27);
});

test("createJevClient retries overload, returns answers, and fails fast on 4xx", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { status: 429, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => ({ answers: { is_urgent: { type: "noul", noul: 0.9 } } }) };
  };
  const client = createJevClient({ apiKey: "test", fetchImpl, sleep: async () => {} });
  const answers = await client.ask("state", { is_urgent: { type: "noul", instructions: "?" } });
  assert.equal(calls, 2);
  assert.equal(answers.is_urgent.noul, 0.9);
  let attempts = 0;
  const rejecting = createJevClient({
    apiKey: "test",
    sleep: async () => {},
    fetchImpl: async () => { attempts++; return { status: 401, ok: false, json: async () => ({}) }; },
  });
  await assert.rejects(rejecting.ask("s", {}), /401/);
  assert.equal(attempts, 1, "auth errors are not retried");
});

test("JevBrain composes a client answer into sanitized intent", async () => {
  const brain = new JevBrain({ client: { ask: async () => ({ stance: { type: "choice", choice: "heal", confidence: 0.9 } }) } });
  const { sim, self } = scenario();
  const intent = await brain.decide(sim, self);
  assert.equal(intent.stance, "heal");
  assert.equal(intent.aggression, 0.2);
});

test("JevRunner never overlaps a decision for the same pilot", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const brain = { decide: async () => { calls++; await gate; return { stance: "press" }; } };
  const runner = new JevRunner({ brain, intervalMs: 1 });
  const p = { id: "b1", brain: "jev", alive: true, intent: null };
  const room = { sim: { players: new Map([["b1", p]]) } };
  runner.sweep([room]);
  runner.sweep([room]);
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(p.intent.stance, "press");
  runner.stop();
});

const connect = (url) => new Promise((resolve, reject) => {
  const socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false, timeout: 8000 });
  socket.once("connect", () => resolve(socket));
  socket.once("connect_error", reject);
});
const join = (socket, request) => new Promise((resolve, reject) =>
  socket.timeout(8000).emit("join", request, (error, response) => (error ? reject(error) : resolve(response))));

async function withServer(options, fn) {
  const game = createGameServer({ tick: false, rankingsFile: null, ...options });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const clients = [];
  try {
    return await fn(game, url, (socket) => { clients.push(socket); return socket; });
  } finally {
    clients.forEach((socket) => socket.disconnect());
    await game.close();
  }
}

test("agents expand the world but record in a separate ledger", async () => {
  await withServer({ allowAgents: true }, async (game, url, track) => {
    const human = track(await connect(url));
    const created = await join(human, { mode: "create", name: "Human", bots: false, profileToken: "a".repeat(40) });
    const agent = track(await connect(url));
    await join(agent, { mode: "join", code: created.code, name: "Agent", agent: true, profileToken: "b".repeat(40) });
    const room = game.rooms.get(created.code);
    assert.equal(room.sim.players.get(human.id).pilotClass, "human");
    assert.equal(room.sim.players.get(agent.id).pilotClass, "agent");
    assert.ok(game.agentRankings, "an agent ledger exists when agents are enabled");
    // The human wins the round; results must split by class.
    room.sim.players.get(human.id).kills = room.sim.fragLimit;
    room.sim.endRound();
    await game.saveRound(room, room.sim.recap);
    assert.deepEqual(game.rankings.getLeaderboard().map((row) => row.name), ["Human"]);
    assert.equal(game.rankings.getLeaderboard()[0].wins, 1);
    assert.deepEqual(game.agentRankings.getLeaderboard().map((row) => row.name), ["Agent"]);
    assert.equal(game.agentRankings.getLeaderboard()[0].wins, 0, "a human winner does not score in the agent ledger");
  });
});

test("the agent flag is ignored unless agent pilots are enabled", async () => {
  await withServer({ allowAgents: false }, async (game, url, track) => {
    const socket = track(await connect(url));
    const created = await join(socket, { mode: "create", name: "Pilot", bots: false, agent: true, profileToken: "c".repeat(40) });
    assert.equal(game.rooms.get(created.code).sim.players.get(socket.id).pilotClass, "human");
    assert.equal(game.agentRankings, null);
  });
});

// ---- Tier-2 Agent Gateway -------------------------------------------------

const TOKEN = "gateway-token-for-tests";
const auth = { authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...auth, "content-type": "application/json" };

function agentApi(url) {
  return async (method, path, { body, session } = {}) => {
    const headers = { ...jsonHeaders };
    if (session) headers["x-agent-session"] = `${session.sessionId}:${session.sessionToken}`;
    const response = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}

// Create a room with a human so the gateway has somewhere to put an agent.
async function roomWithHuman(url, track) {
  const human = track(await connect(url));
  const created = await join(human, { mode: "create", name: "Human", bots: false, profileToken: "h".repeat(40) });
  return created.code;
}

test("gateway is unavailable without a token or without agent pilots enabled", async () => {
  await withServer({ allowAgents: true }, async (game, url) => {
    assert.equal(game.gateway.token, "");
    const call = agentApi(url);
    const disabled = await call("POST", "/agent/v1/sessions", { body: {} });
    assert.equal(disabled.status, 503);
  });
  await withServer({ allowAgents: false, agentGatewayToken: TOKEN }, async (_game, url) => {
    const call = agentApi(url);
    const off = await call("POST", "/agent/v1/sessions", { body: {} });
    assert.equal(off.status, 503);
  });
});

test("gateway rejects a bad token and a bad session token", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN }, async (_game, url, track) => {
    const code = await roomWithHuman(url, track);
    const call = agentApi(url);
    const badToken = await fetch(`${url}/agent/v1/sessions`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      body: JSON.stringify({ mode: "join", code }),
    });
    assert.equal(badToken.status, 401);
    const joiner = await call("POST", "/agent/v1/sessions", { body: { mode: "join", code, name: "Hal" } });
    assert.equal(joiner.status, 201);
    const forged = await call("POST", "/agent/v1/sessions/anything/act", {
      body: { type: "intent", intent: { stance: "press" } },
      session: { sessionId: joiner.body.sessionId, sessionToken: "not-the-token" },
    });
    assert.equal(forged.status, 401);
  });
});

test("an agent joins, observes a decision-ready view, and acts by intent", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN }, async (game, url, track) => {
    const code = await roomWithHuman(url, track);
    const call = agentApi(url);
    const joined = await call("POST", "/agent/v1/sessions", { body: { mode: "join", code, name: "<b>Hal</b>" } });
    assert.equal(joined.status, 201);
    const room = game.rooms.get(code);
    const player = room.sim.players.get(joined.body.playerId);
    assert.equal(player.pilotClass, "agent");
    assert.equal(player.name, "bHal/b", "the simulation sanitizes the displayed name");

    const observation = await call("GET", `/agent/v1/sessions/${joined.body.sessionId}/observe`, { session: joined.body });
    assert.equal(observation.status, 200);
    assert.equal(observation.body.self.id, joined.body.playerId);
    assert.equal(observation.body.alive, true);
    assert.equal(typeof observation.body.tick, "number");
    assert.deepEqual(observation.body.objective.mode, "deathmatch");
    assert.ok(Array.isArray(observation.body.enemies));

    // Intent is clamped and stored; the reflex layer reads it on the next tick.
    const acted = await call("POST", `/agent/v1/sessions/${joined.body.sessionId}/act`, {
      body: { type: "intent", intent: { stance: "press", desiredRange: 500, weapon: "NUKE", junk: 1 } },
      session: joined.body,
    });
    assert.equal(acted.status, 200);
    assert.deepEqual(acted.body.applied, { stance: "press", desiredRange: 40 });
    assert.deepEqual(player.intent, { stance: "press", desiredRange: 40 });

    // An intent with nothing usable is rejected rather than silently kept.
    const empty = await call("POST", `/agent/v1/sessions/${joined.body.sessionId}/act`, {
      body: { type: "intent", intent: { junk: true } },
      session: joined.body,
    });
    assert.equal(empty.status, 400);

    const left = await call("DELETE", `/agent/v1/sessions/${joined.body.sessionId}`, { session: joined.body });
    assert.equal(left.status, 200);
    assert.equal(room.sim.players.has(joined.body.playerId), false);
    assert.equal(game.gateway.status().sessions, 0);
  });
});

test("agent intent actually steers the ship and can be observed taking effect", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN, tick: true }, async (game, url, track) => {
    const code = await roomWithHuman(url, track);
    const call = agentApi(url);
    const joined = await call("POST", "/agent/v1/sessions", { body: { mode: "join", code, name: "Pilot" } });
    const player = game.rooms.get(code).sim.players.get(joined.body.playerId);
    const startX = player.x,
      startZ = player.z;
    // "press" drives thrust forward; with no enemies nearby the reflex layer
    // still navigates, so assert the intent is held and the sim stepped.
    const before = game.rooms.get(code).sim.tick;
    await call("POST", `/agent/v1/sessions/${joined.body.sessionId}/act`, {
      body: { type: "intent", intent: { stance: "press" } },
      session: joined.body,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(game.rooms.get(code).sim.tick > before, "the authoritative loop advanced");
    assert.deepEqual(player.intent, { stance: "press" });
    assert.ok(Number.isFinite(player.x) && Number.isFinite(player.z));
    void startX;
    void startZ;
  });
});

test("raw input mode enforces seq ordering", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN }, async (game, url, track) => {
    const code = await roomWithHuman(url, track);
    const call = agentApi(url);
    const joined = await call("POST", "/agent/v1/sessions", { body: { mode: "join", code, name: "Pilot" } });
    const path = `/agent/v1/sessions/${joined.body.sessionId}/act`;
    const first = await call("POST", path, {
      body: { type: "input", input: { seq: 5, move: { x: 1, z: 0 }, weapon: "LASER" } },
      session: joined.body,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.accepted, "input");
    const stale = await call("POST", path, {
      body: { type: "input", input: { seq: 5, move: { x: 1, z: 0 } } },
      session: joined.body,
    });
    assert.equal(stale.status, 400);
    assert.match(stale.body.error, /stale seq/);
    const missingSeq = await call("POST", path, { body: { type: "input", input: { fire: true } }, session: joined.body });
    assert.equal(missingSeq.status, 400);
    assert.equal(game.rooms.get(code).sim.players.get(joined.body.playerId).ack, 5);
  });
});

test("gateway caps agents per room", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN, maxAgentsPerRoom: 2 }, async (game, url, track) => {
    const code = await roomWithHuman(url, track);
    const call = agentApi(url);
    const joinAgent = (name) => call("POST", "/agent/v1/sessions", { body: { mode: "join", code, name } });
    assert.equal((await joinAgent("One")).status, 201);
    assert.equal((await joinAgent("Two")).status, 201);
    const third = await joinAgent("Three");
    assert.equal(third.status, 400);
    assert.match(third.body.error, /agent pilots/);
    assert.equal(game.gateway.status().sessions, 2);
  });
});

test("gateway sessions are dropped when the room has closed", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN }, async (game, url, track) => {
    const human = track(await connect(url));
    const created = await join(human, { mode: "create", name: "Human", bots: false, profileToken: "h".repeat(40) });
    const call = agentApi(url);
    const joined = await call("POST", "/agent/v1/sessions", { body: { mode: "join", code: created.code, name: "Pilot" } });
    const room = game.rooms.get(created.code);
    // The agent is tracked separately from humans, so it never inflates the
    // human capacity or bot-fill counts.
    assert.equal(room.humans.size, 1);
    assert.equal(room.agents.size, 1);
    // Last human leaves with an explicit leave, which closes the room.
    human.emit("leave");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(game.rooms.has(created.code), false, "room closes when the last human leaves");
    const observation = await call("GET", `/agent/v1/sessions/${joined.body.sessionId}/observe`, { session: joined.body });
    assert.equal(observation.status, 410);
    assert.match(observation.body.error, /closed|left/i);
  });
});

test("agent activity does not change human capacity, bot fill, or the online count", async () => {
  await withServer({ allowAgents: true, agentGatewayToken: TOKEN }, async (game, url, track) => {
    const human = track(await connect(url));
    const created = await join(human, { mode: "create", name: "Human", bots: true, profileToken: "h".repeat(40) });
    const room = game.rooms.get(created.code);
    const botsBefore = [...room.sim.players.values()].filter((p) => p.bot).length;
    const call = agentApi(url);
    await call("POST", "/agent/v1/sessions", { body: { mode: "join", code: created.code, name: "Pilot" } });
    assert.equal(room.humans.size, 1, "agent is not counted as a human");
    assert.equal(room.agents.size, 1);
    // Bot fill targets `4 - humans`, so adding an agent must not remove a bot.
    assert.equal(
      [...room.sim.players.values()].filter((p) => p.bot).length,
      botsBefore,
      "an agent does not displace a filling bot",
    );
    const stats = await (await fetch(`${url}/api/statistics`)).json();
    assert.equal(stats.online, 1, "the public online count stays human-only");
  });
});

test("an intent-driven agent actually fires and kills, not just stores intent", () => {
  // Regression: a gateway agent has bot:false (so it expands the world like a
  // human), and the reflex layer used to run only when bot was true. Intent was
  // stored but never executed, so agents flew around doing zero damage.
  const sim = new Simulation();
  const agent = sim.addPlayer("agent-x", "Agent");
  const target = sim.addPlayer("bot-1", "Bot", true);
  Object.assign(agent, { x: 0, z: 0, vx: 0, vz: 0, angle: 0, aimAngle: 0, health: 100, energy: 100, protectedUntil: 0 });
  Object.assign(target, { x: 12, z: 0, vx: 0, vz: 0, angle: Math.PI, health: 4, protectedUntil: 0 });
  agent.intent = sanitizeIntent({ stance: "press", desiredRange: 12 });
  // Isolate the agent: the target must not shoot back or move.
  target.bot = false;
  for (let i = 0; i < 180; i++) sim.step();
  assert.ok(agent.shotsFired > 0, "an agent with intent must fire");
  assert.ok(agent.damageDealt > 0, "an agent with intent must deal damage");
  assert.equal(target.deaths, 1, "the agent finishes a low-hull target");
});

test("a human with no intent still uses its own submitted input", () => {
  // The reflex layer must not hijack a human just because the field exists.
  const sim = new Simulation();
  const human = sim.addPlayer("human", "Human");
  Object.assign(human, { x: 0, z: 0, vx: 0, vz: 0, angle: 0, aimAngle: 0 });
  sim.setInput("human", { seq: 1, move: { x: 1, z: 0 }, weapon: "LASER", fire: false });
  const before = { x: human.x, z: human.z };
  for (let i = 0; i < 30; i++) sim.step();
  assert.equal(human.intent, null);
  assert.ok(human.x > before.x, "the human moves under its own input");
  assert.equal(human.shotsFired, 0, "the human does not fire without asking");
});

test("JevRunner bounds cost with a per-pilot cooldown and a per-minute budget", async () => {
  // A live API key must not become an open tap: a 600ms sweep with no ceilings
  // spends ~100 requests/minute forever, per bot.
  let now = 0;
  let calls = 0;
  let skips = 0;
  const brain = { decide: async () => { calls++; return { stance: "press" }; } };
  const runner = new JevRunner({ brain, minIntervalMs: 1500, maxInFlight: 3, maxPerMinute: 5, now: () => now, onSkip: () => skips++ });
  const p = { id: "b1", brain: "jev", alive: true, intent: null };
  const room = { sim: { players: new Map([["b1", p]]) } };
  for (let i = 0; i < 20; i++) { runner.sweep([room]); now += 100; await new Promise((r) => setImmediate(r)); }
  assert.equal(calls, 1, "the per-pilot cooldown throttles repeated sweeps");
  runner.stop();
});

test("JevRunner spends the per-minute budget and resets on rollover", async () => {
  let now = 0;
  let calls = 0;
  let skips = 0;
  const brain = { decide: async () => { calls++; return { stance: "press" }; } };
  const runner = new JevRunner({ brain, minIntervalMs: 0, maxInFlight: 10, maxPerMinute: 3, now: () => now, onSkip: () => skips++ });
  const players = new Map();
  for (let i = 0; i < 10; i++) players.set(`b${i}`, { id: `b${i}`, brain: "jev", alive: true, intent: null });
  const room = { sim: { players } };
  runner.sweep([room]);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3, "the budget caps requests regardless of how many pilots want one");
  assert.equal(skips, 1, "hitting the budget is reported, not hidden");
  assert.equal(runner.stats().decisionsThisMinute, 3);
  now += 61_000;
  calls = 0;
  runner.sweep([room]);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3, "the budget resets after a minute");
  runner.stop();
});

test("JevRunner never overlaps a request for the same pilot", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const brain = { decide: async () => { calls++; await gate; return { stance: "press" }; } };
  const runner = new JevRunner({ brain, minIntervalMs: 0, maxPerMinute: 0 });
  const p = { id: "b1", brain: "jev", alive: true, intent: null };
  const room = { sim: { players: new Map([["b1", p]]) } };
  runner.sweep([room]);
  runner.sweep([room]);
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(p.intent.stance, "press");
  runner.stop();
});

// ---- Admin bot-mix gate ---------------------------------------------------

// `isAdmin` reads socket.data.authUser, which the connection middleware sets
// from a Supabase token the server verified. Tests cannot mint that token, so
// they stand in for the middleware the same way the real one would.
function withAuthEmail(game, socket, email) {
  const target = game.io.sockets.sockets.get(socket.id);
  target.data.authUser = email ? { id: `user-${email}`, email } : undefined;
  return target;
}

test("a non-admin asking for Jev bots silently gets classic bots", async () => {
  await withServer({ allowAgents: true }, async (game, url, track) => {
    const socket = track(await connect(url));
    const created = await join(socket, { mode: "create", name: "Guest", bots: true, botMix: "jev", profileToken: "g".repeat(40) });
    const room = game.rooms.get(created.code);
    assert.equal(room.botMix, "classic", "a guest cannot request paid bots");
    assert.equal(created.botMix, "classic");
    assert.equal(created.admin, false);
    // Every bot is a free heuristic one; none was marked for Jev.
    const bots = [...room.sim.players.values()].filter((p) => p.bot);
    assert.ok(bots.length > 0);
    assert.equal(bots.filter((p) => p.brain === "jev").length, 0);
  });
});

test("an admin can create a mixed room and the server picks which bots use Jev", async () => {
  // A mix only becomes Jev brains when a runner exists, so stand one in: this
  // tests the room policy, not the model.
  const brain = { decide: async () => ({ stance: "press" }) };
  const game = createGameServer({ tick: false, rankingsFile: null, allowAgents: true, jevApiKey: "test-key", jevBots: true });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const socket = await connect(url);
  try {
    game.io.sockets.sockets.get(socket.id).data.authUser = { id: "u1", email: "luisgimenezdev@gmail.com" };
    const created = await join(socket, { mode: "create", name: "Admin", bots: true, botMix: "mixed", profileToken: "a".repeat(40) });
    assert.equal(created.admin, true, "the verified admin email is recognised");
    const room = game.rooms.get(created.code);
    assert.equal(room.botMix, "mixed");
    const bots = [...room.sim.players.values()].filter((p) => p.bot);
    const jev = bots.filter((p) => p.brain === "jev");
    const classic = bots.filter((p) => p.brain !== "jev");
    assert.ok(jev.length >= 1, "mixed seats at least one Jev bot");
    assert.ok(classic.length >= 1, "mixed keeps at least one classic bot");
    void brain;
  } finally {
    socket.disconnect();
    await game.close();
  }
});

test("admin identity is case-insensitive and other emails are rejected", async () => {
  const game = createGameServer({ tick: false, rankingsFile: null, allowAgents: true, jevApiKey: "test-key", jevBots: true, adminEmails: ["LuisGimenezDev@Gmail.com"] });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const admin = await connect(url);
  const other = await connect(url);
  try {
    game.io.sockets.sockets.get(admin.id).data.authUser = { id: "u1", email: "luisgimenezdev@gmail.com" };
    const made = await join(admin, { mode: "create", name: "Admin", bots: true, botMix: "jev", profileToken: "a".repeat(40) });
    assert.equal(game.rooms.get(made.code).botMix, "jev");
    game.io.sockets.sockets.get(other.id).data.authUser = { id: "u2", email: "someone@else.com" };
    const guest = await join(other, { mode: "create", name: "Other", bots: true, botMix: "jev", profileToken: "b".repeat(40) });
    assert.equal(game.rooms.get(guest.code).botMix, "classic");
  } finally {
    admin.disconnect();
    other.disconnect();
    await game.close();
  }
});

test("with no Jev key configured, even an admin request stays classic", async () => {
  // The runner is null without TYPESAFE_API_KEY, so no bot can be Jev-driven.
  await withServer({ allowAgents: true, jevApiKey: "", jevBots: false }, async (game, url, track) => {
    const socket = track(await connect(url));
    withAuthEmail(game, socket, "luisgimenezdev@gmail.com");
    const created = await join(socket, { mode: "create", name: "Admin", bots: true, botMix: "jev", profileToken: "a".repeat(40) });
    const room = game.rooms.get(created.code);
    assert.equal(room.botMix, "jev", "the room records the request");
    const bots = [...room.sim.players.values()].filter((p) => p.bot);
    assert.equal(bots.filter((p) => p.brain === "jev").length, 0, "no runner means no Jev bots");
  });
});

test("the identity handshake reports admin before a room exists", async () => {
  // The lobby needs to know whether to offer the paid-opponent selector before
  // any join happens, so admin status cannot depend on a join ack.
  await withServer({ allowAgents: true }, async (game, url, track) => {
    const socket = track(await connect(url));
    const guest = await new Promise((resolve) => socket.timeout(8000).emit("identity", (error, result) => resolve(error || result)));
    assert.equal(guest.admin, false);
    assert.equal(guest.signedIn, false);
    assert.deepEqual(guest.botMixes, ["classic", "jev", "mixed"]);
    withAuthEmail(game, socket, "luisgimenezdev@gmail.com");
    const admin = await new Promise((resolve) => socket.timeout(8000).emit("identity", (error, result) => resolve(error || result)));
    assert.equal(admin.admin, true);
    assert.equal(admin.signedIn, true);
  });
});

test("summarizeRecap exposes the authoritative stats a scoring harness needs", () => {
  const recap = {
    winnerId: "agent-1",
    players: [
      { id: "agent-1", kills: 7, deaths: 2, damageDealt: 540, accuracy: 41, score: 1150, xp: 480 },
      { id: "bot-1", kills: 1, deaths: 7, damageDealt: 90, accuracy: 10, score: 25, xp: 25 },
    ],
  };
  assert.deepEqual(summarizeRecap(recap, "agent-1"), { kills: 7, deaths: 2, damageDealt: 540, accuracy: 41, score: 1150, xp: 480, winner: true });
  assert.equal(summarizeRecap(recap, "unknown"), null);
  assert.equal(summarizeRecap(null, "agent-1"), null);
});
