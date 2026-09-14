# Asset Provenance and Approved Sources

## Rule

No provenance = no canonical release.

For each external asset record:
- asset name
- creator/source
- URL
- license at download time
- attribution requirement
- modifications
- importer/contributor
- original archive/source file when practical

## Preferred clean sources

### Kenney — first choice

Current asset pages for these packs state **CC0** (verify at download time — Kenney can change license terms per pack over time; verified for this doc in September 2026).

| Need | Pack | Source |
|---|---|---|
| 3D ships / planets / props | Space Kit | https://kenney.nl/assets/space-kit |
| Modular stations / structures | Modular Space Kit | https://kenney.nl/assets/modular-space-kit |
| Sci-fi UI | UI Pack - Sci-Fi | https://kenney.nl/assets/ui-pack-sci-fi |
| VFX | Particle Pack | https://kenney.nl/assets/particle-pack |
| Smoke/explosions | Smoke Particles | https://kenney.nl/assets/smoke-particles |
| Sci-fi SFX | Sci-fi Sounds | https://kenney.nl/assets/sci-fi-sounds |
| Impact SFX | Impact Sounds | https://kenney.nl/assets/impact-sounds |
| UI SFX | Interface Sounds | https://kenney.nl/assets/interface-sounds |
| Space backgrounds | Skyboxes | https://kenney.nl/assets/skyboxes |

Use these to replace questionable assets quickly. Over time, replace signature ships/landmarks with original community-created art so the game develops its own visual identity.

### Quaternius

Useful for 3D prototyping:
- Ultimate Space Kit: https://quaternius.com/packs/ultimatespacekit.html
- Spaceships Pack: https://quaternius.com/packs/spaceships.html
- License info: https://quaternius.com/license.html

Important: verify the **specific pack's license at download time**. Do not assume every pack from a creator uses the same license forever.

## Current repo assets requiring review

| Path | Status | Action |
|---|---|---|
| `src/assets/models/ships/avrocar_vz-9-av_experimental_aircraft.glb` | replaced | see "Replaced ship assets" below |
| `src/assets/models/ships/cryptos_saucer.glb` | replaced | see "Replaced ship assets" below |
| `src/assets/models/ships/ufo.glb` | replaced | see "Replaced ship assets" below |
| Suno music/SFX | generated asset | preserve commercial-rights evidence |

All three flagged ship models were replaced in the SaucerJam rebrand PR with original, self-modeled assets (see below) — none of the original unclear-provenance geometry ships in this repo.

## Replaced ship assets (SaucerJam rebrand)

All three files below are original low-poly models built from scratch in Blender 5.1.1 (procedural `bmesh` construction via the `blender` MCP server, exported with the built-in glTF 2.0 exporter, Khronos glTF Blender I/O v5.1.19). No third-party assets, downloads, or reference geometry were used at any point; the flagged originals they replace were, at most, inspected for scale class via their glTF headers and were never used as source geometry (`cryptos_saucer.glb`'s original was never opened at all, per this doc's own risk guidance). Visual direction (dark gunmetal hull + white armour plates + one neon accent color per ship, modular pods/power-core rings/sensor domes) came from the team's own concept sheet (`docs/concepts/confluence-v2/images/quantum_drift_ship_lineup.png` on the `design/confluence-gameplay-v2` branch), used as tone/shape guidance only — nothing was traced from it. Each model went through a render → self-critique → adjust loop before final export.

| Path | Creator/Source | URL | License | Attribution required? | Modifications | Importer |
|---|---|---|---|---|---|---|
| `src/assets/models/ships/ufo.glb` | Original, modeled in Blender via MCP for this project | n/a (original work) | CC0 / original, no restrictions | No | "Player ship" archetype (blue accent). 32-segment lathed saucer: dark gunmetal hull, rim wall with inset blue emissive band, raised deck with blue power-core ring and tinted-glass sensor dome, white/grey armour plates, prow wedge, 4 radial thruster pods, 4 running lights, belly ring. 2784 tris, 1 mesh, 2 materials, 1 embedded 64×64 PNG palette. ~3.3×3.7×1.2 m, Y-up, nose −Z. 110 KB. 3 render/critique iterations. | Cursor agent (Claude, `claude-fable-5-1-high`) via Blender MCP, 2026-09-14 |
| `src/assets/models/ships/cryptos_saucer.glb` | Original, modeled in Blender via MCP for this project | n/a (original work) | CC0 / original, no restrictions | No | "Assault ship" archetype (red accent), deliberately unrelated to the original it replaces. Hex hull (vertex forward), red emissive hex rim + power-core ring + glass dome, white/grey armour plates, twin toed-out forward cannon pods, twin side missile racks, twin rear thrusters, twin angular tail fins. 1062 tris, 1 mesh, 2 materials, 1 embedded palette PNG. ~3.3×4.0×1.1 m, Y-up, nose −Z. 68 KB. 2 render/critique iterations. | Cursor agent (Claude, `claude-fable-5-1-high`) via Blender MCP, 2026-09-14 |
| `src/assets/models/ships/avrocar_vz-9-av_experimental_aircraft.glb` | Original, modeled in Blender via MCP for this project | n/a (original work) | CC0 / original, no restrictions | No | "Heavy ship" archetype (orange accent). Octagonal disc with a recessed central turbine intake (canted blades, hub, fan glow — a nod to the real Avrocar's central fan concept, no geometry taken from anywhere), chunky top armour blocks, twin cockpit blisters, rear engine block, 3 heavy rear thrusters, belly ring. 1736 tris, 1 mesh, 2 materials, 1 embedded palette PNG. ~3.7×4.0×1.0 m, Y-up, nose −Z. 89 KB. 2 render/critique iterations. | Cursor agent (Claude, `claude-fable-5-1-high`) via Blender MCP, 2026-09-14 |

Format notes: glTF 2.0 binary, single node/mesh, two primitives (hull + glow) per file; Principled BSDF → glTF PBR metallic-roughness, glow parts use `KHR_materials_emissive_strength` (strength 4.0); one shared 64×64 flat-color palette PNG embedded per file (UV-mapped to swatch centers, so recoloring = editing a few pixels); no animations/skins/cameras/lights. GLB structure validated independently of Blender by parsing the header/JSON.

Do not use the old flagged assets (now removed from disk) in any marketing material — this note is now historical, since they are gone from the working tree; see git history on the old `quantum-drift` repo if you ever need to confirm what was removed.

## Preferred original-art pipeline

For signature content:

`concept -> provenance check -> original model -> gameplay LOD -> community review -> canonical asset -> optional printable version`

For 3D-printable items, keep the printable mesh license explicit and separate marketplace/commercial rights from in-game use rights.

## Contributor asset checklist

A PR adding visual/audio content must answer:

- Did you create this?
- If not, where did it come from?
- What exact license applies?
- Is commercial use allowed?
- Is modification allowed?
- Is attribution required?
- Was AI used?
- If AI was used, what model/service and what source/reference material was supplied?
- Can this asset legally appear in merchandise/3D prints, or only in-game?

If any answer is unknown, the asset stays out of the canonical release.
