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
  assert.equal(pickTarget(shooter, players, 0, openMap, { maxRange: 22 }), null);
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

test("sticky lock: two similarly-distant enemies don't flip every frame", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  const players = [
    shooter,
    { id: "a", x: 5, z: 0, alive: true, protectedUntil: 0 },
    { id: "b", x: 4.8, z: 0, alive: true, protectedUntil: 0 },
  ];
  const first = pickTarget(shooter, players, 0, openMap, { previousId: null });
  assert.equal(first.id, "b");
  assert.equal(first.switched, true);
  const second = pickTarget(shooter, players, 0.05, openMap, {
    previousId: first.id,
    lastSwitchAt: 0,
  });
  assert.equal(second.id, "b", "5% closer should not steal the lock");
  assert.equal(second.switched, false);
});

test("sticky lock releases once the locked target is dead", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  const players = [
    shooter,
    { id: "a", x: 5, z: 0, alive: false, protectedUntil: 0 },
    { id: "b", x: 8, z: 0, alive: true, protectedUntil: 0 },
  ];
  const target = pickTarget(shooter, players, 1, openMap, { previousId: "a", lastSwitchAt: 0 });
  assert.equal(target.id, "b");
  assert.equal(target.switched, true);
});

test("a meaningfully closer enemy still steals the lock after the cooldown", () => {
  const shooter = { id: "me", x: 0, z: 0 };
  const players = [
    shooter,
    { id: "a", x: 10, z: 0, alive: true, protectedUntil: 0 },
    { id: "b", x: 2, z: 0, alive: true, protectedUntil: 0 },
  ];
  const target = pickTarget(shooter, players, 1, openMap, { previousId: "a", lastSwitchAt: 0 });
  assert.equal(target.id, "b");
  assert.equal(target.switched, true);
});
