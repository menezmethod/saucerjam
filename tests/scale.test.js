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
