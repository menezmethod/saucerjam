// Testing mode: public quick-play funnels every pilot into ONE shared arena so
// friends who both press "Play online" actually meet, whatever map they picked.
// Private rooms (create / join by code) keep their own code.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { createGameServer } = require("../server/server");

async function connect(url) {
  const socket = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
const join = (socket, data) => new Promise((resolve, reject) =>
  socket.timeout(2000).emit("join", data, (error, result) => (error ? reject(error) : resolve(result))));

test("quick play lands every pilot in the same public arena, even with different maps", async (t) => {
  const game = createGameServer({ allowLegacyMaps: true });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const a = await connect(url);
  const b = await connect(url);
  t.after(async () => { a.disconnect(); b.disconnect(); await game.close(); });

  const first = await join(a, { mode: "quick", mapId: "glacier", name: "Alpha" });
  assert.ok(!first.error, first.error);
  const second = await join(b, { mode: "quick", mapId: "classic", name: "Bravo" });
  assert.ok(!second.error, second.error);
  assert.equal(first.code, second.code, "both quick-play pilots share one arena");
  assert.ok(first.code.startsWith("PUBLIC"), first.code);
  assert.equal(game.rooms.size, 1, "only one public room exists");
});

test("private rooms still get their own code, separate from the public arena", async (t) => {
  const game = createGameServer({ allowLegacyMaps: true });
  await new Promise((resolve) => game.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const a = await connect(url);
  const b = await connect(url);
  t.after(async () => { a.disconnect(); b.disconnect(); await game.close(); });

  const pub = await join(a, { mode: "quick", name: "Alpha" });
  const priv = await join(b, { mode: "create", bots: false, name: "Bravo" });
  assert.ok(!pub.error && !priv.error);
  assert.notEqual(pub.code, priv.code, "a created room is its own room");
  assert.ok(!priv.code.startsWith("PUBLIC"), priv.code);
  assert.equal(game.rooms.size, 2, "public arena + private room");
});
