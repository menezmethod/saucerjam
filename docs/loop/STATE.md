# SaucerJam v2 Loop State

Updated: 2026-09-17

## Baseline

- Branch: `codex/saucerjam-loop-v2`
- Default game branch remains untouched.
- Production build succeeds.
- Focused input/view tests pass (20/20), the interface tests pass (2/2), and the production build succeeds. Full browser acceptance remains in progress; physical iPhone/iPad Safari evidence is still required.
- Multiplayer, simulation, maps, rankings, and build suites pass.

## Active cycle

- Task: Make a 128-pilot Confluence zone measurable before adding Nexus gameplay systems.
- Owner: Astra implementation agent; orchestrator review follows.
- Status: baseline measured; recipient-specific replication is next.
- Invariants: preserve authoritative simulation, independent aim, touch movement/fire, reconnect behavior, current desktop gameplay, and a readable top-down camera.

## Evidence

- `CONTROLS_PASS_01.md`; focused input/view tests 20/20 pass; interface tests 2/2 pass; production build passes.
- `north-star/01-nexus-tactical-v1.png` through `north-star/04-modular-kit-v1.png`; objective routes, world themes, modular kit, and performance constraints are explicit.
- `SCALE_BASELINE_01.md`; idle local 128-pilot state is finite, but 44,652-byte full snapshots and current eight-pilot admission block a credible scale claim.

## NEXT_ACTION

Implement recipient-specific spatial snapshots for one Confluence zone, then measure real socket replication at 8/32/64/128. Do not increase public room capacity or build portals, modes, weapons, or pickups until that evidence exists.

## Stop conditions

- No evidence of a player-facing improvement.
- Any multiplayer authority or input-security regression.
- Two unsuccessful refinements.
- Verification budget is insufficient to review the change honestly.
