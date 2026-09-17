# Tile generation prompts

Use one payload per asset with the master GPT turnaround prompt in [`MESHY_AI_MODULAR_TILES_SPEC.md`](./MESHY_AI_MODULAR_TILES_SPEC.md). These are image-direction prompts, not Meshy text-to-3D prompts.

## 01 — standard deck

> An 8 meter square modular sci-fi arena floor deck, dark graphite alloy panels, restrained cyan power seams, four clean straight tile edges, shallow beveled panel joints, practical industrial construction, readable from a three-quarter top-down camera. No raised wall, no props, no hazard stripes across the playable center.

Acceptance: flat 8×8m footprint, 0.2m height, walkable center, seams stop at the boundary.

## 02 — conveyor lane

> An 8 meter square modular industrial conveyor floor tile, recessed parallel rollers in a central lane, narrow yellow-black safety edging only at the lane borders, dark steel frame, service panels, visible direction arrows expressed through geometry not text. The surrounding tile boundary remains square and flush with neighboring deck tiles.

Acceptance: rollers do not protrude beyond the footprint; carry direction is stored as metadata, not inferred from the art.

## 03 — ice drift

> An 8 meter square modular cryogenic floor tile, thin translucent blue-white ice over a reinforced deck, subtle frozen cracks and coolant channels, low profile, readable grid edges, no snow mound and no jagged border.

Acceptance: 0.15m height, flat boundary, no transparent collision ambiguity; friction is manifest data.

## 04 — straight barrier

> A single straight 8 meter modular arena barrier, 1.2 meter thick and 3.5 meters tall, dark segmented armor ribs, a restrained cyan light strip inset into the face, reinforced end caps that meet a neighboring wall cleanly, closed solid back.

Acceptance: exact 8m span, 1.2m thickness, no base plate extending into adjacent tiles, opaque collision face.

## 05 — 90-degree corner

> A single centerline 90-degree N-to-E modular arena barrier inside one 8 meter grid cell, two contiguous short arms meeting at the center, 1.2 meter thickness, one reinforced outside corner, cyan conduit accents, clean interior playable corner, no full-length overlapping legs.

Acceptance: north and east sockets land exactly on the cell edges; the two arms share one corner without overlap; no diagonal cut and no extra floor.

## 06 — portal arch

> A compact upright quantum portal arch on a low integrated footprint, dark machined ring, blue-white edge emitters, empty center opening with a separate placeholder disc for the warp effect, short access lip, readable from all gameplay angles.

Acceptance: prop stays inside a 4.5×5×2m envelope; the vortex is a runtime effect, not baked geometry.

## 07 — Reactor Bloom

> A compact circular Reactor Bloom pedestal, mechanical three-part base, green energy coil recess, a simple empty center socket for a runtime pickup orb, low profile, high contrast silhouette, no medical cross, no text, no floating beam.

Acceptance: prop stays inside a 3.2×2.2×3.2m envelope; pickup radius is metadata; glow is a separate emissive mesh.

## 08 — blast pillar

> A heavy hexagonal blast-cover pillar, dark titanium plates, recessed amber service lights, subtle structural seams, stable square footprint, readable silhouette from top-down play, no attached floor tile.

Acceptance: circular collision proxy radius 1.4m; visual cannot create an overhang that changes cover unfairly.

## Regeneration rule

Regenerate a tile sheet when it shows presentation UI, inconsistent scale, baked effects, ambiguous sockets, or a decorative base that would collide. Do not regenerate solely to chase more detail; detail is useful only after the repeatable shape works.
