# Changelog

## 1.4.0 — unreleased

### Cross-device playability
- Off-screen **threat arrows** on every device, so touch players get the spatial awareness the desktop radar provided.
- **Keyboard-only play**: `I J K L` aim independently; `Tab` freed for focus and the scoreboard moved to `T`.
- **Hull + energy vitals** in the top bar; death panel shows the killer and weapon.
- **Screen-reader narration** of threats, low hull, death and round end; modal focus trap now reaches the report textarea and links.
- Independent **music mute** (`Music on/off`) alongside `Sound on/off`.
- **Menu scroll fix**: the Flight menu now scrolls on iPhone (and every phone/landscape), uses `dvh` so iOS toolbars cannot clip it, respects safe-area insets, and reads as scrollable.
- Touch **Comms moved out of the fire zone**; 44 px targets; safe-area top bar; linked PWA manifest.
- Practice spawns near a bot; `prefers-reduced-motion` honoured in the render loop; landing shows a live **population signal**.

### Operations (AI-operated)
- `GET /metrics` Prometheus exposition with rooms, players, joins/leaves by reason, rounds, events, HTTP/WS latency, memory, and a 7-day retention gauge.
- Grafana **SaucerJam** dashboard + Prometheus alert rules, wired to the Pi5 stack.
- **Community automation**: signed Fider webhook → AI triage queue → allow-listed actions; Hermes skill + SRE/community heartbeats. No auto-merge.
- **Behavioural insights** (`/api/insights`, `docs/SRE-INSIGHTS.md`) to detect player struggle before it is reported.
- Docs: `SRE.md`, `AUTOMATION.md`, `LOOP.md`, `LAUNCH.md`.

## 1.3.0 — 2026-09-12

- Added a Suno v6 original soundtrack.
- Replaced on-screen mobile controls: a floating arcade-style joystick for movement (appears wherever you first touch), and tap-to-fire -- touch the arena where you want to shoot instead of a dedicated Fire button, matching mouse aim-and-click on desktop.
- Fixed two real touch input bugs uncovered by the rewrite: lifting the movement thumb no longer stops fire from the other thumb, and touching a movement control no longer wiped independent mouse aim.
- Decluttered the HUD on every device: non-essential chrome (brand, connection status, round subtitle, the move/fire hint) now dims after a few idle seconds of flight and snaps back instantly on input or taking damage. Hull/Energy, weapon selection, the clock, and Menu always stay fully visible.
- Moved Arena/Scores/Sound off the touch play screen into the existing Flight menu; weapon selection is icon-first on touch.
- Fixed a hit-test bug where the joystick's drag zone silently swallowed taps meant for HUD buttons underneath it, and a landscape-viewport layout bug where the radar overlapped the vitals panel.
- Verified 85 unit tests and 13 browser tests, including real dual-touch input (simultaneous joystick drag + independent tap-to-fire) and both portrait and landscape mobile viewports.

## 1.2.0 — 2026-09-09

- Replaced public map selection and rotation with Confluence: one connected 120×120 world with industrial, forest, rail, and ice districts.
- Preserved tight core combat; connected districts have two border crossings for flanks.
- Server-authoritative territory unlocks at 3/5/7 humans after five seconds. Bots do not unlock territory; shrinking waits until safe round respawn.
- Practice exposes all four districts. District status appears in the HUD. Current movement, camera, and weapon economy are unchanged.
- Verified 80 tests, two native browser clients plus five sockets, synchronized expansion/reset, weapon energy, and mobile practice. Bespoke art and human population-balance tuning remain future work.

## 1.1.0 — 2026-09-09

- Added Junction, an optional close-quarters map using existing Foundry art: offset central cover, side fighting pockets, and clear flanking routes. Select it explicitly; existing default map rotation is unchanged.
- Added a usage-aware mini-release workflow and reproducible runtime packaging.
- Verified 75 tests, connected movement space and spawn exits, 2/4/8-bot comparisons, and independent native-browser two-client selection/replication.
- Critic approved an opt-in first iteration. Human balance, grenade escape playtesting, and low-end performance remain open; this is not the final art/WOW milestone.

## 1.0.0 — 2026-09-09

First playable release of the rebuilt SaucerJam.

- Four arenas, stable overhead camera, screen-relative movement and independent aiming.
- Authoritative multiplayer for up to eight players per room, private invites, bot fill, and reconnect recovery.
- Laser bursts cost 25 energy; long ricochet bolts cost 50; grenades cost 100, travel at most 20 meters, and allow one active grenade per pilot. Shared energy regenerates at 24/second.
- Grenade blast cover, stronger explosion flashes, overhead hull indicators, match recaps, and persistent pilot records.
- Single Node server and multi-architecture Dockerfile; configurable room/connection admission limits.

Known limits: room state is in memory, deployments interrupt matches, pilot identities are browser-local, and rankings require a persistent single-writer volume. Cosmetic overlap around cover remains under investigation. Portals, pickups, and larger arenas are planned for later releases.
