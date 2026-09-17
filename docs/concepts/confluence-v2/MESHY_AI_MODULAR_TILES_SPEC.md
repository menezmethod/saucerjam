# No-waste Meshy → Blender handoff

## Decision

Use **GPT image generation → Meshy Image to 3D → Blender cleanup**.

Meshy is the first 3D generator because a consistent image turnaround gives it a concrete visual target. Use 3D-Agent only after a Meshy GLB is visually approved, for a constrained Blender cleanup job. Do not ask either tool to invent the asset from technical requirements alone.

Do not write runtime code, create primitive stand-ins, or request cleanup before an asset passes the visual gate below.

## 1. Create the only input Meshy needs

Generate one 2×2 turnaround sheet per asset in GPT, then crop its four panels into separate PNGs. The four panels must depict the *same object* under identical materials and lighting.

Use this master prompt, followed by the relevant payload in [`TILE_PROMPTS.md`](./TILE_PROMPTS.md):

> Create a crop-ready 2×2 orthographic turnaround sheet of exactly one original SaucerJam game asset. Each panel shows the identical object at the same scale: top, front, right, and three-quarter view. Clean neutral light-gray background, even studio lighting, no ground plane, no cast shadow, no text, labels, arrows, grid, dimensions, logo, UI, frame, character, or extra object. Industrial near-future kit: graphite ceramic-metal panels, restrained cyan recessed utility lights, small amber service accents, manufactured hard-surface construction, bevels and panel seams appropriate for a premium modular arena. Preserve clean outer silhouette and make every edge fully visible.

For the wall and portal, replace `top` with `rear`; their upright silhouettes matter more than a second overhead view. Do not use the supplied multi-asset mood/reference sheet as one of Meshy's views—it is style reference for GPT, not reconstruction input.

## 2. Generate exactly one candidate in Meshy

1. Open **3D Model → Image to 3D** and upload the four cropped views.
2. Choose **Meshy 7 / Standard**, multi-view, texture enabled, and GLB export.
3. Leave Ultra off. It costs more and is not justified before the silhouette is approved.
4. Turn Image Enhancement off for a clean GPT turnaround; use it only if the source image is visibly soft or noisy.
5. Review the model from all sides before spending a second generation or any remesh credits.

The first uploaded image is the primary view, so upload the most informative view first: usually three-quarter for a prop or wall, top for a deck. A single image is acceptable only for an inexpensive silhouette test; it is not an approval candidate because Meshy must guess the unseen faces.

## Visual gate: regenerate or proceed

Proceed only if every answer is yes:

- Does it clearly match the chosen GPT turnaround and the graphite/cyan/amber kit style?
- Is it one object, with no floor slab, display plinth, labels, logos, baked beams, vortex, smoke, or particles?
- Are its tile edges, wall ends, or prop footprint clean enough to be made modular without redesigning the silhouette?
- Does it have useful material separation: body, dark recesses, and emissive detail?

If any answer is no, regenerate from a better turnaround. Do not ask Astra or 3D-Agent to rescue a bad generation.

## 3. Spend one cleanup pass only after approval

Import the approved GLB into Blender, then give 3D-Agent this prompt:

> This GLB is visually approved. Do not redesign it, add props, change its materials, or create gameplay collision. Perform only production cleanup: delete presentation bases/hidden interiors and baked VFX; preserve the approved silhouette; apply transforms; set the authored asset root at the required pivot; separate emissive geometry/material from structural geometry; keep textures at or below 1024px; make the underside closed; export GLB. Report the final bounds, triangle count, material count, and any limitation instead of silently changing the design.

Append the asset's exact contract:

| Asset | Cleanup contract |
|---|---|
| `floor_deck_standard` | 8×0.2×8m, root at tile center, floor at Y=0, `SOCKET_N/E/S/W` at the four 8m edge midpoints, ≤1,500 triangles. |
| `wall_straight_barrier` | 8×3.5×1.2m, root at grid-cell center, exact end alignment, ≤1,500 triangles. |
| `wall_corner_90` | N→E centerline elbow inside 8×8m, no overlapping full-length legs, ≤1,500 triangles. |
| `prop_reactor_bloom` | ≤3.2×2.2×3.2m, root at base center, no pickup orb/beam baked in, ≤3,000 triangles. |
| `prop_quantum_portal` | ≤4.5×5×2m, root at base center, clear opening, no vortex baked in, ≤3,000 triangles. |
| `ship_01_vector` | Nose faces runtime +Z, centered hull origin, hardpoints `mount_primary`, `mount_thruster_left`, `mount_thruster_right`, ≤5,000 triangles. |

Collision, triggers, pickup radius, and portal behavior remain manifest metadata. Render geometry never defines gameplay.

## Order and budget discipline

Start with **one straight barrier wall**. Approve its image and GLB before generating any other asset. Reuse its accepted GPT art direction for the deck, corner, portal, Bloom, and ship.

Only the approved GLB gets one Meshy remesh/texture pass if it exceeds the budget, then one Blender cleanup pass. A failed candidate is regenerated from the image stage; it is never polished through repeated agent conversations.
