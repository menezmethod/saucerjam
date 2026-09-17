# SaucerJam v2 Loop State

Updated: 2026-09-17

## Baseline

- Branch: `codex/saucerjam-loop-v2`
- Default game branch remains untouched.
- Production build succeeds.
- Focused input/view tests pass (20/20), the interface tests pass (2/2), and the production build succeeds. Full browser acceptance remains in progress; physical iPhone/iPad Safari evidence is still required.
- Multiplayer, simulation, maps, rankings, and build suites pass.

## Active cycle

- Task: Establish a gameplay-first visual north star, then implement the smallest viable Nexus slice.
- Owner: Astra implementation agent; orchestrator review follows.
- Status: north-star complete; implementation has not started.
- Invariants: preserve authoritative simulation, independent aim, touch movement/fire, reconnect behavior, current desktop gameplay, and a readable top-down camera.

## Evidence

- `CONTROLS_PASS_01.md`; focused input/view tests 20/20 pass; interface tests 2/2 pass; production build passes.
- `north-star/01-nexus-tactical-v1.png` through `north-star/04-modular-kit-v1.png`; objective routes, world themes, modular kit, and performance constraints are explicit.

## NEXT_ACTION

Implement one Nexus court slice using edge-compatible chunks: loops, cover, and two portal endpoints. Validate a small match, then a 128-player zone; no new mode or weapon until that evidence exists. Capture browser evidence, then validate desktop Chrome and iPhone/iPad Safari before opening a merge-ready PR.

## Stop conditions

- No evidence of a player-facing improvement.
- Any multiplayer authority or input-security regression.
- Two unsuccessful refinements.
- Verification budget is insufficient to review the change honestly.
