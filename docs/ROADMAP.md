# SaucerJam — Incremental roadmap

Updated 19 September 2026.

## Direction

Release a reliable browser playtest -> learn from returning players -> deepen fights -> scale when demand warrants it.

Preserve the released movement, independent aiming, stable overhead view, weapon economy, and intense fighting pockets. Build ONE connected world with variable population boundaries; do not fragment players across unnecessary selectable arenas.

## Current product goal

**Launch a small public Jam Night and learn whether first-time players finish a round, play again, and return.** The 128-player battle remains a later scale goal.

Do not jump directly to "thousands." The distributed-world architecture becomes worthwhile only after:
- 128 players are measured and stable;
- players actually want larger battles;
- we understand the real bottleneck from production telemetry.

Scale progression:

`8 -> 32 -> 64 -> 128 -> demand validation -> distributed-world research`

## Scale workstream

Before increasing hard caps, measure:
- authoritative simulation tick time
- CPU/memory per active player
- outgoing/incoming bandwidth per player
- snapshot size and frequency
- projectile/collision cost
- client render cost with many visible players
- latency / packet loss behavior
- reconnect behavior under load

Likely optimizations toward 128:
1. spatial interest management
2. compact/delta replication
3. object pooling and projectile budgets
4. simulation profiling and hot-path cleanup
5. bot-driven reproducible load tests

If demand later justifies thousands, research:
- authoritative simulation cells
- seamless cell handoff
- hierarchical interest management
- server-to-server state transfer
- geographically distributed world regions

## Gameplay roadmap

| Order | Deliverable | Why |
| --- | --- | --- |
| 1 | Verify public hosting, real clients, persistence, and rollback | Make the play link dependable |
| 2 | Private first-time-player rehearsal | Find joining and control blockers |
| 3 | Small public Jam Night with measured capacity | Learn whether players replay and return |
| 4 | Combat readability and Confluence collision fixes from play | Address observed friction |
| 5 | Energy + instant-health pickups, portal, temporary shield | Add depth after the core loop is validated |
| 6 | Teams and objective mode | Give larger groups coordination |
| 7 | Measured 32-, 64-, then 128-player events | Expand only with host data and player demand |
| 8 | Original signature art and distributed-world research | Invest when the game has an audience |

## World foundation

Confluence is one connected world containing multiple districts. Territory expands with human population so a small lobby remains dense while a large lobby gains room to breathe.

Future expansion should be **population-driven**, not map-menu-driven.

The map itself becomes part of SaucerJam's identity:
- low population = tight fight
- medium population = districts open
- high population = full battlefield
- future scale = more territory/cells open as population requires it

## Art direction

Temporary clean licensed assets are acceptable for prototyping.

Signature SaucerJam ships, landmarks, factions, and collectibles should become original work with tracked provenance.

Art follows gameplay. Do not spend heavily on assets for systems/maps that may be discarded.

## Community evolution

Long-term feature loop:

`Idea -> Discussion -> RFC -> Prototype -> Playtest -> Vote/feedback -> Maintainer decision -> Canonical release`

Community voting guides priority; it does not bypass performance, security, moderation, or IP review.

The public version of this SaucerJam game roadmap will be published and voted on in the shared Fider portal at `community.menezmethod.com`. See [the public game roadmap](community-portal/FIDER_ROADMAP.md) and [deployment contract](community-portal/FIDER_SHARED_SERVICE.md). GitHub remains canonical for code, issues, pull requests, CI, provenance, and releases.

## North star

> **Release the game, learn from players, then earn the right to scale.**
