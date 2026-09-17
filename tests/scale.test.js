const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Simulation } = require("../shared/simulation");
const { getWorld } = require("../shared/maps");

for (const population of [8, 32, 64, 128]) test(`${population}-pilot Confluence state stays authoritative at 60 Hz`, () => {
  const simulation = new Simulation({ map: getWorld(3), populationExpansion: false });
  for (let i = 0; i < population; i++) simulation.addPlayer(`pilot-${i}`, `Pilot ${i}`);
  for (let tick = 0; tick < 60; tick++) simulation.step();
  const state = simulation.snapshot();
  assert.equal(state.players.length, population);
  assert.ok(state.players.every(({ x, z, health, energy }) => [x, z, health, energy].every(Number.isFinite)));
});

test("recipient snapshots keep the local pilot and omit distant combat", () => {
  const simulation = new Simulation({ map: getWorld(3), populationExpansion: false });
  const local = simulation.addPlayer("local", "Local");
  const nearby = simulation.addPlayer("nearby", "Nearby");
  const distant = simulation.addPlayer("distant", "Distant");
  Object.assign(local, { x: 0, z: 0 });
  Object.assign(nearby, { x: 20, z: 0 });
  Object.assign(distant, { x: 50, z: 0 });
  local.profileId = "local-profile";
  nearby.profileId = "nearby-profile";
  simulation.projectiles.set("near", { id: "near", owner: "nearby", weapon: "LASER", x: 20, z: 0 });
  simulation.projectiles.set("far", { id: "far", owner: "distant", weapon: "LASER", x: 50, z: 0 });

  const snapshot = simulation.snapshotFor("local", 32);
  assert.deepEqual(snapshot.players.map((p) => p.id).sort(), ["local", "nearby"]);
  assert.deepEqual(snapshot.projectiles.map((p) => p.id), ["near"]);
  assert.equal(snapshot.players.find((p) => p.id === "local").profileId, "local-profile");
  assert.equal(snapshot.players.find((p) => p.id === "nearby").profileId, undefined);
  assert.ok(snapshot.players.every((p) => p.nextFire === undefined && p.lastDamage === undefined));
});
