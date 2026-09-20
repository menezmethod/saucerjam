// Jev is TypeSafe's System One decision model: send a structured state and a
// map of typed questions, get typed answers with probabilities and confidence.
// It is not a per-tick controller and it is not a text generator. So it drives
// a pilot the only way that fits: it chooses the slow tactical intent (target,
// stance, range, weapon) and the deterministic reflex layer in shared/brains.js
// executes that intent at 60 Hz.
//
// Everything here is opt-in. With no API key the server runs exactly as before.
// The pure builders (buildState/buildQuestions/composeIntent) have no network
// dependency and are covered by tests; only createJevClient touches the network.

const { sanitizeIntent, WEAPON_NAMES } = require("../../shared/brains");
const { traceWalls } = require("../../shared/simulation");

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";
const RANGE_STOPS = [5, 11, 19, 27]; // meters for desired_range levels 0..3

const STANCE_AGGRESSION = { press: 1, trade: 0.7, disengage: 0.3, reposition: 0.4, heal: 0.2 };

function rangeBand(metres) {
  if (metres < 8) return "close";
  if (metres < 16) return "mid";
  return "far";
}

function bearing(p, q) {
  const offset = Math.atan2(Math.sin(Math.atan2(q.x - p.x, q.z - p.z) - p.angle), Math.cos(Math.atan2(q.x - p.x, q.z - p.z) - p.angle));
  const degrees = (offset * 180) / Math.PI;
  if (degrees > -45 && degrees <= 45) return "front";
  if (degrees > 45 && degrees <= 135) return "right";
  if (degrees < -45 && degrees >= -135) return "left";
  return "rear";
}

// A compact, decision-shaped picture. The model never sees the wire snapshot or
// the map geometry; it sees the handful of facts a tactician would weigh.
function buildState(sim, p) {
  const enemies = [];
  for (const q of sim.players.values()) {
    if (q.id === p.id || !q.alive) continue;
    const dx = q.x - p.x,
      dz = q.z - p.z,
      d = Math.hypot(dx, dz) || 0.001,
      ux = dx / d,
      uz = dz / d;
    enemies.push({
      id: q.id,
      name: q.name,
      range_band: rangeBand(d),
      metres: Math.round(d),
      hull: Math.round(q.health),
      closing: Number((-(q.vx - p.vx) * ux - (q.vz - p.vz) * uz).toFixed(2)),
      angle: bearing(p, q),
      visible: !traceWalls(p.x, p.z, dx, dz, 0.2, sim.map),
      protected: q.protectedUntil > sim.time,
    });
  }
  enemies.sort((a, b) => a.metres - b.metres);
  const leaderKills = Math.max(0, ...enemies.map(() => 0), ...[...sim.players.values()].map((q) => q.kills));
  return {
    self: {
      hull: Math.round(p.health),
      energy: Math.round(p.energy),
      weapon: p.weapon,
      district: sim.map?.districtId || sim.map?.id || "unknown",
      under_fire: sim.time - p.lastDamage < 2,
      deaths: p.deaths,
    },
    enemies: enemies.slice(0, 4),
    objective: {
      mode: "deathmatch",
      my_kills: p.kills,
      my_deaths: p.deaths,
      my_damage: Math.round(p.damageDealt),
      my_accuracy: p.shotsFired ? Math.round((p.shotsHit / p.shotsFired) * 100) : 0,
      leader_kills: leaderKills,
      frag_limit: sim.fragLimit,
      seconds_left: Math.max(0, Math.round(sim.roundEndsAt - sim.time)),
    },
    recent: {
      hull_lost: Math.round(100 - p.health),
      last_damage_seconds_ago: p.lastDamage < 0 ? null : Math.round(sim.time - p.lastDamage),
    },
  };
}

// One request, several atomic judgments. Per-enemy focus scores are the
// re-ranking pattern: score every candidate together, choose in code.
function buildQuestions(sim, p) {
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
  for (const enemy of buildState(sim, p).enemies) {
    questions[`focus_${enemy.id}`] = {
      type: "score",
      instructions: `How strong is the case to focus ${enemy.name} (${enemy.range_band}, ${enemy.hull} hull) next?`,
      criteria: ["Poor target.", "Acceptable.", "Good.", "Best target available."],
    };
  }
  return questions;
}

function interpolateRange(score) {
  const clamped = Math.max(0, Math.min(RANGE_STOPS.length - 1, Number.isFinite(score) ? score : 1));
  const lo = Math.floor(clamped),
    hi = Math.min(RANGE_STOPS.length - 1, lo + 1);
  return RANGE_STOPS[lo] + (RANGE_STOPS[hi] - RANGE_STOPS[lo]) * (clamped - lo);
}

// Answers -> intent. Confidence gates every actionable field: a shaky answer
// leaves that field to the heuristic default instead of steering the ship.
function composeIntent(answers, { minConfidence = 0.4 } = {}) {
  if (!answers || typeof answers !== "object") return null;
  const confident = (answer) => !!answer && answer.confidence >= minConfidence;
  const intent = {};
  const stance = answers.stance;
  if (stance && confident(stance) && STANCE_AGGRESSION[stance.choice] != null) {
    intent.stance = stance.choice;
    intent.aggression = STANCE_AGGRESSION[stance.choice];
  }
  const range = answers.desired_range;
  if (range && confident(range) && Number.isFinite(range.score)) intent.desiredRange = interpolateRange(range.score);
  const weapon = answers.weapon;
  if (weapon && confident(weapon) && WEAPON_NAMES.has(weapon.choice)) intent.weapon = weapon.choice;
  const best = Object.entries(answers)
    .filter(([id, answer]) => id.startsWith("focus_") && answer && Number.isFinite(answer.score) && answer.confidence >= minConfidence)
    .map(([id, answer]) => ({ id: id.slice("focus_".length), score: answer.score, confidence: answer.confidence }))
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 1) intent.targetId = best.id;
  // A high-confidence "trapped" overrides an aggressive stance, because the
  // model has weighed the whole picture and code should honor that.
  if (answers.trapped && answers.trapped.noul > 0.6 && intent.stance !== "heal") {
    intent.stance = "reposition";
    intent.aggression = STANCE_AGGRESSION.reposition;
  }
  const normalized = sanitizeIntent(intent);
  return normalized;
}

// Minimal, dependency-free TypeSafe client. Retries 429/529 with exponential
// backoff (as the docs require) and always resolves to the answers map.
function createJevClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = "jev-latest",
  fetchImpl = fetch,
  maxAttempts = 3,
  timeoutMs = 4000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!apiKey) throw new Error("A TypeSafe API key is required for Jev.");
  return {
    async ask(state, questions) {
      let lastError;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(baseUrl, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ state, questions, model }),
            signal: controller.signal,
          });
          if (response.status === 429 || response.status === 529) {
            lastError = new Error(`TypeSafe busy (${response.status})`);
            await sleep(2 ** attempt * 250);
            continue;
          }
          if (!response.ok) {
            // 4xx is our fault (bad key/request); retrying cannot help.
            const error = new Error(`TypeSafe request failed (${response.status})`);
            if (response.status >= 400 && response.status < 500) error.fatal = true;
            throw error;
          }
          const data = await response.json();
          return data.answers;
        } catch (error) {
          lastError = error;
          if (error.fatal || attempt === maxAttempts - 1) throw error;
          await sleep(2 ** attempt * 250);
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastError || new Error("TypeSafe request failed");
    },
  };
}

// A brain turns a simulation + player into the latest intent. It is called from
// a timer, never from step(); the simulation reads whatever intent exists.
class JevBrain {
  constructor({ client, minConfidence = 0.4 } = {}) {
    if (!client || typeof client.ask !== "function") throw new Error("JevBrain requires a client with ask().");
    this.client = client;
    this.minConfidence = minConfidence;
  }
  async decide(sim, p) {
    const answers = await this.client.ask(buildState(sim, p), buildQuestions(sim, p));
    return composeIntent(answers, { minConfidence: this.minConfidence });
  }
}

// Drives JevBrains without ever overlapping a player's in-flight request. A
// slow or failed call leaves the previous intent in place, so the pilot keeps
// playing on the last good decision.
//
// Two ceilings keep a live key from becoming an open tap:
//   - per-pilot cooldown: one pilot cannot decide faster than `minIntervalMs`
//     even if the sweep runs more often than that.
//   - global budget: `maxInFlight` bounds concurrent requests across all rooms,
//     and `maxPerMinute` stops issuing new work once the running total for the
//     current minute is spent. A bot then plays on its last intent until the
//     window rolls over, rather than the server hammering the API.
class JevRunner {
  constructor({
    brain,
    intervalMs = 600,
    minIntervalMs = 0,
    maxInFlight = 4,
    maxPerMinute = 0,
    now = () => Date.now(),
    onError = () => {},
    onSkip = () => {},
  } = {}) {
    this.brain = brain;
    this.intervalMs = intervalMs;
    this.minIntervalMs = Math.max(0, minIntervalMs);
    this.maxInFlight = Math.max(1, maxInFlight);
    this.maxPerMinute = Math.max(0, maxPerMinute);
    this.now = now;
    this.onError = onError;
    this.onSkip = onSkip;
    this.pending = new Set();
    this.lastDecisionAt = new Map();
    this.timer = null;
    this.window = { startedAt: 0, count: 0 };
  }

  // A rolling per-minute budget. Returns false once the window is spent, so a
  // caller can skip work instead of queueing an unbounded backlog.
  withinBudget() {
    if (!this.maxPerMinute) return true;
    const now = this.now();
    if (now - this.window.startedAt >= 60_000) {
      this.window = { startedAt: now, count: 0 };
    }
    return this.window.count < this.maxPerMinute;
  }

  // Called when a request is actually issued, so retries and failures still
  // count against the budget.
  spend() {
    if (this.maxPerMinute) this.window.count++;
  }

  eligible(p) {
    if (p.brain !== "jev" || !p.alive) return false;
    if (this.pending.has(p.id)) return false;
    if (this.pending.size >= this.maxInFlight) return false;
    if (this.minIntervalMs) {
      const last = this.lastDecisionAt.get(p.id) || 0;
      if (this.now() - last < this.minIntervalMs) return false;
    }
    return true;
  }

  sweep(rooms) {
    for (const room of rooms) {
      for (const p of room.sim.players.values()) {
        if (!this.eligible(p)) continue;
        if (!this.withinBudget()) {
          this.onSkip("budget", p);
          return;
        }
        this.pending.add(p.id);
        this.lastDecisionAt.set(p.id, this.now());
        this.spend();
        this.brain
          .decide(room.sim, p)
          .then((intent) => { if (intent) p.intent = intent; })
          .catch((error) => { this.lastErrorMessage = error.message; this.onError(error, p); })
          .finally(() => this.pending.delete(p.id));
      }
    }
  }

  start(getRooms) {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(getRooms()), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
    this.lastDecisionAt.clear();
  }

  stats() {
    return {
      inFlight: this.pending.size,
      decisionsThisMinute: this.maxPerMinute ? this.window.count : null,
      maxPerMinute: this.maxPerMinute || null,
      lastError: this.lastErrorMessage || null,
    };
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  RANGE_STOPS,
  buildState,
  buildQuestions,
  composeIntent,
  interpolateRange,
  rangeBand,
  createJevClient,
  JevBrain,
  JevRunner,
};