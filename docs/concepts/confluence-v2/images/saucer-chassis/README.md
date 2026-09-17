# Saucer Chassis — 3D Modeling Reference Sheets

Multi-view reference sheets prepared for Meshy AI / Blender conversion.

## Asset layout

| Chassis | File | Primary details |
|---|---|---|
| Vector Interceptor | `vector-interceptor.png` | Top/front/side/rear/underside, ion trails, agility thrusters, laser cannons |
| Titan Dreadnought | `titan-dreadnought.png` | Heavy armor, dual plasma turret, flak cannon, engine exhaust, underside |
| Ghost Infiltrator | `ghost-infiltrator.png` | Stealth coating, glowing seams, silent thrusters, void missile bay |
| Pulsar Classic | `pulsar-classic.png` | Ring assembly, navigation array, neon pulse blaster, thrusters, underside |
| Bio-Matrix | `bio-matrix.png` | Organic hull, hive thrusters, acidic spore launcher, underside core |

## Meshy workflow

Use each sheet as the visual reference for a separate chassis model. The orthographic views should control silhouette and proportions; the 3/4 view should control overall form language; the detail callouts should guide weapons, vents, hull treatment, and engine geometry.

Treat exhaust/plasma/spore trails as separate VFX rather than baked hull geometry when producing the game-ready model.

### Recommended outputs

- Game-ready GLB/GLTF with PBR materials
- Separate emissive material slots for chassis glow
- Separate hardpoints for weapons / modular equipment
- Thruster locator empties/bones for runtime VFX
- LOD0 + simplified LOD1 for multiplayer rendering

> Source reference sheets were generated from the Confluence V2 modular saucer lineup concept and are intended as modeling references rather than final production geometry.
