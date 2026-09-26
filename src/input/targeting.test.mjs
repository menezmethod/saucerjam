import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTarget } from "./targeting.js";

const openMap = { size: 25, obstacles: [] };

test("picks the nearer of two visible enemies", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  const players = [
    shooter,
    { id: "far", x: 10, z: 0, alive: true, protectedUntil: 0 },
    { id: "near", x: 3, z: 0, alive: true, protectedUntil: 0 },
  ];
  const target = pickTarget(shooter, players, 0, openMap);
  assert.equal(target.id, "near");
});

test("ignores dead and spawn-protected players", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  const players = [
    shooter,
    { id: "dead", x: 2, z: 0, alive: false, protectedUntil: 0 },
    { id: "shielded", x: 3, z: 0, alive: true, protectedUntil: 100 },
    { id: "valid", x: 5, z: 0, alive: true, protectedUntil: 0 },
  ];
  const target = pickTarget(shooter, players, 10, openMap);
  assert.equal(target.id, "valid");
});

test("ignores enemies outside maxRange", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  const players = [shooter, { id: "far", x: 999, z: 0, alive: true, protectedUntil: 0 }];
  assert.equal(pickTarget(shooter, players, 0, openMap, 22), null);
});

test("a wall between shooter and target blocks the pick", () => {
  const shooter = { id: "me", x: -5, z: 0 };
  const wallMap = { size: 25, obstacles: [{ type: "box", x: 0, z: 0, w: 2, d: 10, h: 4 }] };
  const players = [shooter, { id: "behind-cover", x: 5, z: 0, alive: true, protectedUntil: 0 }];
  assert.equal(pickTarget(shooter, players, 0, wallMap), null);
});

test("returns null with no valid enemies", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  assert.equal(pickTarget(shooter, [shooter], 0, openMap), null);
});
