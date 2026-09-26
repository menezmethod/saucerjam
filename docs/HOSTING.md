# Hosting SaucerJam

## Environments

| Branch | Coolify application | URL | Role |
| --- | --- | --- | --- |
| `develop` | SaucerJam (dev) — uuid `tspec81varp8ghb8vx33nkgd` | https://dev.saucerjam.com | Integration; land work here first |
| `main` | SaucerJam — uuid `aoeefnsohotlncnvmpgwmaao` | https://saucerjam.com, https://www.saucerjam.com | Release |

## Initial deployment
One Coolify Dockerfile application per environment serves the client and Socket.IO on container port 8080. The intended public ingress is saucerjam.com; verify that it resolves to this application before publishing a play link. No separate game server domain is required. Start with one CPU and 512 MiB RAM, MAX_ROOMS=8, MAX_ROOM_PLAYERS=32, and MAX_CONNECTIONS=96. These are admission limits, not validated capacity claims; set MAX_ROOM_PLAYERS to the measured safe value for the first playtest.

Coolify app UUID: `aoeefnsohotlncnvmpgwmaao`. logisticsPc was changed from build-only to deployment-capable with owner approval. Remote-build assignments for other projects should be reviewed separately.

Persist /app/server/data in a dedicated volume or bind directory owned by container UID 1000. Back it up daily; do not share a rankings file between processes. /health reports rooms, human players, and ranking availability. Preserve WebSocket upgrades and disable caching for /socket.io/* and /api/*. The server rejects cross-site Socket.IO origins by default, caps per-network sockets and join attempts, rate-limits API/health requests, and emits baseline security headers. If a trusted reverse proxy is in front, set `TRUST_PROXY=true` so abuse limits use the real client address; never enable it when clients can reach Node directly.

## Releases and rollback
Run `npm test`, `npm run build`, and `CHROME_BACKEND=native npm run test:browser` before release. Coolify auto-deploys pushes to `main` and `develop` on `menezmethod/saucerjam` (GitHub App webhook; no separate deploy-on-tag setting), so `develop` and `main` are separate applications and neither needs a manual deploy step. A GitHub release tag alone does not deploy unless the branch advances. Before the public link, check TLS, static assets, `/health` with `rankings: ok`, a real WebSocket upgrade, two clients on separate networks sharing a room, and a saved round surviving a restart. `node scripts/verification/live.cjs https://saucerjam.com 2` supplies a bounded remote smoke check; it does not replace the two-client and persistence checks. Roll back to the preceding tested commit through Coolify; keep the rankings volume. Deployments end active matches; schedule updates between play sessions. GitHub release downloads include a prebuilt browser client and the Node server, plus checksums.

## Capacity roadmap
1. Measure actual-host event-loop delay, process CPU/RSS, network egress, disconnect rate and round-trip latency at 8, 16, 32, then 64 active pilots. Stop before affecting colocated workloads. Target p95 simulation scheduling delay below one 16.7ms step and stable latency relative to idle baseline. Repeat under realistic movement/fire and a complete round; record host/build and results.
2. Optimize snapshot size and bot cost based on profiles, then raise admission limits with headroom. Saturated rooms must reject joins politely.
3. Scale by assigning whole rooms to independent server processes. Add a room directory, explicit routing/stickiness, and a durable shared results database before multiple replicas. A Socket.IO adapter alone does not distribute simulation ownership.
4. Add authentication, abuse controls, backups with restore drills, dashboards, and match draining as public traffic warrants. Keep infrastructure portable; GCP is optional.

No claim of unlimited players or proven Raspberry Pi capacity is made.
