# SaucerJam Public Game Roadmap (published through Fider)

Status: canonical public game-roadmap source for the live Fider board at `community.saucerjam.com`.

Fider is the presentation and voting surface. The roadmap itself is for SaucerJam: what is shipped, what is next, what is being tested, and what is deferred. Future Menezmethod apps can use the same portal with an `app:<name>` tag.

## Now — launch foundation

- Keep the shared Fider application healthy with persistent Postgres and SMTP.
- Keep the SaucerJam categories: Bugs, Features, Combat & Balance, Mobile UX, Ships/Art/Lore, Agent Experiments, Questions, Announcements.
- Keep the `app:saucerjam` tag convention and the GitHub private security path.
- Make feature suggestions and roadmap voting the default community loop; use the in-game bridge for verified-pilot reports.

## Next — connect identity and the game

- Configure Fider’s custom OAuth provider against the existing Supabase Auth project.
- Verify sign-in, sign-out, email/profile claims, account ownership, and deletion behavior.
- Add `Community`, `Report feedback`, `Suggest an idea`, and `View roadmap` links to the SaucerJam menu and round recap.
- Pass only safe context: app, build, device category, map/mode, and an optional generated session reference.
- Never pass pilot tokens, access tokens, player names, precise locations, or private gameplay data.
- Verify that Fider being down never blocks loading, joining, combat, or reconnect.

## Then — connect feedback to delivery

- Use Fider statuses:
  `Inbox -> Needs details -> Triaged -> Duplicate -> Accepted -> Planned -> In progress -> Playtest -> Shipped -> Closed`.
- Configure a signed webhook to a trusted integration endpoint for new posts and status changes.
- Create or update GitHub issues only after validation and deduplication; include the originating Fider URL.
- Link pull requests and releases back to the Fider post.
- Allow agents to summarize, label, deduplicate, reproduce, draft tests, and open PRs.
- Require a human for scope decisions, provenance/IP/security review, merges, releases, and production changes.

## Public roadmap lanes

These are the product-level lanes that should become Fider roadmap categories or tagged views. A branch is evidence of work in progress, not a public promise; only accepted, tested scope moves to `Planned`.

| Lane | Public intent | Source of truth | Current disposition |
| --- | --- | --- | --- |
| Launch and Jam Nights | Make the public play link dependable, run small events, measure replay and return rate. | [`docs/ROADMAP.md`](../ROADMAP.md), [`docs/GO-TO-MARKET.md`](../GO-TO-MARKET.md) | Current priority |
| Mobile combat UX | Keep touch controls intuitive, compact, fullscreen-capable, and free of desktop-only instructions. | release/mobile commits and browser tests | Shipped baseline; continue from player evidence |
| Accounts and community reports | Supabase accounts plus the rate-limited server-side Fider report bridge. | `feature/supabase-auth`, current integration docs | Review and merge focused auth slice |
| Combat depth | Pickups, portal, temporary shield, then teams/objectives after the core loop is validated. | [`docs/ROADMAP.md`](../ROADMAP.md), [`docs/COMBAT-FIRST-PLAN.md`](../COMBAT-FIRST-PLAN.md) | Future, demand-gated |
| Confluence world and original assets | Authored districts, modular tiles, ships, provenance, and performance-safe runtime assets. | [`docs/concepts/confluence-v2/README.md`](../concepts/confluence-v2/README.md) | Future branch; do not promise dates |
| Scale | Measure 8 → 32 → 64 → 128 pilots before distributed-world work. | [`docs/ROADMAP.md`](../ROADMAP.md), scale evidence | Future, measurement-gated |
| Ships and marketplace | Community/agent ship contributions with provenance, review, playtest, and possible marketplace policy later. | [`docs/concepts/confluence-v2/SPACESHIP_MARKETPLACE_PLAN.md`](../concepts/confluence-v2/SPACESHIP_MARKETPLACE_PLAN.md) | Deferred until audience and policy exist |
| Agent-human ecosystem | Agents triage, prototype, and open PRs; humans approve canonical adoption. | [`docs/PUBLIC-LAUNCH-FOUNDATION.md`](../PUBLIC-LAUNCH-FOUNDATION.md) | Operating policy, not automatic delivery |

## Later — make the portal useful across apps

- Add future apps as `app:<name>` tags on the same board.
- Add a saved view/roadmap section per app without creating separate portals.
- Track time-to-triage, duplicate rate, reproducible-bug rate, votes per active player, accepted ideas, shipped requests, repeat contributors, and moderation actions.
- Add export and restore drills before relying on Fider as the long-term system of record for community history.
- Review Fider releases and security advisories before upgrades; pin production images rather than silently tracking mutable changes.

## Branch and plan disposition

| Work | Current location | Decision |
| --- | --- | --- |
| Release baseline | `main` | Keep as the deployable baseline until the next reviewed merge. |
| Supabase auth | `feature/supabase-auth` | Review as a focused candidate; merge only after auth/browser checks pass. |
| SaucerJam mobile/auth/Confluence slice | `design/confluence-v2-production-plan` | Treat as an integration candidate, not an automatic wholesale merge; split or review by concern. |
| Confluence concepts and asset references | `design/confluence-v2-concepts` | Keep as future art/concept work until a bounded asset task is approved. |
| Rebrand history | `rebrand/saucerjam-launch` | Historical/superseded unless a specific commit is needed. |
| Orca worktree | `menezmethod/rockling` | Do not merge blindly; inspect its diff only if it contains a needed change. |
| Community portal docs and Fider template | current working tree | Canonical planning/deployment contract; merge with the chosen product slice. |

The branch table is a decision aid, not permission to merge every branch. A branch becomes mergeable only when its focused diff has tests, provenance, and a rollback path.

## Definition of ready

The shared portal is ready for public links when:

1. `community.saucerjam.com` serves Fider over HTTPS.
2. Supabase login works and does not expose secrets.
3. SaucerJam bug/feature links open the correct category and app tag.
4. Mobile and desktop submissions work.
5. Fider outage is non-blocking to gameplay.
6. A Fider post can be traced to a GitHub issue/PR and back to the shipped release.
7. Backups, restore, moderation, deletion/export, and webhook failure behavior are documented.
