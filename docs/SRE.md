# SRE: metrics, alerts, and AI operations

SaucerJam is monitored by the self-hosted **Prometheus + Grafana** stack on the
Oracle free-tier host `free-arm-01` (Tailscale `100.72.3.78`), and alerts are
triaged by the **Hermes** agent. The Pi5 no longer runs monitoring; it is
reserved for Home Assistant. This document is the operational contract: what is
measured, what fires, what the AI may do on its own, and what always needs a
human.

## 1. What is measured

The game server exposes Prometheus text at **`GET /metrics`** (no auth; only
aggregate, non-PII counts). Implementation: `server/metrics.js`, wired in
`server/server.js`.

| Metric | Type | Meaning |
| --- | --- | --- |
| `saucerjam_rooms` | gauge | Active rooms |
| `saucerjam_players` | gauge | Connected human pilots |
| `saucerjam_bots` | gauge | Active bots |
| `saucerjam_capacity_ratio` | gauge | Pilot saturation across rooms |
| `saucerjam_joins_total{mode,map}` | counter | Successful joins |
| `saucerjam_join_failures_total{reason}` | counter | Rejections by reason (`rooms_full`, `room_full`, `room_not_found`, `rate_limited`, `debounced`, `bad_mode`, `invalid_request`) |
| `saucerjam_leaves_total{cause}` | counter | Departures (`client` vs `transport`) |
| `saucerjam_rounds_completed_total{map}` | counter | Finished rounds |
| `saucerjam_game_events_total{type}` | counter | Authoritative events (kill, hit, fire, portal*, mapChanged, roundEnd…) |
| `saucerjam_chat_messages_total` | counter | Accepted chat lines |
| `saucerjam_rate_limited_total{route}` | counter | Limiter rejections (`/api` for the shared bucket) |
| `saucerjam_http_requests_total{method,route,status}` | counter | HTTP requests. `route` is a matched route TEMPLATE (`/api/statistics` reports as `/api/statistics`); otherwise `/api` if the request reached the shared limiter but matched no route (an `/api` path that 404s); otherwise `unmatched`. Never the raw path, which would let an anonymous caller mint a series per invented URL. |
| `saucerjam_http_request_duration_seconds` | histogram | HTTP latency |
| `saucerjam_ws_round_trip_seconds` | histogram | Client ping (from `pingCheck`) |
| `saucerjam_ranking_save_errors_total` | counter | Round persistence failures |
| `saucerjam_community_ingest_total{kind,proposal}` | counter | Fider items accepted by the AI queue |
| `saucerjam_community_webhook_rejected_total{reason}` | counter | Rejected Fider webhooks |
| `saucerjam_community_actions_total{action}` | counter | AI actions recorded |
| `saucerjam_distinct_pilots_1d`, `_7d`, `_30d` | gauge | Distinct hashed pilot tokens in the trailing 24h / 7d / 30d (retention). These windows are **computed server-side**, so unlike the panel ranges they cannot follow the dashboard time picker. |
| `saucerjam_session_seconds` | histogram | Play-session length (websocket connect → disconnect). |
| `saucerjam_first_round_seconds` | histogram | Time from joining to finishing the first round (onboarding). |
| `insight_events_total{event,device,platform}` | counter | Allow-listed client UX events (starts, reports, friction, `landing_view`, …); capped series, no identifiers |
| `insight_sessions_total` | counter | Play sessions (one per websocket connection); the friction-ratio denominator |
| `insight_friction_ratio{signal}` | gauge | Per-session share of a friction signal (`stuck_no_input`, `died_without_kill`, …) |
| `saucerjam_process_uptime_seconds`, `_resident_memory_bytes`, `_heap_bytes`, `saucerjam_system_load1` | gauge | Process/runtime health |

`GET /health` remains the coarse liveness probe: `{status, rankings, rooms, players}`.

**Not from the app:** the **database** is measured by `postgres_exporter` (§2), and the **public path** by the blackbox probe. Nothing on the game is exposed for those.

## 2. Wiring (already applied)

The observability stack runs on the Oracle free-tier host `free-arm-01`
(Tailscale `100.72.3.78`) under `/opt/observability`; the Pi5 was retired from
monitoring on 2026-09-25 and now only runs Home Assistant. Six containers:

| Container | Role |
| --- | --- |
| `obs-prometheus` | scrape + rule evaluation (`127.0.0.1:9090`) |
| `obs-grafana` | dashboards and alerting UI (`:3001`) |
| `obs-blackbox` | outside-in HTTP probe of the public URL (internal `:9115`) |
| `obs-postgres` | Postgres metrics for the Supabase database (internal `:9187`) |
| `obs-node-exporter` | host CPU / memory / disk (`:9100`) |
| `obs-cadvisor` | per-container CPU/memory (the game and DB panels) |

Prometheus config `/opt/observability/prometheus/prometheus.yml` scrapes jobs
`saucerjam` (`https://saucerjam.com/metrics`, 15s), `blackbox-http`,
`postgres`, `oci-node`, `oci-cadvisor`, and the LAN hosts over Tailscale. It also
loads `/etc/prometheus/saucerjam.rules.yml` via `rule_files` (SLI recording
rules and alerts). Repo mirrors: `deploy/monitoring/scrape.yml`,
`deploy/monitoring/saucerjam.rules.yml`.

The **blackbox exporter** (`obs-blackbox`, config
`/opt/observability/blackbox/blackbox.yml`, repo mirror
`deploy/monitoring/blackbox/blackbox.yml`) probes
`https://saucerjam.com/health` from outside. Unlike a plain scrape, it
records *why* a request failed — `probe_http_status_code`, the per-phase
`probe_http_duration_seconds`, and TLS expiry — which is what makes an error
budget attributable. Its service block:

```yaml
# /opt/observability/docker-compose.yml
blackbox-exporter:
  image: prom/blackbox-exporter:latest
  container_name: obs-blackbox
  restart: unless-stopped
  command: ['--config.file=/etc/blackbox_exporter/blackbox.yml']
  volumes: ['./blackbox/blackbox.yml:/etc/blackbox_exporter/blackbox.yml:ro']
  expose: ['9115']
```

The **postgres exporter** (`obs-postgres`) is the database's own view —
`pg_up`, connections vs `max_connections`, size, cache hit ratio, transactions,
rollbacks and deadlocks — as opposed to the app's `saucerjam_rankings_*`. It
joins the Supabase Compose network to reach `supabase-db:5432` and connects as a
**read-only** role (`saucerjam_monitor`, `pg_monitor` + `CONNECT` only). Its DSN
lives in `/opt/observability/.env` (mode 600), never in the repo:

```yaml
# /opt/observability/docker-compose.yml
postgres-exporter:
  image: prometheuscommunity/postgres-exporter:latest
  container_name: obs-postgres
  restart: unless-stopped
  environment:
    DATA_SOURCE_NAME: ${PG_EXPORTER_DSN}
  networks: [default, supabase_db]
  expose: ['9187']
networks:
  supabase_db:
    external: true
    name: kh4i0pgyd5rmn72haex4mrh2   # the Supabase service network
```

To recreate the monitoring role (idempotent; run against the DB):

```sql
CREATE ROLE saucerjam_monitor LOGIN PASSWORD '<generated>' CONNECTION LIMIT 4;
GRANT pg_monitor TO saucerjam_monitor;
GRANT CONNECT ON DATABASE postgres TO saucerjam_monitor;
```


Grafana is **file-provisioned** from `/opt/observability/grafana/`, so the
running dashboards match this repo and survive a container rebuild:

| Path | Loads |
| --- | --- |
| `provisioning/datasources/prometheus.yaml` | Prometheus, UID pinned to `prom` |
| `provisioning/dashboards/provider.yaml` | every JSON in `dashboards/`, into the **SaucerJam** folder, UI edits disabled |
| `dashboards/saucerjam-{health,product,platform}.json` | the three official dashboards (§2.1) |

Repo mirrors: `deploy/monitoring/grafana-provisioning/` and
`deploy/monitoring/dashboards/`. The JSON is **generated, not hand-written** —
edit and re-run the generator (it takes the output directory as its argument):

```bash
python3 deploy/monitoring/dashboards/generate.py deploy/monitoring/dashboards
```

The Grafana service in `/opt/observability/docker-compose.yml` bind-mounts the
two directories read-only, so edits appear within 30s and UI edits are never
persisted:

```yaml
volumes:
  - grafana-data:/var/lib/grafana
  - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
  - ./grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro
  - ./grafana/provisioning/datasources:/etc/grafana/provisioning/datasources:ro
```

Verify:

```bash
# Run on free-arm-01 (admin user/password live in /opt/observability/.env)
curl -su admin "localhost:3001/api/dashboards/uid/saucerjam-health" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["meta"]["provisioned"], d["meta"]["folderTitle"])'
```

### 2.1 The official dashboards

Three dashboards, one story, one reader each. They are deliberately **separate**:
Google's guidance is to never page on product metrics, and a principal debugging
a limit is not the same person as a VP deciding what to build.

| Dashboard | UID / URL | Reader | Question |
| --- | --- | --- | --- |
| Product & growth | `/d/saucerjam-product` | VP / product | *Are people playing, staying, and is it growing?* |
| Platform & dependencies | `/d/saucerjam-platform` | Principal | *What is it built on, where are the limits, what breaks next?* |
| Service health (SLOs) | `/d/saucerjam-health` | On-call / SRE | *Is it OK now, and if not, what is spending the budget?* |

The arc descends from business → system → incident, so a reader can drill in:
product numbers are the "so what", platform explains the machinery, and service
health is the "right now". Each board links to the others in its header.

**Product & growth** is a funnel read top to bottom: is the data trustworthy
(pipeline heartbeat) → audience & retention (1d/7d/30d, DAU/MAU stickiness) →
funnel (landing → play → join → finish) → engagement depth (session length,
time-to-first-round) → experience quality (friction, by device) → the community
loop → **cost & efficiency** (all-free tier headroom).

**Platform & dependencies** is: dependency health (Cloudflare, app, Postgres,
Fider, TLS) → the **data plane** (self-hosted Supabase Postgres) → host and game
capacity/saturation → change & error correlation. Every panel answers "what
limit is this, and what happens at 100%?".

**Service health** keeps the SLO model: the four golden signals (SRE book ch. 6)
ordered symptoms-first, latency as **"X% of requests faster than Y"** (never an
average), **error-budget burn rate** over 1h/6h, a **blip-tolerant synthetic
probe SLI** for low traffic (a minute is up if any probe in it succeeded), and
an **attribution row** that separates raw probe failures from billed outages and
says whether a failure was HTTP, TLS, TCP or DNS. Request SLOs exclude `/health`
and `/metrics` (~99% of hits) so they can say something.

Every panel carries an **(i) description** (what, why, threshold, what to do) and
a **noValue** empty state, because at this traffic "empty" is the normal state
and must not read as broken.

**Time is dynamic, except where it is the definition.** Rate and total panels use
Grafana's `$__rate_interval` / `$__range`, so they follow the dashboard time
picker. The SLO panels use the **SLO window** variable (default `30d`), because
an objective over "whatever range you happened to pick" is not an SLO. The
burn-rate tiers stay pinned at 1h/6h on purpose — that pair is Google's
multiwindow design. The retention gauges (1d/7d/30d) are computed server-side
and are therefore fixed.

Sources: [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/),
[Implementing SLOs](https://sre.google/workbook/implementing-slos/),
[Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/),
[Google Cloud SRE blog](https://cloud.google.com/blog/products/devops-sre),
[SRE Weekly](https://sreweekly.com/).

## 3. Alerts

Rules live in `deploy/monitoring/saucerjam.rules.yml`. Each alert carries
`severity`, `service=saucerjam`, a `summary`/`description`, and a `runbook_url`
pointing at a section below.

| Alert | Severity | Fires when |
| --- | --- | --- |
| `SaucerJamDown` | critical | `up{job="saucerjam"} == 0` for 2m |
| `SaucerJamPublicProbeFailing` | critical | outside-in blackbox probe fails for 2m |
| `SaucerJamDatabaseDown` | critical | `pg_up == 0` for 2m (Supabase Postgres unreachable) |
| `SaucerJamTlsCertExpiring` | warning | public TLS cert expires within 14 days |
| `SaucerJamHealthDegraded` | warning | rankings persistence degraded for 5m |
| `SaucerJamDatabaseConnectionsHigh` | warning | backends > 85% of `max_connections` for 10m |
| `SaucerJamDiskFillingUp` | warning | free-tier root disk > 90% for 30m |
| `SaucerJamRoomsSaturated` | warning | `saucerjam_rooms >= 8` for 5m |
| `SaucerJamJoinFailureSpike` | warning | join failures > 0.5/s for 5m |
| `SaucerJamManyHumansPerRoom` | warning | pilots/room > 24 for 5m |
| `SaucerJamMemoryHigh` | warning | RSS > 384 MiB for 10m (container cap 512 MiB) |
| `SaucerJamRankingSaveErrors` | warning | any round save error in 15m |
| `SaucerJamRateLimitStorm` | warning | limiter rejections > 5/s for 5m |
| `SaucerJamPlayersStuck` | warning | `insight_friction_ratio{signal="stuck_no_input_per_session"} > 0.15` for 30m |
| `SaucerJamWebhookRejecting` | warning | Fider webhook deliveries rejected (`reason!~"degraded_parse\|disallowed_action"`) in 1h |

The file also holds the **SLI recording rules** (`saucerjam-sli` group):
`saucerjam:sli_availability:up1m` (1 if any blackbox probe in the last minute
succeeded) and `saucerjam:sli_availability:ratio_30d`. Prometheus evaluates all
**17 rules** (`promtool check rules` → SUCCESS: 17 rules found) and, since
2026-09-25, actually loads them via `rule_files` on Oracle.

**Alert path (live on Oracle, verified 2026-09-25).** Two delivery paths run in
parallel for SaucerJam alerts, so a page never depends on the agent being awake:

```
Prometheus ──▶ Alertmanager ──┬─▶ Telegram            (direct; the guaranteed page)
   (route: service="saucerjam")│
                              └─▶ relay :8787 ──HMAC──▶ Hermes webhook :8644
                                   (obs-hermes-relay)     (subscription `grafana-alerts`)
                                                             │
                                                             ▼
                                              triage → bounded heal / OpenCode fix
                                                             │
                                                             ▼
                                                          Telegram
```

- **Alertmanager** (`obs-alertmanager`) routes `service="saucerjam"` to the
  `saucerjam` receiver, which has both the Telegram config and a webhook to the
  relay. Everything else still goes to Telegram only.
- **Relay** `hermes-alert-relay.service` (host, `~/grafana-hermes-relay/`) holds
  a static bearer token for Alertmanager and HMAC-signs each body for Hermes
  (`X-Hub-Signature-256`). Alertmanager cannot do per-request HMAC, hence the
  relay. It reaches Hermes on loopback and Hermes reaches it via the
  observability gateway; the host firewall allows only `10.0.3.0/24 → tcp/8787`
  (added to `netfilter-persistent`).
- **Hermes** webhook platform on `:8644`, subscription `grafana-alerts`, events
  `grafana-alert`, skill `opencode`, delivered to the Telegram chat. Its prompt
  carries the guardrails below and works from the `~/saucerjam` checkout.

**Guardrails in the subscription prompt** (enforced by instruction, matching §4):
never deploy, never `POST /api/v1/deploy`, never `docker rm -f`, never touch
DNS/TLS/env/secrets, never merge to `main`, never force-push; **one** autonomous
attempt, then escalate.
The Oracle host is authenticated to GitHub (`gh`, config at
`~/.config/gh/hosts.yml`, git wired via `gh auth setup-git`). The credential
spans the repositories the agent manages — it handles more than one — so
`Contents`/`Pull requests` write across them is intentional. The hard backstop is
branch protection on `main` (PR + review): the agent can open a PR but **cannot
push to `main`**. Note the credential also carries the `workflow` scope, so an
agent turn can edit GitHub Actions files; that is a deliberate trade-off — use a
token without `workflow` if CI edits should never be automatic.

Test the whole chain:

```bash
curl -s -X POST localhost:9093/api/v2/alerts -H 'Content-Type: application/json' \
  -d '[{"labels":{"alertname":"SaucerJamE2ETest","service":"saucerjam","severity":"warning"},
       "annotations":{"summary":"synthetic test"}}]'
# expect: Alertmanager "Notify success" (telegram) + relay "POST / 200" +
#         a Hermes agent run in ~/.hermes/logs/agent.log + a Telegram message
```

Also relevant: the older Grafana contact-point files
(`provisioning/alerting/contact-points.yaml`) are kept for reference but are **not
the live path** on Oracle.


## 4. AI authority (self-heal vs escalate)

**Hermes may do automatically, with no human approval:**

- Restart the SaucerJam container via Coolify's application restart endpoint
  (`POST /api/v1/applications/<uuid>/restart`) — a bounded restart, **never a
  deploy** — and restart `coolify-proxy` on Pi5 if ingress is down. Never
  `POST /api/v1/deploy`, never `docker rm -f`, never delete volumes, never edit
  DNS/TLS.
- Re-run the bounded smoke check (`node scripts/verification/live.cjs <url> 2`).
- Open a **fix PR** or a **prototype branch + PR preview** in response to a
  community report (see §6).
- Post a status message to Telegram and a comment on the Fider post.

**Hermes must escalate to a human (no action) when:**

- The fix would change game balance, monetization, or the public roadmap.
- The change touches secrets, Supabase auth config, billing, or DNS.
- Two automatic restart attempts fail, or the error is not reproducible.
- A community proposal fails the gates in §6.

**Hard invariants:** no automatic merge to `main`; **no automatic deploy** (the
loop only ever issues a bounded restart); no `git push --force`; no editing
production env vars; production deploys end active matches and are always a
human action (see `docs/COMMUNITY-LOOP-CONTRACT.md` §6).

## 5. Runbooks

### Runbook: SaucerJamDown
1. `curl -fsS https://saucerjam.com/health` — confirm from off-host.
2. Check the Coolify app status (`GET /api/v1/applications/<uuid>`) and container.
3. Check RSS before restart — if it was OOM, capture the value for the incident.
4. Restart via Coolify; re-run `live.cjs`. If it stays down, escalate.

### Runbook: DatabaseDown
1. `pg_up` on **Platform & dependencies**; `docker ps | grep supabase-db` on free-arm-01.
2. `saucerjam_rankings_status{status="degraded"} == 1` and a rising
   `saucerjam_ranking_save_errors_total` confirm the app sees it too.
3. Check the exporter's own view: `docker logs obs-postgres` (connection refused
   vs auth failure).
4. Do **not** restart `supabase-db` blindly — check free-tier **disk** and
   **memory** first; a crash loop is usually one of those.

### Runbook: RankingsDegraded
1. `saucerjam_ranking_save_errors_total` / `saucerjam_rankings_status{status="degraded"}`.
2. Confirm the database: `pg_up` and the **Data plane** row on Platform & dependencies.
3. Rankings persist to **Supabase (PostgREST)**, not a local file; a
   `rankings.json` import happens once on boot only. Never delete DB rows; back
   up before any manual edit.

### Runbook: RoomsSaturated
1. `saucerjam_rooms` at `MAX_ROOMS` — verify the value in Coolify env.
2. Raise `MAX_ROOMS` only with headroom evidence (see `docs/HOSTING.md`); never
   raise blindly. Escalate the decision if memory/CPU is near the cap.

### Runbook: JoinFailures
1. Break down `saucerjam_join_failures_total` by `reason`.
2. `rooms_full`/`room_full` → capacity; `rate_limited` → possible abuse;
   `room_not_found` → stale invite links; `bad_mode` → client bug.

### Runbook: Capacity
1. `saucerjam_players / saucerjam_rooms` above 24 — check host headroom.
2. Lower `MAX_ROOM_PLAYERS` if the host is strained; observe `ws_round_trip`.

### Runbook: Memory
1. Compare RSS trend to `saucerjam_rooms`; leaks usually track room churn.
2. Capture heap before restart. Escalate if it recurs after a restart.

### Runbook: RateLimit
1. Inspect the `route` label; `/api` is the shared bucket and `chat` is the usual
   suspect. A `429` on `/api` is labelled `/api` (not `unmatched`) precisely so
   this step keeps working. The Fider webhook is never rate limited with a 429 —
   an over-limit delivery returns `202`, so a `saucerjam_community_webhook_rejected_total{reason="rate_limited"}`
   increase is the signal there, not this counter.
2. Distinguish abuse (single IP) from a stuck client; only the latter is a bug.

## 6. Community → AI pipeline

See `docs/AUTOMATION.md` for the full design. Summary: Fider webhook →
credentialed `POST /api/community/webhook` (bearer token or HMAC) → deterministic proposal → Hermes reads
`GET /api/community/queue` with `x-community-token` → acts via
`POST /api/community/action` (allow-list only) → maintainer/community gate.

## 7. Environment variables (server)

| Variable | Purpose |
| --- | --- |
| `FIDER_WEBHOOK_TOKEN` | Shared bearer token for inbound Fider webhooks; the route Fider actually uses (it cannot HMAC-sign). Sent as `Authorization: Bearer <token>` or `x-fider-token` |
| `FIDER_WEBHOOK_SECRET` | HMAC secret for senders that can sign the raw body; kept for signers that can produce `sha256` |
| `COMMUNITY_ACTION_TOKEN` | Shared secret for the AI queue/action endpoints |
| `FIDER_BASE_URL`, `FIDER_API_KEY` | Existing outbound report bridge (Coolify env) |
| `MAX_ROOMS`, `MAX_ROOM_PLAYERS`, `MAX_CONNECTIONS` | Admission limits (unchanged) |

Never commit real values; set them in Coolify.
