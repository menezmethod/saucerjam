# Meshy / 3D-agent handoff

## Input

Use the per-asset prompts in [`TILE_PROMPTS.md`](./TILE_PROMPTS.md). Supply one clean reference board at a time. The generator is producing a starting mesh, not a shippable asset; Blender MCP owns scale, origin, topology, materials, and export.

## Required output

- one asset per GLB, not a whole arena in one file;
- flat, closed underside;
- no text, logos, UI, people, decals, or recognizable franchise marks;
- no baked exhaust, sparks, portal vortex, or pickup beam;
- named structural mesh plus optional emissive mesh;
- no hidden geometry outside the declared envelope;
- PBR textures, preferably one atlas and no texture larger than 1024px.

## Prompt suffix

Append this to every prompt:

> Production game asset, single modular object, exact metric proportions, clean hard-surface topology, flat closed underside, centered origin, four unobstructed edge sockets, neutral studio lighting, orthographic-friendly silhouette, separate emissive accents, optimized low-poly PBR, no text, no logos, no UI, no background scene, no floating presentation pedestal, no baked particles, no exhaust trails, no duplicate objects, no warped edges.

## Failure handling

If Meshy produces a warped footprint, merged prop, unreadable underside, or decorative overdraw, do not repair it by hand in the runtime. Regenerate with a narrower prompt or rebuild the simple geometry in Blender. A boring clean tile is preferable to a beautiful non-repeatable tile.

## Normalization order

1. Import GLB into a clean Blender scene.
2. Join only the asset's structural meshes; keep emissive/effect meshes separate.
3. Apply rotation, scale, and location.
4. Measure world-space bounds and fit the declared envelope.
5. Set origin to bottom center and add the four socket empties.
6. Remove hidden/interior faces and create collision proxy metadata.
7. Decimate only after silhouette and socket checks pass.
8. Export GLB, then run the headless load and manifest validators.
