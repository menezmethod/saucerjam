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
  try {
    const first = await connect(url);
    clients.push(first);
    const room = await join(first, { mode: "create", bots: false });
    for (let i = 1; i < population; i++) {
      const client = await connect(url);
      clients.push(client);
      await join(client, { mode: "join", code: room.code, bots: false });
    }
    const states = [];
    first.on("state", (state) => states.push(state));
    await wait(300);
    const bytes = states.map((state) => Buffer.byteLength(JSON.stringify(state)));
    return {
      population,
      stateSamples: states.length,
      meanSnapshotBytes: Math.round(bytes.reduce((sum, size) => sum + size, 0) / Math.max(1, bytes.length)),
      maxSnapshotBytes: Math.max(0, ...bytes),
      meanVisiblePilots: Number((states.reduce((sum, state) => sum + state.players.length, 0) / Math.max(1, states.length)).toFixed(1)),
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
