"use strict";

// The Tier-0 agent policy. It is deliberately simple, deterministic, and
// dependency-free so it doubles as a reference for what "an agent that plays"
// looks like: read an observation, emit one input. It only uses fields that
// snapshotFor() exposes to any client, so it can never see more than a human.
//
// This is the direct-control tier. A slower brain (an LLM, or Jev through the
// gateway) would instead emit intent and let the server execute it.

const LASER_RANGE = 28;
const LASER_COST = 25;
const PREFERRED_RANGE = 12;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function normalize(x, z) {
  const length = Math.hypot(x, z);
  return length > 0.0001 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function idle() {
  return { seq: 0, move: { x: 0, z: 0 }, thrust: 0, turn: 0, strafe: 0, fire: false, weapon: "LASER", aim: null };
}

function nearestAvailablePickup(state, me) {
  let best = null;
  for (const pickup of state.pickups || []) {
    if (pickup.available === false) continue;
    if (!best || dist(me, pickup) < dist(me, best)) best = pickup;
  }
  return best;
}

// Prediction lead for a laser travelling at ~58 units/second.
function aimAt(me, enemy) {
  const d = dist(me, enemy);
  const lead = d / 58;
  return { x: enemy.x + enemy.vx * lead, z: enemy.z + enemy.vz * lead };
}

function chooseWeapon(me, d) {
  if (me.energy >= 100 && d > 6 && d < 18 && me.health > 40) return "GRENADE";
  if (me.energy >= 50 && d > 18) return "BOUNCE";
  return "LASER";
}

// Observation -> one input. `seq` is filled in by the transport, not here.
// movement (a world-space heading) and aim are independent, which is what makes
// the drift-aim combat work: orbit one way, shoot another.
function decide(state, playerId) {
  const me = state && Array.isArray(state.players) ? state.players.find((p) => p.id === playerId) : null;
  if (!me || !me.alive || state.restartAt) return idle();

  const enemies = state.players.filter(
    (p) => p.id !== playerId && p.alive && p.protectedUntil <= state.time,
  );
  let enemy = null;
  for (const candidate of enemies) if (!enemy || dist(me, candidate) < dist(me, enemy)) enemy = candidate;

  if (!enemy) {
    // Nothing to shoot: drift toward the nearest pickup, or rotate in place.
    const pickup = nearestAvailablePickup(state, me);
    if (pickup) {
      const heading = normalize(pickup.x - me.x, pickup.z - me.z);
      return { ...idle(), move: heading };
    }
    return idle();
  }

  const d = dist(me, enemy);
  const toward = normalize(enemy.x - me.x, enemy.z - me.z);

  // Low hull: regenerate and grab a pickup. Otherwise hold a firing band and
  // orbit, which is harder to lead than a straight-line approach.
  let move;
  if (me.health < 35) {
    move = { x: -toward.x, z: -toward.z };
  } else if (d > PREFERRED_RANGE + 3) {
    move = toward;
  } else if (d < PREFERRED_RANGE - 3) {
    move = { x: -toward.x, z: -toward.z };
  } else {
    move = { x: -toward.z, z: toward.x };
  }

  const weapon = chooseWeapon(me, d);
  const cost = weapon === "GRENADE" ? 100 : weapon === "BOUNCE" ? 50 : LASER_COST;
  const fire = d < LASER_RANGE && me.energy >= cost;

  return { seq: 0, move, thrust: 0, turn: 0, strafe: 0, fire, weapon, aim: aimAt(me, enemy) };
}

module.exports = { decide, chooseWeapon, aimAt, nearestAvailablePickup, idle, LASER_RANGE, PREFERRED_RANGE };
