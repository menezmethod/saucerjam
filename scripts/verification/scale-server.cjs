const { io } = require("socket.io-client");
const { createGameServer } = require("../../server/server");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connect = (url) => new Promise((resolve, reject) => {
  const socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  socket.once("connect", () => resolve(socket));
  socket.once("connect_error", reject);
});
const join = (socket, request) => new Promise((resolve, reject) =>
  socket.timeout(4000).emit("join", request, (error, response) => error ? reject(error) : resolve(response)),
);

async function measure(population) {
  const game = createGameServer({ maxConnections: 256, maxPlayersPerRoom: 128, rankingsFile: null });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const clients = [];
  const packets = [];
  try {
    const first = await connect(url);
    clients.push(first);
    packets.push({ stateBytes: 0, stateSamples: 0, eventBytes: 0, eventSamples: 0, visiblePilots: 0 });
    const room = await join(first, { mode: "create", bots: false });
    for (let i = 1; i < population; i++) {
      const client = await connect(url);
      clients.push(client);
      packets.push({ stateBytes: 0, stateSamples: 0, eventBytes: 0, eventSamples: 0, visiblePilots: 0 });
      await join(client, { mode: "join", code: room.code, bots: false });
    }
    clients.forEach((client, index) => {
      client.on("state", (state) => {
        const size = Buffer.byteLength(JSON.stringify(state));
        packets[index].stateBytes += size;
        packets[index].stateSamples++;
        packets[index].visiblePilots += state.players.length;
      });
      client.on("events", (events) => {
        packets[index].eventBytes += Buffer.byteLength(JSON.stringify(events));
        packets[index].eventSamples++;
      });
    });
    await wait(150);
    for (const packet of packets) Object.assign(packet, { stateBytes: 0, stateSamples: 0, eventBytes: 0, eventSamples: 0, visiblePilots: 0 });
    const start = performance.now();
    const startTick = game.rooms.get(room.code).sim.tick;
    const sequence = Array.from({ length: population }, () => 0);
    const inputTimer = setInterval(() => clients.forEach((client, index) => client.emit("input", {
      seq: ++sequence[index],
      move: { x: index % 2 ? 1 : -1, z: index % 3 ? 0.5 : -0.5 },
      fire: true,
      weapon: "LASER",
      aim: { x: 0, z: 0 },
    })), 50);
    await wait(1500);
    clearInterval(inputTimer);
    await wait(150);
    const elapsedSeconds = (performance.now() - start) / 1000;
    const totals = packets.reduce((total, packet) => ({
      stateBytes: total.stateBytes + packet.stateBytes,
      stateSamples: total.stateSamples + packet.stateSamples,
      eventBytes: total.eventBytes + packet.eventBytes,
      eventSamples: total.eventSamples + packet.eventSamples,
      visiblePilots: total.visiblePilots + packet.visiblePilots,
    }), { stateBytes: 0, stateSamples: 0, eventBytes: 0, eventSamples: 0, visiblePilots: 0 });
    return {
      population,
      durationSeconds: Number(elapsedSeconds.toFixed(2)),
      serverTickHz: Number(((game.rooms.get(room.code).sim.tick - startTick) / elapsedSeconds).toFixed(1)),
      aggregateStateBytesPerSecond: Math.round(totals.stateBytes / elapsedSeconds),
      aggregateEventBytesPerSecond: Math.round(totals.eventBytes / elapsedSeconds),
      meanSnapshotBytes: Math.round(totals.stateBytes / Math.max(1, totals.stateSamples)),
      meanEventBytes: Math.round(totals.eventBytes / Math.max(1, totals.eventSamples)),
      meanVisiblePilots: Number((totals.visiblePilots / Math.max(1, totals.stateSamples)).toFixed(1)),
    };
  } finally {
    clients.forEach((socket) => socket.disconnect());
    await game.close();
  }
}

async function main() {
  const samples = [];
  for (const population of [8, 32, 64, 128]) samples.push(await measure(population));
  console.log(JSON.stringify({ map: "confluence", samples }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
