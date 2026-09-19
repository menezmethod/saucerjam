# Asset vertical slice checkpoint 01

Updated: 2026-09-17

## Scope

Build only the first Confluence V2 asset slice: standard deck, straight wall, corner wall, Reactor Bloom, quantum portal, and Ship 01. Use procedural placeholders until generated GLBs pass validation.

## Constraints

- 8m tile grid; Three.js/glTF Y-up at runtime.
- Collision comes from manifest metadata, never from decorative render geometry.
- Tile ≤1,500 visible triangles; props ≤3,000; ship ≤5,000.
- No new weapons, ship stats, marketplace, or infinite streaming in this checkpoint.

## Evidence required to advance

1. Manifest loads and produces deterministic tile transforms.
2. One 8×8 chunk has flush seams and no overlapping collision proxies.
3. Server/client movement, projectile cover, portal trigger, and Reactor Bloom trigger agree.
4. Desktop and mobile browser smoke tests pass with a procedural fallback.
5. Generated GLBs, if present, pass bounds, pivot, socket, budget, and load validation.

## Current state

- Prompts and the production handoff are complete in `docs/concepts/confluence-v2/`.
- Astra design review corrected runtime `+Z` ship orientation, Blender axis conversion, and the non-overlapping centerline corner-wall geometry.
- `scripts/assets/build_slice.py` now provides deterministic procedural GLB placeholders and a slice manifest when run through Blender MCP.
- Runtime still uses the existing hand-authored maps and procedural primitives.
- Next action: run the script in Blender MCP, validate the six outputs, then wire one procedural chunk into the browser.
