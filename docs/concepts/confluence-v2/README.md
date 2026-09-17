# Confluence V2: production asset handoff

This folder is the design handoff for SaucerJam's reusable arena tiles and ship chassis. It is a plan, not a claim that the tile runtime or marketplace already exists.

## Source of truth

1. [`ASSET_PRODUCTION_PLAN.md`](./ASSET_PRODUCTION_PLAN.md) — scope, gates, runtime contract, and rollout.
2. [`TILE_PROMPTS.md`](./TILE_PROMPTS.md) — generator prompts and per-tile acceptance criteria.
3. [`SHIP_PROMPTS.md`](./SHIP_PROMPTS.md) — prompts for the five supplied chassis references.
4. [`BLENDER_MCP_RUNBOOK.md`](./BLENDER_MCP_RUNBOOK.md) — deterministic Blender cleanup/export steps.
5. [`BLENDER_MODULAR_KIT_SPEC.md`](./BLENDER_MODULAR_KIT_SPEC.md) — dimensions, sockets, budgets, and manifest shape.
6. [`MESHY_AI_MODULAR_TILES_SPEC.md`](./MESHY_AI_MODULAR_TILES_SPEC.md) — Meshy handoff format and failure handling.
7. [`SPACESHIP_MARKETPLACE_PLAN.md`](./SPACESHIP_MARKETPLACE_PLAN.md) — deferred marketplace boundaries.

The existing JPG/PNG boards remain visual inspiration. They are not production geometry: perspective, presentation bases, labels, baked exhaust, and inconsistent scale must not be copied into game assets.

Reference boards: [`modular_tile_world.jpg`](./images/modular_tile_world.jpg), [`modular_arena_districts.jpg`](./images/modular_arena_districts.jpg), [`modular_tiles_blender.jpg`](./images/modular_tiles_blender.jpg), [`assembled_arena_chunk.jpg`](./images/assembled_arena_chunk.jpg), and [`spaceship_lineup_sheet.jpg`](./images/spaceship_lineup_sheet.jpg). Individual tile boards live in [`images/tiles/`](./images/tiles/); ship views are indexed in [`images/saucer-chassis/README.md`](./images/saucer-chassis/README.md).

## First deliverable

Ship one playable vertical slice before generating a library:

`floor_deck_standard` + `wall_straight_barrier` + `wall_corner_90` + `prop_reactor_bloom` + `prop_quantum_portal` + `ship_01`.

The slice must assemble on an 8m grid, use the same collision metadata on server and client, and pass validation before additional tiles are commissioned.

## Current status

- The merged gameplay branch uses hand-authored maps and optimized procedural primitives.
- This branch fixes the asset documentation and generation contract only.
- GLB generation, tile streaming, custom ship loading, and marketplace transactions are future implementation work.
