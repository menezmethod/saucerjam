# SaucerJam Visual North Star v1

These are feasible visual and gameplay targets, not a request to reproduce a static scene.

| Image | Build intent |
| --- | --- |
| `01-nexus-tactical-v1.png` | Low-player combat court: open lanes, readable cover, four connection points. |
| `02-confluence-worlds-v1.png` | Connected-world progression: four distinct districts share a Nexus but retain their own route language. |
| `03-objective-routes-v1.png` | Team objective arena: unequal base layouts, a center shortcut, flanks, portals, flags, and contested pickups. |
| `04-modular-kit-v1.png` | The small reusable Blender/Three.js kit needed to build the routes: deck tiles, walls, cover, bridge, portal, objective and pickup pads. |

## Gameplay contract

- Maps use loops, shortcuts, pocketed cover, and portal rotations; no symmetric square deathmatch bowl.
- Team modes have deliberately unequal but equally defensible bases, clear flag return paths, and a contested center.
- Pickups are visible and contested: shield, speed, and weapon pads. Weapon roles stay legible: close scatter, precise bolt, and slow area control.
- A world is a combination of the same compact kit plus terrain/light themes. New geometry must not create invisible collision, inaccessible decoration, or an unreadable camera view.
- Premium lighting is a budget, not an excuse for expensive geometry: instanced deck/wall/rail modules, shared materials, restrained emissives, and limited foliage.

## Scale contract

- Every route is assembled from reusable, edge-compatible chunks: open deck, curved loop, cover pocket, bridge, portal junction, objective pocket, and themed dressing.
- A current combat zone targets up to 128 concurrent players. It stays playable by stitching a graph of these chunks into multiple hotspots rather than putting every player in one bowl.
- Eventual thousands of players means multiple connected zones using the same kit. Do not attempt one globally synchronized arena; cross-zone travel and population routing are a later systems problem.

## First implementation slice

Build the Nexus court from the existing arena patterns with only the deck/wall/cover kit and two portal endpoints. Verify a small match first, then measure a 128-player zone before adding another world, mode, weapon, or power-up.
