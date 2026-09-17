# Ship generation prompts

The five sheets in `/Users/luisgimenez/Development/SaucerJam` are the canonical project references. Use each sheet as an image reference, but ask the generator for a clean mesh without the sheet's exhaust, labels, or callout panels.

## Clean ship-sheet prompt

> Create a production turnaround sheet for one original SaucerJam ship. Show one consistent chassis in three-quarter, top, front, rear, and side orthographic views on a neutral charcoal background. Keep the nose direction identical in every view. No text, callouts, logos, UI, display stand, pilot, exhaust plume, weapon beam, or duplicate ship. Include a faint scale grid and leave generous transparent padding around the silhouette.

## Shared constraints

> Original SaucerJam vehicle design, game-ready hard-surface or bio-mechanical asset, one ship only, centered longitudinal axis, readable top/front/side silhouette, fair compact collision envelope, separate weapon and thruster hardpoints, separate emissive materials, clean closed underside, optimized low-poly PBR, no text, no logo, no franchise resemblance, no pilot, no scene, no baked exhaust or weapon beam, no duplicate ship, no floating display stand.

## Ship 01 — Vector Interceptor

> Use the supplied Ship 01 reference. Fast wedge interceptor with a narrow pointed nose, two swept stabilizer fins, compact central cockpit/canopy, paired rear thruster housings, restrained cyan accents. Agile silhouette, no oversized engines, no wings that widen the collision envelope.

## Ship 02 — Titan Dreadnought

> Use the supplied Ship 02 reference. Broad armored saucer with concentric defensive plating, central command blister, four compact engine modules, amber service lights, visually heavy but still a single low-profile arena ship. No turret barrels protruding outside the fair envelope.

## Ship 03 — Ghost Infiltrator

> Use the supplied Ship 03 reference. Angular stealth craft with faceted dark shell, broken violet seam lights, recessed rear bay, tapered nose, and minimal external hardware. Keep the silhouette distinct through planes and negative space, not excessive spikes.

## Ship 04 — Pulsar Classic

> Use the supplied Ship 04 reference. Clean circular flying saucer with a raised glass-like central canopy, radial panel rhythm, small cyan emitters, and compact rear thrusters. Preserve the iconic saucer read while keeping all geometry original and gameplay-scale.

## Ship 05 — Bio-Matrix

> Use the supplied Ship 05 reference. Organic manta-like saucer with layered dark membranes, green bioluminescent channels, rounded central core, and three recessed rear vents. Use manufactured bio-tech forms, not recognizable creatures or franchise motifs.

## Ship acceptance

- Collision sphere/radius remains identical for every chassis.
- Weapon muzzle and two thruster empties are present and named.
- LOD0 ≤5,000 visible triangles; LOD1 ≤1,500.
- Effects are runtime attachments.
- No ship grants speed, health, energy, or weapon advantages.

## Review prompt

> Audit this generated ship against the supplied reference and SaucerJam constraints. Check silhouette consistency across views, closed underside, fair collision envelope, hardpoint visibility, triangle/material budget, absence of text or franchise marks, and separation of runtime VFX. Return `PASS` or a short list of concrete regeneration fixes; do not suggest gameplay stat changes.
