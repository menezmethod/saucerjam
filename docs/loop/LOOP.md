# SaucerJam v2 Loop

The loop is an evidence-driven collaboration between the orchestrator, Astra, specialist models, and the human owner.

## Roles

- **Orchestrator:** selects one bounded outcome, protects scope, reviews diffs/evidence, and decides accept/reject/redirect.
- **Astra:** performs heavy implementation, 3D/world work, browser play, screenshots, benchmarks, and first-pass refinement.
- **Fresh critic:** independently challenges feel, readability, device behavior, performance, and regressions.
- **Owner:** makes the final taste call on whether the game is worth showing.

## Cycle

1. Read `STATE.md` and select exactly one `NEXT_ACTION`.
2. Write acceptance criteria and invariants before implementation.
3. Astra implements the smallest complete slice and records evidence.
4. Run focused tests, build, and actual browser/play checks where required.
5. Fresh critic reviews the artifact, not the implementation summary.
6. Fix the highest-impact defect once; after two failed refinements, simplify or stop.
7. Update `STATE.md`, commit the checkpoint, and open a PR. Never write directly to `main`.

## Quality bar

Every player-facing slice must improve at least one of combat feel, tactical readability, visual identity, scale, or motivation without regressing controls, device compatibility, multiplayer authority, or performance.

“Showcase quality” requires actual evidence. Automated tests alone cannot establish fun, polish, or visual distinctiveness.
