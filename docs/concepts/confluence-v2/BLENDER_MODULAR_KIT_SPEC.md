# Blender modular kit specification

## Coordinate and socket contract

Blender may remain Z-up while authoring, but the export check must evaluate the glTF result in Three.js Y-up. The exported asset uses X width, Y height, Z depth, with its origin at the center of the bottom face.

Every tile occupies `[-4,+4]` on X and Z. Socket empties are named `SOCKET_N`, `SOCKET_E`, `SOCKET_S`, and `SOCKET_W`, placed at `(0,0,-4)`, `(+4,0,0)`, `(0,0,+4)`, and `(-4,0,0)`.

## Asset contracts

| ID | Render envelope | Collision/trigger | Budget |
|---|---|---|---|
| `floor_deck_standard` | 8×0.2×8m | none | 1,500 tris |
| `floor_conveyor_lane` | 8×0.25×8m | surface metadata | 1,500 tris |
| `floor_ice_drift` | 8×0.15×8m | surface metadata | 1,500 tris |
| `wall_straight_barrier` | 8×3.5×1.2m | box: w=8,d=1.2 | 1,500 tris |
| `wall_corner_90` | 8×3.5×8m envelope | two boxes or L proxy | 2,500 tris |
| `prop_blast_pillar` | ≤2.8×4×2.8m | circle: r=1.4 | 3,000 tris |
| `prop_reactor_bloom` | ≤3.2×2.2×3.2m | trigger: r=1.6 | 3,000 tris |
| `prop_quantum_portal` | ≤4.5×5×2m | trigger: r=1.2 | 3,000 tris |

The tile footprint belongs to the floor/base, not to a decorative floating plinth. Props may use a base only when it remains inside their envelope and does not create an accidental second floor.

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
