// Pure auto-target selection for one-hand mode: nearest living, unprotected
// enemy in range with a clear line of sight, reusing the same wall trace the
// simulation already uses for shots so a target behind cover is never picked.
import { traceWalls } from "../../shared/simulation.js";

export function pickTarget(shooter, players, time, map, maxRange = 22) {
  let best = null,
    bestDist = Infinity;
  for (const p of players || []) {
    if (!p || p.id === shooter.id || !p.alive) continue;
    if (typeof p.protectedUntil === "number" && p.protectedUntil > time) continue;
    const dx = p.x - shooter.x,
      dz = p.z - shooter.z,
      dist = Math.hypot(dx, dz);
    if (dist > maxRange || dist >= bestDist) continue;
    const hit = traceWalls(shooter.x, shooter.z, dx, dz, 0.3, map);
    if (hit && hit.t < 1) continue;
    best = p;
    bestDist = dist;
  }
  return best ? { x: best.x, z: best.z, id: best.id } : null;
}
