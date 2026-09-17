# Blender modular kit specification

## Coordinate and socket contract

Blender may remain Z-up while authoring, but the export check must evaluate the glTF result in Three.js Y-up. Use one explicit conversion at the boundary: runtime `(x,y,z)` maps to Blender `(x,-z,y)`. The exported asset uses X width, Y height, Z depth, with its root at the grid-cell center.

Every tile occupies `[-4,+4]` on X and Z. Socket empties are named `SOCKET_N`, `SOCKET_E`, `SOCKET_S`, and `SOCKET_W`, placed at `(0,0,-4)`, `(+4,0,0)`, `(0,0,+4)`, and `(-4,0,0)`.

## Asset contracts

| ID | Render envelope | Collision/trigger | Budget |
|---|---|---|---|
| `floor_deck_standard` | 8×0.2×8m | none | 1,500 tris |
| `floor_conveyor_lane` | 8×0.25×8m | surface metadata | 1,500 tris |
| `floor_ice_drift` | 8×0.15×8m | surface metadata | 1,500 tris |
| `wall_straight_barrier` | 8×3.5×1.2m | box: w=8,d=1.2 | 1,500 tris |
| `wall_corner_90` | centerline N→E elbow inside 8×8m cell | two contiguous boxes or L proxy | 1,500 tris |
| `prop_blast_pillar` | ≤2.8×4×2.8m | circle: r=1.4 | 3,000 tris |
| `prop_reactor_bloom` | ≤3.2×2.2×3.2m | trigger: r=1.6 | 3,000 tris |
| `prop_quantum_portal` | ≤4.5×5×2m | trigger: r=1.2 | 3,000 tris |

The tile footprint belongs to the floor/base, not to a decorative floating plinth. Props may use a base only when it remains inside their envelope and does not create an accidental second floor. A corner wall uses the centerline elbow: a 1.2m-thick 4.6m north arm centered at `(0,-1.7)` and a 1.2m-thick 3.4m east arm centered at `(2.3,0)`, both 3.5m tall. This gives clean N/E sockets without overlapping full-length legs.

Ships use a centered hull origin and face runtime `+Z` at zero rotation. Their fair collision envelope is checked from actual X/Z vertices, not only from nominal dimensions.

## Manifest shape

```json
{
  "version": "1.0.0",
  "gridMeters": 8,
  "tiles": {
    "wall_straight_barrier": {
      "model": "assets/models/tiles/wall_straight_barrier.glb",
      "collision": {"type": "box", "w": 8, "d": 1.2},
      "sockets": {"N":"solid","E":"wall","S":"solid","W":"wall"}
    }
  }
}
```

The manifest is authoritative for gameplay metadata. A model file cannot silently change collision, friction, pickup radius, or portal behavior.

## Export acceptance

Apply transforms, remove hidden faces, triangulate, generate a simplified collision proxy, pack textures, and export GLB. Keep emissive strips and moving parts in separate named meshes so the renderer can instance the structural mesh and animate effects cheaply.
