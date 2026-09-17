# Confluence V2 asset production plan

## Goal

Create a small, copyright-safe, browser-friendly asset kit that can be recombined into many arenas. The kit must preserve SaucerJam's industrial/quantum visual language while keeping collision, networking, and rendering deterministic.

## Non-goals for the first pass

- Do not build an infinite-world generator yet.
- Do not add weapon-specific ship stats or pay-to-win hitboxes.
- Do not ship a marketplace, payments, or 3D-print fulfillment.
- Do not replace the working hand-authored maps until the vertical slice is proven.

## Canonical runtime contract

| Rule | Value |
|---|---|
| Tile footprint | 8m × 8m on X/Z |
| Coordinate convention | Three.js/glTF Y-up; X width, Z depth |
| Tile origin | bottom center at (0, 0, 0) |
| Grid seam | tile centers at integer multiples of 8m |
| Wall height | 3.5m maximum |
| Full wall thickness | 1.2m maximum |
| Tile LOD0 budget | ≤1,500 visible triangles |
| Prop LOD0 budget | ≤3,000 visible triangles |
| Ship LOD0 budget | ≤5,000 visible triangles |
| Materials | ≤4 slots; one 1024px atlas where possible |
| Runtime effects | separate meshes/particles, never baked into collision geometry |

Collision is data, not inferred from the render mesh. Every asset ships with a small proxy description (`box`, `circle`, or `trigger`) consumed by both server simulation and renderer.

## Production sequence

### Gate 0 — lock references

Keep the five supplied ship sheets as the canonical silhouette references. Regenerate the tile sheets as clean orthographic production boards: no labels, logos, UI, presentation plinths, or ambiguous background geometry. Record prompt, generator, date, and source hash in an asset ledger.

### Gate 1 — produce the vertical slice

Generate and normalize the five tiles and one ship listed in the README. Use [`TILE_PROMPTS.md`](./TILE_PROMPTS.md) and [`SHIP_PROMPTS.md`](./SHIP_PROMPTS.md); use Blender MCP only through [`BLENDER_MCP_RUNBOOK.md`](./BLENDER_MCP_RUNBOOK.md).

### Gate 2 — validate before integration

Reject an asset if any check fails:

- world-space bounds exceed its contract;
- origin is not bottom-centered;
- socket markers are not exactly on ±4m edges;
- underside is open or intersects the neighboring tile envelope;
- collision proxy does not match the playable silhouette;
- triangle/material/texture budgets are exceeded;
- text, logos, copyrighted marks, or baked VFX remain;
- GLB fails a headless Three.js load smoke test.

### Gate 3 — integrate one chunk

Assemble an 8×8 chunk from the manifest using a deterministic seed. Register collision and triggers from the same manifest. Verify movement, laser cover, ricochet, portal traversal, Reactor Bloom pickup radius, and mobile frame time against the existing map.

### Gate 4 — expand content, not complexity

Only after Gate 3 passes, add alternate wall lengths, deck variants, industrial/forest/cryo dressing, and ships 02–05. Prefer material swaps and instancing over unique meshes. Keep the collision vocabulary small.

### Gate 5 — stream chunks

Add server-side interest management and client chunk streaming separately from asset generation. Tiles reduce content cost; they do not solve replication. Measure bandwidth, CPU, draw calls, and memory at 32, 64, and 128 pilots before targeting larger rooms.

## Copyright and provenance

Use original prompts and the supplied project-owned reference sheets. Do not request recognizable franchise silhouettes, logos, faction marks, or direct recreations. Store provenance for every generated mesh and texture. Marketplace submissions later require the same provenance record and an automated rejection path.

## Definition of done

The first kit is done when a clean checkout can load the manifest, assemble a deterministic chunk, collide identically on server/client, render on desktop and mobile browsers, and fall back to a placeholder if a GLB is unavailable.
