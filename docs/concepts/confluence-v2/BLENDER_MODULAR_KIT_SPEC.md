# Blender Modular Arena Asset Kit Specification

This specification defines the snap-to-grid 3D assets to be modeled in Blender (via Astra, Fable 5.0, or Blender Python MCP) for Saucer Jam's procedural world generation engine.

---

## 1. Visual Previews (Blender Viewport Targets)

````carousel
![Blender Modular Arena Asset Kit Preview](./images/modular_tiles_blender.jpg)
<!-- slide -->
![Assembled Arena Chunk in Blender](./images/assembled_arena_chunk.jpg)
````

---

## 2. Standard Grid & Modeling Units

* **Base Grid Metric:** $8.0\text{ m} \times 8.0\text{ m}$ (matches `shared/simulation.js` coordinate space).
* **Wall Height:** $3.5\text{ m}$ (blocks projectiles and laser ricochets cleanly).
* **Cover Barrier Height:** $1.2\text{ m}$ (destructible or half-height cover).
* **Origin Point:** Center of the bottom surface ($[0, 0, 0]$ at floor level).
* **Edge Sockets:** Every tile has 4 snap connection nodes at $(0, 4)$, $(4, 0)$, $(0, -4)$, and $(-4, 0)$.

---

## 3. The 8 Core Modular Assets

| # | Asset Name | Blender Object ID | Dimensions | Gameplay Behavior |
|---|------------|-------------------|------------|-------------------|
| 1 | **Straight Wall** | `Wall_Straight_8m` | $8\text{m} \times 1.2\text{m} \times 3.5\text{m}$ | Full collision; reflects lasers and bounce discs. |
| 2 | **Corner Wall** | `Wall_Corner_90` | $8\text{m} \times 8\text{m} \times 3.5\text{m}$ | $90^\circ$ turn barrier with reinforced corner cap. |
| 3 | **Conveyor Lane** | `Floor_Conveyor_8m` | $8\text{m} \times 8\text{m} \times 0.2\text{m}$ | Moving tread that applies $\pm 4.5\text{ u/s}$ carry velocity. |
| 4 | **Cryo Ice Plate** | `Floor_IceDrift_8m` | $8\text{m} \times 8\text{m} \times 0.1\text{m}$ | Low friction surface ($0.12$ friction coefficient) for drifting. |
| 5 | **Standard Deck** | `Floor_Deck_Panel` | $8\text{m} \times 8\text{m} \times 0.1\text{m}$ | Normal floor plating with subtle panel seams. |
| 6 | **Quantum Portal** | `Prop_Portal_Arch` | $4\text{m} \times 2\text{m} \times 5.0\text{m}$ | Interactive jump gate linking paired sector coordinates. |
| 7 | **Reactor Bloom** | `Prop_Reactor_Pedestal` | $3\text{m} \times 3\text{m} \times 2.0\text{m}$ | Timed objective pad that restores hull and energy. |
| 8 | **Blast Pillar** | `Prop_Pillar_Blast` | $3\text{m} \times 3\text{m} \times 4.0\text{m}$ | Heavy structural column for tactical circular cover. |

---

## 4. Export & Automation Pipeline for Astra / Fable

1. **Blender MCP Automation:**
   * Run Python script to generate geometry with beveled edges and UV-unwrapped lightmaps.
   * Assign emissive vertex colors / material slots for team hues (Cyan `#00e5ff`, Amber `#ff9100`, Emerald `#00e676`, Violet `#d500f9`).
2. **glTF Binary Export (`.glb`):**
   * Export each asset into `src/assets/models/tiles/` as `.glb`.
   * Keep triangle count under $1,200$ polys per tile to preserve 60 FPS in Three.js.
3. **Runtime Assembly (`World.js`):**
   * `Three.InstancedMesh` stamps these 8 pieces based on the sector's deterministic seed.
