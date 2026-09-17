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
- Status: idle recipient snapshots plus event/recap scope are complete; active socket measurement is next.
- Invariants: preserve authoritative simulation, independent aim, touch movement/fire, reconnect behavior, current desktop gameplay, and a readable top-down camera.

## Evidence

- `CONTROLS_PASS_01.md`; focused input/view tests 20/20 pass; interface tests 2/2 pass; production build passes.
- `north-star/01-nexus-tactical-v1.png` through `north-star/04-modular-kit-v1.png`; objective routes, world themes, modular kit, and performance constraints are explicit.
- `SCALE_BASELINE_01.md`; 128-pilot idle recipient snapshots average 17,142 bytes / 50 visible pilots. Events, recaps, and HUD population counts are recipient-safe, but active replication has not yet been measured and the public eight-pilot admission remains.

## NEXT_ACTION

Drive deterministic movement and firing through 8/32/64/128 local Socket.IO clients, measuring all-recipient bytes, tick lag, and reconnect behavior. Do not increase public room capacity or build portals, modes, weapons, or pickups until that evidence exists.

## Stop conditions

- No evidence of a player-facing improvement.
- Any multiplayer authority or input-security regression.
- Two unsuccessful refinements.
- Verification budget is insufficient to review the change honestly.
