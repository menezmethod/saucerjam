# SaucerJam launch strategy

Grounded in what now exists: real `/metrics`, retention counters, community
automation, and a game that is verified across 26 devices. Every tactic below
ties to a number we can actually read afterwards.

## Positioning

**One-line:** *Fast browser arena combat. No download, no account, fly in one
click.* — the whole pitch is lower friction than anything it competes with.

- Category: instant-play browser arena shooter (Slither/Diep/Krunker lineage),
  not a deep-systems game yet.
- Differentiator to lead with: **zero-friction** (click → flying in ~3s) and
  **one connected world** that expands as more humans join.
- Don't claim parity with Console/PC shooters; the honest pitch is "the fastest
  way to be in a battle with your friends in a browser tab."

## The funnel we will actually measure

| Stage | Metric | Where |
| --- | --- | --- |
| Landed | page views | host/CDN logs + `/api/statistics` poll volume |
| Played | `saucerjam_joins_total` | Grafana |
| Enjoyed | `rounds_completed_total / joins_total` (% who finish a round) | Grafana |
| Came back | `distinct_pilots_7d` | Grafana |
| Told others | room invite links / Fider posts | Fider + `community_ingest_total` |
| Cared | `community_actions_total` | Grafana |

Decision rule: if landed→played is fine but completed→returned is weak, the
problem is the game, not the marketing. Instrument first, then spend.

## Pre-launch (week -2 to -1)

1. Ship this PR, confirm `/metrics` is scraped (target `health=up`), and watch
   the dashboard for 24h on a quiet link.
2. Fix any `SaucerJam*` alert that fires with zero players — a monitoring stack
   that cries wolf is worse than none.
3. Record the **20-second hook**: a single practice round, no talking, ship
   exploding at the end. This is the asset everything else reuses.
4. Prepare accounts: itch.io page, a Product Hunt listing, a Discord, and the
   Fider board linked as the roadmap.

## Launch (week 0)

Day 1 — **itch.io** (long tail, easy) + **Discord** to friends/communities.
Day 2 — **Reddit**: r/WebGames, r/browser_games, r/playmygame. One post per
subreddit, the hook video first, the link second, the honest "one person made
this, feedback welcome" third.
Day 3 — **Show HN**: "Show HN: SaucerJam – a browser arena shooter with no
download and no account." Post in the morning ET; answer every comment.
Day 4 — **TikTok / YouTube Shorts**: 3 clips cut from the hook. Vertical, first
3 seconds = a kill.
Day 5 — **Product Hunt**: full assets, first comment explains the build.
Weekend — **watch the loop**: respond to every Fider item (Hermes drafts, you
approve), merge any fix PRs the community surfaced.

## Post-launch (weeks 1–12)

- **Weekly**: read the funnel table, pick the single weak stage, and make one
  change against it. Log the change and expected effect before shipping it.
- **Cadence**: a small patch most weeks; a named release when a roadmap item
  lands. Never ship a red gate.
- **Community**: let the automation triage routine items; a human makes balance
  and roadmap calls. Reward the first few contributors publicly.
- **Content flywheel**: every merged community request becomes a 20-second clip.
  That is the sustainable top-of-funnel that doesn't require ad spend.

## Where to post (ranked by expected value for a browser game)

1. **Reddit** r/WebGames, r/browser_games, r/playmygame, r/gamedev (showcase).
2. **itch.io** — discovery + a stable link.
3. **Hacker News** Show HN — high variance, high ceiling for "no install" games.
4. **TikTok/Shorts** — cheapest reach if the hook is good.
5. **Discord** — indie-game and .io communities; disposable invites.
6. **Product Hunt** — one shot, needs polished assets.
7. **X/Bluesky** — build-in-public devlogs; low direct conversion, good for the
   "can I play it now?" click.

## What NOT to do

- No paid ads until the completed-round rate is healthy — buying traffic into a
  leaky funnel wastes money and hides the real problem.
- No "we're the next big esport" positioning; under-promise, over-deliver.
- No native app wrappers, no store, no battle pass at launch. The differentiator
  is instant play; protect it.

## Launch-day checklist

- [ ] `/metrics` scraping, dashboard green, alerts quiet with 0 players.
- [ ] Two-client public match verified from two networks.
- [ ] Fider webhook live and one test item triaged by Hermes.
- [ ] Hook video exported in 16:9 and 9:16.
- [ ] Rollback path known (previous tag + Coolify redeploy).
- [ ] Someone watching Telegram for alerts during the launch window.
