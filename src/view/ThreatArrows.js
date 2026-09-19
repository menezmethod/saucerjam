// Off-screen enemy indicators: an edge arrow per enemy that is outside the
// camera frustum. Gives phones the spatial awareness the desktop radar
// provides, without re-adding a wallhack minimap to every device.

/** Screen-space placement of an edge arrow for a camera-space direction. */
export function edgePlacement(dx, dy, width, height, margin = 26) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const halfW = Math.max(1, width / 2 - margin);
  const halfH = Math.max(1, height / 2 - margin);
  const scale = Math.min(ux ? halfW / Math.abs(ux) : Infinity, uy ? halfH / Math.abs(uy) : Infinity);
  return { x: width / 2 + ux * scale, y: height / 2 + uy * scale, angle: Math.atan2(uy, ux) + Math.PI / 2 };
}

export class ThreatArrows {
  constructor(container) {
    this.container = container;
    this.nodes = new Map();
    this.point = null;
  }
  update({ players = [], localId, camera, width = 0, height = 0, reduced = false } = {}) {
    if (!this.container) return;
    if (!camera || width <= 0 || height <= 0) { this.clear(); return; }
    const local = players.find((p) => p.id === localId);
    if (!local || !local.alive) { this.clear(); return; }
    const present = new Set();
    for (const p of players) {
      if (p.id === localId || !p.alive) continue;
      const node = this.nodes.get(p.id) || this.create(p);
      present.add(p.id);
      // Project into camera space; +x is screen-right, +y is screen-up.
      const v = { x: p.x - camera.position.x, y: 1 - camera.position.y, z: p.z - camera.position.z };
      const m = camera.matrixWorldInverse.elements;
      const cx = v.x * m[0] + v.y * m[4] + v.z * m[8];
      const cy = v.x * m[1] + v.y * m[5] + v.z * m[9];
      const cz = v.x * m[2] + v.y * m[6] + v.z * m[10];
      const behind = cz > 0;
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      const ndcX = cx / (-cz * tan * camera.aspect);
      const ndcY = cy / (-cz * tan);
      const onScreen = !behind && Math.abs(ndcX) < 0.92 && Math.abs(ndcY) < 0.88;
      if (onScreen) { node.style.opacity = "0"; continue; }
      const { x, y, angle } = edgePlacement(cx, -cy, width, height);
      node.style.opacity = "1";
      node.style.color = p.color || "#ff8792";
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${angle}rad) translate(-50%, -50%)`;
      if (reduced) node.style.transition = "none";
    }
    for (const [id, node] of this.nodes) if (!present.has(id)) { node.remove(); this.nodes.delete(id); }
  }
  create(p) {
    const node = document.createElement("i");
    node.dataset.player = p.id;
    this.container.appendChild(node);
    this.nodes.set(p.id, node);
    return node;
  }
  clear() { for (const [, node] of this.nodes) node.remove(); this.nodes.clear(); }
}
export default ThreatArrows;
