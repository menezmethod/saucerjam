# SaucerJam v2 Loop State

Updated: 2026-09-17

## Baseline

- Branch: `codex/saucerjam-loop-v2`
- Default game branch remains untouched.
- Production build succeeds.
- Full automated suite passes (100/100), production build succeeds, and Brave browser acceptance passes. Physical iPhone/iPad Safari evidence is still required.
- Multiplayer, simulation, maps, rankings, and build suites pass.

## Active cycle

- Task: Make a 128-pilot Confluence zone measurable before adding Nexus gameplay systems.
- Owner: Astra implementation agent; orchestrator review follows.
- Status: active socket measurement is complete; current replication is not viable for a 128-pilot zone.
- Invariants: preserve authoritative simulation, independent aim, touch movement/fire, reconnect behavior, current desktop gameplay, and a readable top-down camera.

## Evidence

- `CONTROLS_PASS_01.md`; focused input/view tests 20/20 pass; interface tests 2/2 pass; production build passes.
- `north-star/01-nexus-tactical-v1.png` through `north-star/04-modular-kit-v1.png`; objective routes, world themes, modular kit, and performance constraints are explicit.
- `SCALE_BASELINE_01.md`; 128-pilot idle recipient snapshots average 17,142 bytes / 50 visible pilots. Events, recaps, and HUD population counts are recipient-safe; active measurement is recorded separately and the public eight-pilot admission remains.
- `ACTIVE_SCALE_02.md`; at 128 moving/firing pilots, recipient state and events total about 98 MB/s raw locally. The public eight-pilot admission remains.

## NEXT_ACTION

Choose and verify the smallest replication reduction that keeps nearby combat coherent under active 128-pilot load. Do not increase public room capacity or build portals, modes, weapons, or pickups until active all-recipient traffic falls to a defensible level.

## Stop conditions

- No evidence of a player-facing improvement.
- Any multiplayer authority or input-security regression.
- Two unsuccessful refinements.
- Verification budget is insufficient to review the change honestly.
