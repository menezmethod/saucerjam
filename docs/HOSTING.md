# Hosting SaucerJam

## Initial deployment
One Coolify Dockerfile application on logisticsPc serves the client and Socket.IO on container port 8080. The intended public ingress is qd.menezmethod.com; verify that it resolves to this application before publishing a play link. No separate game server domain is required. Start with one CPU and 512 MiB RAM, MAX_ROOMS=8, MAX_ROOM_PLAYERS=32, and MAX_CONNECTIONS=96. These are admission limits, not validated capacity claims; set MAX_ROOM_PLAYERS to the measured safe value for the first playtest.

Coolify app UUID: `aoeefnsohotlncnvmpgwmaao`. logisticsPc was changed from build-only to deployment-capable with owner approval. Remote-build assignments for other projects should be reviewed separately.

Persist /app/server/data in a dedicated volume or bind directory owned by container UID 1000. Back it up daily; do not share a rankings file between processes. /health reports rooms, human players, and ranking availability. Preserve WebSocket upgrades and disable caching for /socket.io/* and /api/*. The server rejects cross-site Socket.IO origins by default, caps per-network sockets and join attempts, rate-limits API/health requests, and emits baseline security headers. If a trusted reverse proxy is in front, set `TRUST_PROXY=true` so abuse limits use the real client address; never enable it when clients can reach Node directly.

## Previews

Preview deployments are enabled on the SaucerJam Coolify app. Opening, reopening,
or synchronizing a pull request builds a preview at `qd{pr}.menezmethod.com`
(for example PR 14 → `https://qd14.menezmethod.com`). Coolify does not deploy a
pull request that was already open when previews were enabled; close and reopen
it to create the preview.

The preview container is built from the same Dockerfile as production by
`docker build -f Dockerfile` and run with the preview's own domain and
environment. Wildcard DNS for `*.menezmethod.com` is proxied through Cloudflare,
so no DNS change is needed per preview.

Preview debugging order:

1. `PATCH /api/v1/applications/{uuid}/previews/{pr}` returns validation errors
   rather than 404 once the preview row exists.
2. On the deployment server, `docker ps` and `docker logs <uuid>-pr-<pr>` show
   the real state. A crash-looping container still answers `/health` with a
   Traefik `404 page not found`, so check the container before DNS or TLS.
3. `GET /api/v1/deployments/applications/{uuid}` lists deployments with a
   `pull_request_id`; a finished entry with the right PR id means the build ran.

Preview environment variables are separate from production. Do not put
production credentials in a preview.

## Releases and rollback
Run `npm test`, `npm run build`, and `CHROME_BACKEND=native npm run test:browser` before release. Coolify auto-deploys pushes to `master` on `menezmethod/saucerjam` (GitHub App webhook; no separate deploy-on-tag setting). A GitHub release tag alone does not deploy unless `master` advances. Before sharing a public link, check TLS, static assets, `/health` with `rankings: ok`, a real WebSocket upgrade, two clients on separate networks sharing a room, and a saved round surviving a restart. `node scripts/verification/live.cjs https://qd.menezmethod.com 2` supplies a bounded remote smoke check; it does not replace the two-client and persistence checks. Roll back to the preceding tested commit through Coolify; keep the rankings volume. Deployments end active matches; schedule updates between play sessions. GitHub release downloads include a prebuilt browser client and the Node server, plus checksums.

## Capacity roadmap
1. Measure actual-host event-loop delay, process CPU/RSS, network egress, disconnect rate and round-trip latency at 8, 16, 32, then 64 active pilots. Stop before affecting colocated workloads. Target p95 simulation scheduling delay below one 16.7ms step and stable latency relative to idle baseline. Repeat under realistic movement/fire and a complete round; record host/build and results.
2. Optimize snapshot size and bot cost based on profiles, then raise admission limits with headroom. Saturated rooms must reject joins politely.
3. Scale by assigning whole rooms to independent server processes. Add a room directory, explicit routing/stickiness, and a durable shared results database before multiple replicas. A Socket.IO adapter alone does not distribute simulation ownership.
4. Add authentication, abuse controls, backups with restore drills, dashboards, and match draining as public traffic warrants. Keep infrastructure portable; GCP is optional.

No claim of unlimited players or proven Raspberry Pi capacity is made.
