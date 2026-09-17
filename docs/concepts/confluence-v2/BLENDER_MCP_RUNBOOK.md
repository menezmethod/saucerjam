# Blender MCP runbook

This is the deterministic cleanup contract after Meshy or another 3D agent returns a GLB. Do not rely on visual judgment alone.

## Tile job

1. Start a factory-fresh Blender scene.
2. Import exactly one GLB.
3. Identify structural meshes and keep emissive/effect meshes separate.
4. Apply transforms and measure the world-space bounding box.
5. Fit the mesh to the declared envelope without changing the X/Z aspect ratio.
6. Keep the tile root at its grid-cell center; set the lowest exported Y to 0. Do not recenter an asymmetric corner by its bounds.
7. Add `SOCKET_N/E/S/W` empties at the exact 8m edge coordinates.
8. Remove hidden faces, duplicate objects, non-manifold underside geometry, and accidental presentation bases.
9. Create or export collision metadata separately; never use the detailed render mesh as physics.
10. Create LOD1, pack/resize textures, export GLB, and run validators.

## Ship job

1. Import the reference-guided GLB into a clean scene.
2. Normalize the chassis into the common fair collision envelope.
3. Set origin at the visual center of the hull.
4. Add `mount_primary`, `mount_thruster_left`, and `mount_thruster_right` empties.
5. Keep canopy, emissive strips, and moving details in separate meshes.
6. Generate LOD1 and export with no baked trails or weapon effects.

## Validator checklist

Fail the job on any of the following: wrong axis, non-zero floor, off-grid socket, oversized bounds, open underside, unexpected material count, texture over 1024px, triangle budget overrun, missing hardpoint, or failed Three.js GLB load.

Blender's authoring Z-up and glTF's runtime Y-up are not interchangeable. Use `to_blender((x,y,z)) -> (x,-z,y)` once when authoring runtime coordinates, enable the normal glTF export conversion, and validate the exported GLB in the same coordinate system used by the browser. Do not add a second corrective rotation.
