// A pilot has two halves. Intent is the slow, tactical half: which enemy to
// fight, how close to fight, and whether to commit, trade, or peel off. The
// reflex half turns that intent into per-tick inputs, handling navigation,
// aim lead, and fire gating at 60 Hz.
//
// Intent can come from the deterministic heuristic, Jev, or an external agent.
// It is never awaited by the simulation: slower brains write the latest intent
// and the reflex layer executes it, exactly like a network input. With no
// intent (the default) this reproduces the original bot behavior unchanged, so
// external callers and tests that rely on it stay stable.

const WEAPON_NAMES = new Set(["LASER", "GRENADE", "BOUNCE"]);
// Stances are intentionally coarse. A System One model picks one; code owns
// the numbers. Add a stance only when it maps to a distinct control policy.
const STANCES = new Set(["press", "trade", "disengage", "reposition", "heal"]);

// Accept untrusted intent (a Jev answer, an agent request, a wire payload) and
// return only the fields the reflex layer understands. Unknown fields and
// out-of-range numbers are dropped, never coerced, so a bad intent degrades to
// the heuristic default instead of steering the ship with garbage.
function sanitizeIntent(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const intent = {};
  if (typeof raw.targetId === "string" && raw.targetId) intent.targetId = raw.targetId;
  if (STANCES.has(raw.stance)) intent.stance = raw.stance;
  if (Number.isFinite(raw.desiredRange))
    intent.desiredRange = Math.max(2, Math.min(40, raw.desiredRange));
  if (WEAPON_NAMES.has(raw.weapon)) intent.weapon = raw.weapon;
  if (Number.isFinite(raw.aggression))
    intent.aggression = Math.max(0, Math.min(1, raw.aggression));
  return Object.keys(intent).length ? intent : null;
}

// Intended target if it is still alive, otherwise the nearest living opponent.
// Ties keep insertion order, matching the original nearest-target scan.
function chooseTarget(p, sim, intent, distance) {
  const living = [...sim.players.values()].filter((q) => q.id !== p.id && q.alive);
  if (intent && intent.targetId) {
    const chosen = living.find((q) => q.id === intent.targetId);
    if (chosen) return chosen;
  }
  if (!living.length) return null;
  return living.reduce((best, q) => (distance(p, q) < distance(p, best) ? q : best));
}

// Senses are injected so this module stays free of simulation imports and is
// testable with stubs. simulation.js supplies the real geometry helpers.
function reflexInput(p, sim, intent, senses) {
  const { clamp, angleDiff, distance, traceWalls, findPath, sanitizeInput } = senses;
  const target = chooseTarget(p, sim, intent, distance);
  if (!target) return sanitizeInput();
  const d = distance(p, target),
    los = !traceWalls(p.x, p.z, target.x - p.x, target.z - p.z, 0.2, sim.map);
  let waypoint = target;
  if (!los) {
    if (sim.time >= p.navigateAt) {
      p.path = findPath(p, target, sim.map);
      p.navigateAt = sim.time + 0.6;
    }
    while (p.path.length && distance(p, p.path[0]) < 1.2) p.path.shift();
    waypoint = p.path[0] || target;
  }
  const heading = Math.atan2(waypoint.x - p.x, waypoint.z - p.z),
    turn = clamp(angleDiff(heading, p.angle) * 3, -1, 1);
  const aimNoise = Math.sin(sim.time * 1.8 + p.color.charCodeAt(2)) * 1.7;
  const stance = (intent && intent.stance) || null;
  // Engagement distances. Legacy thresholds when no intent sets them; a
  // desiredRange scales the band a brain asked for.
  const holdRange = intent && intent.desiredRange != null ? intent.desiredRange : 10,
    strafeRange = intent && intent.desiredRange != null ? intent.desiredRange * 1.4 : 17,
    fireRange = intent && intent.desiredRange != null ? intent.desiredRange * 2.4 : 30,
    aggression = intent && intent.aggression != null ? intent.aggression : 1;
  let thrust;
  if (stance === "disengage" || stance === "reposition") thrust = -0.7;
  else if (stance === "heal") thrust = los && d < Math.max(holdRange, 14) ? -0.6 : 0.1;
  else if (stance === "press")
    thrust = los && d < holdRange ? -0.2 : Math.abs(turn) < 0.9 ? 0.85 : 0.3;
  else thrust = los && d < holdRange ? -0.4 : Math.abs(turn) < 0.8 ? 0.7 : 0.2;
  let strafe = los && d < strafeRange ? Math.sin(sim.time + p.x) * 0.45 * aggression : 0;
  if (stance === "reposition") strafe = 0.6 * (p.color.charCodeAt(0) % 2 ? 1 : -1);
  const canHit = target.protectedUntil < sim.time;
  let fire;
  if (stance === "disengage" || stance === "reposition") fire = los && d < 12 && canHit;
  else if (stance === "heal") fire = los && d < 8 && canHit;
  else if (stance === "press") fire = los && d < fireRange && canHit;
  else fire = los && d < fireRange && canHit && Math.sin(sim.time * 2) > -0.5;
  const weapon =
    (intent && intent.weapon) ||
    (Math.floor(sim.time / 7 + p.color.charCodeAt(1)) % 5 === 0 && d < 23
      ? "GRENADE"
      : "LASER");
  return {
    seq: 0,
    thrust,
    strafe,
    turn,
    fire,
    weapon,
    aim: {
      x: target.x + (target.vx * d) / 65 + aimNoise,
      z: target.z + (target.vz * d) / 65 + aimNoise,
    },
  };
}

module.exports = {
  reflexInput,
  sanitizeIntent,
  chooseTarget,
  STANCES,
  WEAPON_NAMES,
};
