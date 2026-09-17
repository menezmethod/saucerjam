const { performance } = require("node:perf_hooks");
const { Simulation } = require("../../shared/simulation");
const { getWorld } = require("../../shared/maps");

const measure = (population) => {
  const simulation = new Simulation({ map: getWorld(3), populationExpansion: false });
  const spawnStarted = performance.now();
  for (let i = 0; i < population; i++) simulation.addPlayer(`pilot-${i}`, `Pilot ${i}`);
  const spawnMs = performance.now() - spawnStarted;
  const tickStarted = performance.now();
  for (let tick = 0; tick < 60; tick++) simulation.step();
  const tickMs = performance.now() - tickStarted;
  const snapshot = simulation.snapshot();
  return {
    population,
    spawnMs: Number(spawnMs.toFixed(2)),
    simulatedSecondMs: Number(tickMs.toFixed(2)),
    fullSnapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
  };
};

console.log(JSON.stringify({ map: "confluence", samples: [8, 32, 64, 128].map(measure) }, null, 2));
