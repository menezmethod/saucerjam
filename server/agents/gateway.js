// Tier 2: the Agent Gateway.
//
// Tier 0 (scripts/agents/pilot.cjs) makes an agent join over Socket.IO. That
// works, but every agent reimplements join/ack/seq/reconnect, and a slow model
// has to emit 60 Hz control to stay alive. The gateway is the supported path:
// a few HTTP calls per second, a decision-ready observation, and an `intent`
// mode where the server's reflex layer fills in the per-tick control.
//
// Two rules keep this safe:
//   1. An agent never gets more authority than a browser. It observes the same
//      AOI-limited snapshot and submits only sanitized intent or input.
//   2. Model latency never touches the simulation. `act` writes the latest
//      intent; the 60 Hz loop reads whatever is there.
//
// The transport is intentionally dumb so it can be driven by anything: an LLM
// harness, a shell script, curl. State lives in a Map keyed by session id.

const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { sanitizeInput } = require("../../shared/simulation");
const { sanitizeIntent } = require("../../shared/brains");
const { buildState } = require("./jev");

const SESSION_TTL_MS = 90_000;

// The observation is the Jev state (one definition of "what a brain sees")
// plus the few transport/budget facts a general agent needs to act on it.
function buildObservation(sim, player, { playerId, intentServedAt, now }) {
  const state = buildState(sim, player);
  return {
    tick: sim.tick,
    time: Number(sim.time.toFixed(2)),
    self: { id: playerId, ...state.self },
    enemies: state.enemies,
    objective: state.objective,
    recent: state.recent,
    // `alive: false` means the ship is respawning; acting is pointless until
    // the next observation reports it alive again.
    alive: player.alive,
    intent_age_ms: intentServedAt ? Math.max(0, Math.round(now - intentServedAt)) : null,
  };
}

// One session per joined agent. Kept intentionally small: this is a facade over
// the existing room/human bookkeeping, not a second source of truth.
class AgentGateway {
  constructor({
    io,
    rooms,
    maxAgentsPerRoom = Number(process.env.MAX_AGENTS_PER_ROOM) || 4,
    token = process.env.AGENT_GATEWAY_TOKEN || "",
    allowAgents = false,
    profileKey = null,
  } = {}) {
    this.io = io;
    this.rooms = rooms;
    this.maxAgentsPerRoom = maxAgentsPerRoom;
    this.token = token;
    this.allowAgents = allowAgents;
    this.profileKey = profileKey;
    this.sessions = new Map();
    this.sweeper = setInterval(() => this.reap(), 15_000);
    this.sweeper.unref?.();
  }

  enabled() {
    return this.allowAgents;
  }

  // A join name is displayed to humans, so treat it as untrusted text: the
  // simulation already strips control characters and angle brackets, and the
  // gateway mirrors that so the echoed name matches what the room will show.
  static cleanName(value) {
    return typeof value === "string"
      ? value.replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18)
      : "";
  }

  // Constant-time-ish compare so a token cannot be guessed by timing.
  authorized(header) {
    if (!this.token) return false;
    const presented = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
    if (!presented) return false;
    const a = Buffer.from(presented[1]);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  agentCount(room) {
    return [...room.sim.players.values()].filter((p) => p.pilotClass === "agent").length;
  }

  reap() {
    const now = Date.now();
    let reaped = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.touchedAt <= SESSION_TTL_MS) continue;
      this.destroy(id);
      reaped++;
    }
    return reaped;
  }

  // An agent joins the same way a browser does: it becomes a human-tracked
  // member of the room and a sim player. The gateway keeps its own session map
  // rather than a Socket.IO socket, but it reuses the room's own `humans` set so
  // snapshot delivery and leave() treat it identically.
  join({ name, mode = "quick", code, maxPlayers }) {
    if (!this.enabled()) return { error: "Agent pilots are not enabled on this server." };
    const rooms = this.rooms;
    let room;
    if (mode === "join") {
      room = rooms.get(String(code || "").toUpperCase());
      if (!room) return { error: "Room not found. Check the code or create a new room." };
    } else if (mode !== "quick") {
      return { error: 'mode must be "quick" or "join".' };
    } else {
      room = [...rooms.values()].find(
        (r) => r.code.startsWith("PUBLIC") && r.humans.size < (Number(maxPlayers) || 32),
      );
      if (!room) return { error: 'No open public arena. Join a specific room with mode:"join" and a code.' };
    }
    if (this.agentCount(room) >= this.maxAgentsPerRoom)
      return { error: `This room already has ${this.maxAgentsPerRoom} agent pilots.` };
    if (room.humans.size >= (Number(maxPlayers) || 32))
      return { error: "This room is full of human pilots." };

    const sessionId = randomBytes(12).toString("hex");
    const playerId = `agent-${sessionId}`;
    // Agents live in their own set so they never inflate human capacity,
    // bot-fill targets, or the map-expansion population count.
    room.agents.add(playerId);
    const player = room.sim.addPlayer(playerId, AgentGateway.cleanName(name) || "Agent", false, null, { pilotClass: "agent" });
    player.profileId = `agent:${sessionId}`;
    const session = {
      id: sessionId,
      playerId,
      roomCode: room.code,
      name: player.name,
      token: randomBytes(24).toString("hex"),
      seq: 0,
      touchedAt: Date.now(),
      intentServedAt: null,
      inputs: 0,
    };
    this.sessions.set(sessionId, session);
    return {
      playerId,
      sessionId,
      sessionToken: session.token,
      roomCode: room.code,
      map: room.sim.map.id,
      observation: this.observe(session),
    };
  }

  resolve(sessionId, token) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) return { error: "Unknown or expired session." };
    if (session.token !== token) return { error: "Invalid session token." };
    session.touchedAt = Date.now();
    return { session };
  }

  roomOf(session) {
    return this.rooms.get(session.roomCode);
  }

  observe(session) {
    const room = this.roomOf(session);
    if (!room) return { error: "Room has closed." };
    const player = room.sim.players.get(session.playerId);
    if (!player) return { error: "Pilot has left the room." };
    return buildObservation(room.sim, player, {
      playerId: session.playerId,
      intentServedAt: session.intentServedAt,
      now: Date.now(),
    });
  }

  // The one place an agent changes the game. Intent is clamped and unknown
  // fields are dropped, exactly like a browser's input.
  act(session, action) {
    const room = this.roomOf(session);
    if (!room) return { error: "Room has closed." };
    const player = room.sim.players.get(session.playerId);
    if (!player) return { error: "Pilot has left the room." };
    if (!action || typeof action !== "object") return { error: "action must be an object." };
    const type = action.type;
    if (type === "intent") {
      const intent = sanitizeIntent(action.intent);
      if (!intent) return { error: "intent had no usable fields. See docs/AGENT-PILOTS.md." };
      player.intent = intent;
      session.intentServedAt = Date.now();
      session.touchedAt = Date.now();
      return { accepted: "intent", applied: intent, tick: room.sim.tick };
    }
    if (type === "input") {
      const input = sanitizeInput(action.input);
      if (!Number.isFinite(action.input?.seq)) return { error: "input.seq is required." };
      if (input.seq <= player.ack) return { error: `stale seq ${input.seq}; last accepted was ${player.ack}.` };
      room.sim.setInput(session.playerId, input);
      session.inputs++;
      session.touchedAt = Date.now();
      return { accepted: "input", seq: input.seq, tick: room.sim.tick };
    }
    return { error: 'action.type must be "intent" or "input".' };
  }

  destroy(sessionId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) return false;
    const room = this.roomOf(session);
    if (room) {
      room.agents.delete(session.playerId);
      room.sim.removePlayer(session.playerId);
    }
    this.sessions.delete(session.id);
    return true;
  }

  // What a matchmaker needs: which rooms have agent seats and which agents are
  // currently deciding. Used by the scoring harness and by operators.
  status() {
    const byRoom = {};
    for (const session of this.sessions.values()) {
      byRoom[session.roomCode] = byRoom[session.roomCode] || { agents: 0, players: [] };
      byRoom[session.roomCode].agents++;
      byRoom[session.roomCode].players.push(session.playerId);
    }
    return { enabled: this.enabled(), sessions: this.sessions.size, rooms: byRoom };
  }

  close() {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    this.sessions.clear();
  }
}

// The digest a scoring harness reads to compare an agent against heuristic
// bots. Derived from the authoritative recap so an agent cannot inflate it.
function summarizeRecap(recap, playerId) {
  const me = recap?.players?.find((p) => p.id === playerId);
  if (!me) return null;
  return {
    kills: me.kills,
    deaths: me.deaths,
    damageDealt: me.damageDealt,
    accuracy: me.accuracy,
    score: me.score,
    xp: me.xp,
    winner: recap.winnerId === playerId,
  };
}

module.exports = { AgentGateway, buildObservation, summarizeRecap, SESSION_TTL_MS };
