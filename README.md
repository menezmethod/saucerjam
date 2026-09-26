# SaucerJam

Neon arena combat in the browser. Drift movement with independent mouse aim, server-authoritative
multiplayer, one connected world that expands as more pilots join, and no download.

- **Play:** <https://saucerjam.com>
- **Development build:** <https://dev.saucerjam.com>
- **Community portal, roadmap votes:** <https://community.saucerjam.com>
- **Status:** v1.4.0 — MIT licensed, deployed and healthy

No install, no account, no plugin. Open the page, pick a callsign, fly.

## Contents

- [Play](#play) · [Controls](#controls) · [Combat](#combat) · [The Confluence world](#the-confluence-world)
- [Pilot records](#pilot-records) · [Optional accounts](#optional-accounts)
- [Run it locally](#run-it-locally) · [Development](#development) · [Tests](#tests) · [Verification scripts](#verification-scripts)
- [Deployment](#deployment) · [Configuration](#configuration) · [Architecture](#architecture)
- [Operations](#operations) · [Documentation](#documentation) · [Licensing](#licensing)
- [Contributing](#contributing) · [Known limits](#known-limits)

## Play

| Mode | What it does |
| --- | --- |
| **Practice with bots** | Starts immediately and runs entirely in your browser. Works offline once loaded. The menu pauses it. |
| **Play online** | Joins the one shared public arena. Bots fill vacant seats up to four pilots and leave as humans arrive. |
| **Create room** | A private room with a shareable code. Turn bot fill off for human-only matches. |
| **Copy invite** | A link friends can open; they enter a callsign and press Join. |

Rounds end at **20 eliminations or 5 minutes**, whichever comes first, and the next round
starts 10 seconds later. Rooms hold up to 32 pilots by default (`MAX_ROOM_PLAYERS`).

On another machine on your LAN, use the **LAN play** address the server prints (for example
`http://192.168.0.9:8080`) and create the invite from that address — `localhost` in a link
means the recipient's own machine. For friends beyond your LAN, host it somewhere reachable
and serve it over HTTPS; clipboard support and some auth flows need a secure origin.

Room state lives in memory. If everyone disconnects and the last human leaves intentionally,
the room closes; a transport loss keeps it paused for 30 seconds so a reconnect can recover
it. Rejoining an active round under the same browser pilot identity restores combat resources,
death timers and performance counters. Completed online rounds persist to
`server/data/rankings.json` (override with `RANKINGS_FILE`).

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D`, arrows | Move (screen-relative) |
| `Q` / `E` | Alternative left / right |
| Mouse | Aim independently of movement |
| `I` `J` `K` `L` | Aim without a mouse (fully keyboard-playable) |
| Hold left click or `Space` | Fire the selected weapon |
| `1` `2` `3` | Laser / Grenade / Ricochet |
| `X` | Cycle weapon |
| `V` | Toggle Arena / full-map view |
| `M` | Toggle radar |
| `T` | Toggle scoreboard |
| `C` | Controls and weapon guide |
| `Escape` | Flight menu (pauses practice) · closes the chat prompt |
| `Enter` | Open chat in flight · join from the lobby |

`Tab` is deliberately left to the browser so every lobby control stays keyboard-reachable.

**Touch:** two floating sticks. The **left thumb** anywhere on the left half claims the
movement stick; the **right thumb** pushes a relative aim stick that steers and fires without
reaching across the screen to the target. Lifting a thumb does not stop the other one. A
one-time guide explains the scheme on first play. Keyboard and mouse remain the most precise.

**One-hand mode** (Flight menu) lets a single thumb anywhere on the screen claim the movement
stick and drops the left-half rule. **Auto-target** picks the nearest living, unprotected
enemy within 22 m that you actually have line of sight to — cover is respected, so a target
behind a wall is never selected — and holds a sticky lock instead of flicking between two
similarly distant enemies.

**Comms:** arena chat, room-scoped and rate-limited, with `Enter` on desktop or the chat icon
on touch. Lines sit over the arena and fade on their own; the input only appears while you are
composing a message.

**Camera:** Arena is the default — a fixed overhead angle and distance that tracks your ship
without rotating, panning or zooming. `V` toggles Arena and the full map. Chase, isometric and
zoom remain under **Camera view** in the Flight menu, alongside **One-hand mode**, and portrait
framing preserves a useful lateral view. Overhead segments show real hull; `PROTECTED` means
spawn protection, not energy.

## Combat

| Weapon | Damage | Cost | Cooldown | Notes |
| --- | --- | --- | --- | --- |
| **Laser** (`1`) | 24 | 25 energy | 0.25 s | On-screen label; the canonical name in code is *Plasma Beam*. Fast, precise bursts. Stopped by cover. |
| **Grenade** (`2`) | 80 max | 100 energy | 1 s | Canonical name *Nova Charge*. Arcs to your cursor, 20 m range, 0.85 s fuse, 5 m blast with distance falloff. One live grenade per pilot. Cover blocks the blast. Self-damage halved. |
| **Ricochet** (`3`) | 34 | 50 energy | 0.5 s | Canonical name *Ricochet Disc*. Reflects off cover and arena edges up to three times, expires after 3 s. |

A full capacitor supports four beam shots (five while recharging continuously), two discs, or
one charge. Energy is a shared capacitor at **24/second** (about 4.2 s empty → full). Hull
repairs at **4/second** after five seconds without taking damage.

Destruction respawns you after **3 seconds** in a clear position away from other ships.
Spawn protection lasts **1.5 seconds** and ends the moment you fire. Energy is a weapon
capacitor, not armour: it never mitigates hull damage.

## The Confluence world

Confluence is one **120×120** world made of four 60×60 districts. Territory opens with the
number of connected humans, five seconds after the threshold is crossed:

| District | Label | Opens at | Character |
| --- | --- | --- | --- |
| Industrial core | FORGE | 1 human (always open) | Tight industrial combat |
| Forest biodome | GARDEN | 3 humans | Planter and growth-vat cover |
| Orbital rail yard | DOCK | 5 humans | Rail platforms, long sightlines |
| Frozen relay | RELAY | 7 humans | Ice baffles, relay pylons |

Bots never unlock territory. Two crossings on each district border provide flanking routes,
and **paired portals** teleport across the map — they preserve your aim, refuse an occupied
exit, and emit a local cue so a jump is never silent. When territory shrinks it waits for the
next round so everyone respawns safely inside the new boundary. Practice opens the whole world
immediately.

**Reactor blooms** sit in each district and restore **35 hull and 50 energy**, then go dark for
**18 seconds**. Pickups follow the open-territory rule, so a district's blooms appear when the
district does.

Staged diagnostics can show synthetic states behind `?showcase`; their counters never become
online records.

## Pilot records

Records include lifetime and per-map score, wins, kills/deaths, damage, accuracy, XP and level.

- **Score:** 100 per kill, 1 per 5 damage, −25 per death, +250 for the round winner (floor 0).
- **XP:** 25 participation, 40 per kill, 1 per 10 damage, 150 for a win.
- **Level:** `1 + floor(sqrt(totalXP / 250))`.
- Match recaps separate practice results from saved online rounds. **Bots never enter
  persistent leaderboards.**

Guests get a random browser token; signed-in pilots use their verified Supabase user ID, so
records follow them across devices.

## Optional accounts

Accounts are optional — guests can play everything. To enable them, set `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` (or the legacy `SUPABASE_ANON_KEY`) on the server. The publishable
key is safe in the browser; **never** expose a `service_role`/`secret` key. Enable Email,
Google and Apple in Supabase Authentication and add the local and production game URLs to the
provider redirect allowlist. See [`server/env.example`](server/env.example).

## Run it locally

Requires **Node.js 22** (20 is the declared minimum; CI, the Dockerfile and this box run 22+).

```sh
npm ci
npm start          # builds the client, then serves game + multiplayer on :8080
```

Open <http://localhost:8080>. One process serves everything; no second server.

## Development

```sh
npm run dev          # client rebuilds on :8080, server on :3000 through a proxy
npm run build        # production client into dist/
npm run serve        # serve an existing build on :8080
npm test             # builds, then runs the unit/integration suite
npm run test:browser # end-to-end browser suite; run a build first
```

Production container:

```sh
docker compose up --build -d
```

The container serves on port 8080 and keeps completed results in the named `rankings` volume.
Override `PORT` for a direct Node deployment. If you deliberately host the frontend on a
different origin, set `CLIENT_URL` to the allowed comma-separated origins and proxy
`/socket.io/` to this server; the default same-origin setup needs no CORS configuration.

## Tests

**Current state: `228/228` passing, 0 failing** (33 test files, `node --test`), plus the separate
browser suite. Re-run before every release; do not quote these numbers as permanent.

The suite covers the authoritative simulation, weapon economy and hit resolution, grenade
falloff and cover, spawn protection, respawn, movement normalization, reconnect recovery,
replication privacy, room and public-arena rules, single-public-room enforcement, rankings
persistence, metrics, progression, community automation, security guardrails, chat scoping,
auto-target selection and aim stick behaviour, territory expansion, and 8/32/64/128-pilot
simulation cost.

The browser suite (`npm run test:browser`) drives real clients and needs Chromium: it uses an
installed Google Chrome, `CHROME_PATH` if set, or Playwright's Chromium
(`npx playwright install chromium`). It covers independent clients, room invites, replicated
controls, all three weapons, portal traversal, death/respawn, all four cameras, radar, network
loss and reconnect, practice, dual-stick touch input (including grenade aim snapping and drag
throw distance), landscape HUD overlap, mobile layout, and asset-independent procedural ships.
It also asserts that no browser exception or broken application request occurred. Screenshots
land in `test-results/`. `CHROME_BACKEND=native` drops the SwiftShader flags for real-GPU
rendering.

On a small host (2 vCPU), the suite's default 30-second page-boot budget is tight — several
software-WebGL Chromium instances boot slowly and it can fail as a bare timeout. Raise the
wait budget rather than assuming a regression, and check that the client actually boots first
(`window.__qd` becomes true).

`npm test` also launches Chromium (the interface tests), so install the browser before running
it on a fresh machine.

## Verification scripts

Beyond the suites:

```sh
node scripts/verification/confluence.cjs                    # two browsers, seven pilots, map expansion/reset
node scripts/verification/live.cjs https://saucerjam.com 2  # bounded remote smoke check
npm run capture -- --map foundry --camera tactical --time dusk --state combat --out test-results/capture
npm run ops:selftest && npm run ops:smoke                   # operations self-test and smoke
```

Also available: `camera`, `junction`, `landing`, `matrix`, `movement`, `playability`,
`scale` and `scale-server` verification scripts under `scripts/verification/`. Headless
SwiftShader FPS is a regression measure, not a native GPU benchmark.

## Deployment

Production runs on **Coolify** as a Dockerfile application, on two branches with two
environments:

| Branch | Environment | Auto-deploys to | Role |
| --- | --- | --- | --- |
| `develop` | SaucerJam (dev) | <https://dev.saucerjam.com> | Integration — land work here first |
| `main` | SaucerJam | <https://saucerjam.com>, `www` | Release — only merge what has passed on dev |

Both deploy automatically on push (Coolify GitHub App webhook). A git tag does not deploy on
its own; the branch has to advance.

Before sharing a public link: check TLS, static assets, `/health` reporting `rankings: ok`, a
real WebSocket upgrade, two clients on separate networks sharing a room, and a saved round
surviving a restart. Deployments end active matches — schedule them between play sessions.
Roll back to the preceding tested commit in Coolify and keep the rankings volume.
`docs/HOSTING.md` has the full procedure, capacity roadmap and rollback path.

Downloadable releases are built with `npm run release:pack`: a prebuilt client, the Node
server, **the corresponding source**, the licence files, and a `SHA256SUMS` file with the
commit hash.

## Configuration

All optional. Full annotated list in [`server/env.example`](server/env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP + WebSocket port |
| `MAX_ROOMS` | `8` | Admission limit, not a capacity guarantee |
| `MAX_ROOM_PLAYERS` | `32` | Per-room pilot cap (hard ceiling 128) |
| `MAX_CONNECTIONS` | `96` | Total connected sockets |
| `MAX_CONNECTIONS_PER_IP` | `MAX_CONNECTIONS` | Per-network socket guard |
| `JOIN_ATTEMPTS_PER_IP` | `120` | Per-network join rate limit |
| `TRUST_PROXY` | unset | Set **only** behind a trusted reverse proxy |
| `RANKINGS_FILE` | `server/data/rankings.json` | Persistent ledger path |
| `CLIENT_URL` | same origin | Allowed frontend origins, comma-separated |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | unset | Optional accounts |
| `SUPABASE_SECRET_KEY` | unset | Server-only, enables the Supabase rankings ledger |
| `FIDER_BASE_URL` / `FIDER_API_KEY` | unset | Server-only community bridge |
| `FIDER_WEBHOOK_TOKEN` / `FIDER_WEBHOOK_SECRET` | unset | Inbound community webhook auth |
| `COMMUNITY_ACTION_TOKEN` | unset | Agent access to the community queue |
| `APP_VERSION` | `web` | Reported as the build in logs |

Admission limits are protective defaults, not measured guarantees. Raise `MAX_ROOMS` and
`MAX_CONNECTIONS` only after load-testing your host.

## Architecture

One fixed-step 60 Hz simulation, shared byte-for-byte between the server and offline practice.

| Path | Responsibility |
| --- | --- |
| `shared/simulation.js` | The whole simulation: movement, map collision, swept projectile hits, grenade blast falloff, energy, bots, safe spawns, rounds, scoring |
| `shared/maps/world.js` | Confluence: four districts, territory staging, obstacles, portals, reactor blooms |
| `shared/maps/classic.js`, `junction.js` | Internal regression fixtures (not in public rotation) |
| `server/server.js` | Rooms, input validation and rate limits, server stepping, 20 Hz snapshots, HTTP API, security headers |
| `server/metrics.js`, `insights.js`, `community.js` | Prometheus exposition, behavioural insights, Fider bridge |
| `server/rankings/` | Persistent ledger (file or Supabase) |
| `src/index.js` | Controls, lobby/HUD, predicted movement with acknowledged-input replay, remote interpolation, audio, reconnect, landing |
| `src/core/ArenaRenderer.js` | Three.js rendering, procedural ships, targeting, bounded effects |
| `src/view/` | Camera rig, ship indicators, threat arrows |
| `src/input/`, `src/interface/`, `src/world/`, `src/audio/` | Touch stick, UI, client world view, music bus |

Clients send **inputs only**. Health, damage, projectile speed and positions are never accepted
from a client. Multiplayer is designed for a single server process; horizontal scaling,
cross-region matchmaking and per-room distribution are not implemented.

## Operations

The server exposes `/health`, `/metrics` (Prometheus, aggregate and non-PII), `/api/statistics`,
`/api/leaderboard`, `/api/profile`, `/api/insights`, `/api/config`, and the token-guarded
`/api/community/queue` and `/api/community/action`.

A Prometheus/Grafana stack scrapes the deployment with dashboards and alert rules, and an
operator loop (SRE heartbeat, community heartbeat, release gate) runs on a schedule. The loop's
invariant is that **the agent may observe, diagnose and propose, never deploy to production
without a human**: every automated change lands on a branch or PR, never directly on `main`.
See [`docs/LOOP.md`](docs/LOOP.md), [`docs/SRE.md`](docs/SRE.md) and
[`docs/AUTOMATION.md`](docs/AUTOMATION.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [`docs/HOSTING.md`](docs/HOSTING.md) | Deployment, Coolify, rollback, capacity roadmap |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Direction, gameplay order, scale progression |
| [`docs/RELEASE-LOOP.md`](docs/RELEASE-LOOP.md) | Incremental delivery workflow |
| [`docs/CHANGELOG`](CHANGELOG.md) | Release notes |
| [`docs/AUDIO.md`](docs/AUDIO.md) | Every cue: prompts, clip IDs, chop points, wiring |
| [`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md) | Approved asset sources, contributor checklist |
| [`docs/LOOP.md`](docs/LOOP.md) · [`docs/SRE.md`](docs/SRE.md) · [`docs/AUTOMATION.md`](docs/AUTOMATION.md) | Operator loop, runbooks, community automation |
| [`docs/SRE-INSIGHTS.md`](docs/SRE-INSIGHTS.md) | Behavioural insights for detecting player struggle |
| [`docs/PUBLIC-LAUNCH-FOUNDATION.md`](docs/PUBLIC-LAUNCH-FOUNDATION.md) | Product identity, IP rules, licence strategy |
| [`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md) | IP and licensing review of this repository |
| [`docs/MARKETPLACE-TERMS.md`](docs/MARKETPLACE-TERMS.md) | Creator terms for the deferred marketplace |
| [`docs/community-portal/README.md`](docs/community-portal/README.md) | Where feedback belongs |
| [`docs/ux-audit/REPORT.md`](docs/ux-audit/REPORT.md) · [`docs/gauntlet/`](docs/gauntlet/) | UX findings and adversarial review evidence |
| [`docs/concepts/confluence-v2/README.md`](docs/concepts/confluence-v2/README.md) | Art production plan (design handoff, not shipped) |

## Licensing

**The code is MIT** ([`LICENSE`](LICENSE)) — use it, modify it, ship it, sell it. The **brand,
art, models and audio are licensed separately** and are not part of that grant:

- [`LICENSING.md`](LICENSING.md) — the complete map: what is licensed how, the MIT version
  boundary, dependency licences, and the staged (not adopted) move of future releases to
  AGPL-3.0, plus the dual-licensing path.
- [`TRADEMARK.md`](TRADEMARK.md) — the SaucerJam name, wordmark, logo and official services.
  Forking is welcome; rename your build, never imply it is official.
- [`ASSET-LICENSES.md`](ASSET-LICENSES.md) — music, SFX, models and art. You may play and
  redistribute them inside an unmodified build; you may not lift them into your own project.
- [`CLA.md`](CLA.md) — the contributor licence agreement. You keep ownership of your work.
- [`NOTICE`](NOTICE) — the same mapping in short form, at the root.

Already-published releases stay MIT. Nothing here is retroactive, and a future AGPL release
would be named explicitly in [`CHANGELOG.md`](CHANGELOG.md). Current status and open items:
[`docs/LEGAL-REVIEW.md`](docs/LEGAL-REVIEW.md).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it has the branch model (`develop` → `main`),
the evidence a pull request needs, and the asset and AI-disclosure rules. Every contribution
requires CLA acceptance ([`CLA.md`](CLA.md)) and a disclosure of any AI tooling used.

- Bugs and engineering issues: GitHub issue forms.
- Ideas, balance, ships, art, lore: <https://community.saucerjam.com> or Discussions.
- Security: private advisory, per [`SECURITY.md`](SECURITY.md).
- Conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

Assets follow one rule: **no provenance = no canonical release**
([`docs/ASSET-PROVENANCE.md`](docs/ASSET-PROVENANCE.md)).

## Credits

Built on [three.js](https://threejs.org), [Express](https://expressjs.com),
[Socket.IO](https://socket.io), [webpack](https://webpack.js.org),
[Supabase](https://supabase.com) and [Playwright](https://playwright.dev) — all MIT or
Apache-2.0. Soundtrack and SFX generated with Suno v6; original ship models modelled in Blender.
Full dependency licences: [`LICENSING.md`](LICENSING.md) §5.

## Known limits

- Room state is in memory; a deployment interrupts active matches.
- Single server process only — no horizontal scaling, no cross-region matchmaking.
- 128-pilot simulation cost is tested; 128 real players in one battle is not a production claim.
  Capacity targets progress `8 → 32 → 64 → 128`, measured before each step.
- Leaderboard and ranking identity depend on the browser token unless a pilot signs in.
- Rankings need a persistent single-writer volume.
- Cosmetic overlap around cover is still under investigation.
- The marketplace is deferred scope and not active
  ([`docs/MARKETPLACE-TERMS.md`](docs/MARKETPLACE-TERMS.md)).
