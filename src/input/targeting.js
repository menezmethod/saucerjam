// Pure auto-target selection for one-hand mode and tap-to-aim: nearest
// living, unprotected enemy in range with a clear line of sight, reusing
// the same wall trace the simulation already uses for shots so a target
// behind cover is never picked.
import { traceWalls } from "../../shared/simulation.js";

// Sticky lock: two similarly-distant enemies otherwise flip the aim every
// single frame (whichever is a few centimeters closer that tick), which is
// the single biggest source of the touch-aim feeling "glitchy" rather than
// deliberate. The previous target is kept until it's actually gone (dead,
// protected, out of range, or blocked) or a new one is meaningfully
// closer, and even then only after a minimum dwell time.
export function pickTarget(shooter, players, time, map, options = {}) {
  const {
    maxRange = 22,
    previousId = null,
    lastSwitchAt = -Infinity,
    minSwitchInterval = 0.3,
    closerFactor = 0.75,
  } = options;
  let best = null,
    bestDist = Infinity;
  let previous = null,
    previousDist = Infinity;
  for (const p of players || []) {
    if (!p || p.id === shooter.id || !p.alive) continue;
    if (typeof p.protectedUntil === "number" && p.protectedUntil > time) continue;
    const dx = p.x - shooter.x,
      dz = p.z - shooter.z,
      dist = Math.hypot(dx, dz);
    if (dist > maxRange) continue;
    const hit = traceWalls(shooter.x, shooter.z, dx, dz, 0.3, map);
    if (hit && hit.t < 1) continue;
    if (p.id === previousId) {
      previous = p;
      previousDist = dist;
    }
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  if (!best) return null;
  if (previous && previous.id !== best.id) {
    const withinCooldown = time - lastSwitchAt < minSwitchInterval;
    const meaningfullyCloser = bestDist < previousDist * closerFactor;
    if (withinCooldown || !meaningfullyCloser)
      return { x: previous.x, z: previous.z, id: previous.id, switched: false };
  }
  return { x: best.x, z: best.z, id: best.id, switched: best.id !== previousId };
}
