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
| `saucerjam_distinct_pilots_7d` | gauge | Distinct hashed pilot tokens, trailing 7 days (retention) |
| `saucerjam_process_uptime_seconds`, `_resident_memory_bytes`, `_heap_bytes`, `saucerjam_system_load1` | gauge | Process/runtime health |

`GET /health` remains the coarse liveness probe: `{status, rankings, rooms, players}`.

## 2. Wiring (already applied)

The observability stack runs on the Oracle free-tier host `free-arm-01`
(Tailscale `100.72.3.78`) under `/opt/observability`; the Pi5 was retired from
monitoring on 2026-09-25 and now only runs Home Assistant. Four containers:

| Container | Role |
| --- | --- |
| `obs-prometheus` | scrape + rule evaluation (`127.0.0.1:9090`) |
| `obs-grafana` | dashboards and alerting UI (`:3001`) |
| `obs-blackbox` | outside-in HTTP probe of the public URL (internal `:9115`) |
| `obs-node-exporter` | host CPU / memory / disk (`:9100`) |
| `obs-cadvisor` | per-container memory (the game's RSS panel) |

Prometheus config `/opt/observability/prometheus/prometheus.yml` scrapes job
`saucerjam` (`https://qd.menezmethod.com/metrics`, 15s), `blackbox-http`,
`oci-node`, `oci-cadvisor`, and the LAN hosts over Tailscale. It also loads
`/etc/prometheus/saucerjam.rules.yml` via `rule_files` (SLI recording rules and
alerts). Repo mirrors: `deploy/monitoring/scrape.yml`,
`deploy/monitoring/saucerjam.rules.yml`.

The **blackbox exporter** (`obs-blackbox`, config
`/opt/observability/blackbox/blackbox.yml`, repo mirror
`deploy/monitoring/blackbox/blackbox.yml`) probes
`https://qd.menezmethod.com/health` from outside. Unlike a plain scrape, it
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


Grafana is **file-provisioned** from `/opt/observability/grafana/`, so the
running dashboards match this repo and survive a container rebuild:

| Path | Loads |
| --- | --- |
| `provisioning/datasources/prometheus.yaml` | Prometheus, UID pinned to `prom` |
| `provisioning/dashboards/provider.yaml` | every JSON in `dashboards/`, into the **SaucerJam** folder, UI edits disabled |
| `dashboards/saucerjam-{health,players}.json` | the two official dashboards (§2.1) |

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

Two dashboards, split on purpose — Google keeps reliability and product metrics
apart, because a quiet Tuesday is not an outage and nobody should be paged for
it:

| Dashboard | UID / URL | Question it answers |
| --- | --- | --- |
| Service health (SLOs) | `/d/saucerjam-health` | *Are players OK?* — SLOs and the four golden signals |
| Players & game | `/d/saucerjam-players` | *What should we build next?* — engagement and friction |

Every panel carries an **(i) description** explaining the metric, its threshold,
and why it exists, and each board opens with a "how to read this" panel. The
design follows Google SRE guidance:

- the **four golden signals** — latency, traffic, errors, saturation (SRE book,
  ch. 6) — ordered so symptoms (player-visible) sit above causes;
- latency measured as **"X% of requests faster than Y"** on a histogram bucket,
  never an average, so a slow tail cannot hide inside a good mean;
- **error-budget burn rate** over 1h and 6h windows: the numbers a mature
  multi-window, multi-burn-rate alert would page on;
- a **synthetic-probe SLI** for availability (the blackbox probe of
  `https://qd.menezmethod.com/health`) that stays populated with zero players —
  the workbook's advice for low-traffic services;
- availability is **blip-tolerant**: a minute counts as up if any probe in it
  succeeded, so one failed 15s scrape is not billed as downtime;
- an **error-budget attribution row** that separates raw probe failures from
  *billed* outages and shows whether a failure was HTTP, TLS, TCP or DNS, so a
  budget drop is always traceable to a cause;
- request SLOs **exclude `/health` and `/metrics`** (about 99% of all hits),
  which would otherwise pin the success rate at 100% forever.

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
| `SaucerJamTlsCertExpiring` | warning | public TLS cert expires within 14 days |
| `SaucerJamHealthDegraded` | warning | rankings persistence degraded for 5m |
| `SaucerJamRoomsSaturated` | warning | `saucerjam_rooms >= 8` for 5m |
| `SaucerJamJoinFailureSpike` | warning | join failures > 0.5/s for 5m |
| `SaucerJamManyHumansPerRoom` | warning | pilots/room > 24 for 5m |
| `SaucerJamMemoryHigh` | warning | RSS > 384 MiB for 10m (container cap 512 MiB) |
| `SaucerJamRankingSaveErrors` | warning | any round save error in 15m |
| `SaucerJamRateLimitStorm` | warning | limiter rejections > 5/s for 5m |
| `SaucerJamPlayersStuck` | warning | `insight_friction_ratio{signal="stuck_no_input_per_session"} > 0.15` for 30m |

The file also holds the **SLI recording rules** (`saucerjam-sli` group):
`saucerjam:sli_availability:up1m` (1 if any blackbox probe in the last minute
succeeded) and `saucerjam:sli_availability:ratio_30d`. Prometheus evaluates all
**14 rules** (`promtool check rules` → SUCCESS: 14 rules found) and, since
2026-09-25, actually loads them via `rule_files` on Oracle.

Grafana file-provisions the contact point `grafana-hermes`
(`provisioning/alerting/contact-points.yaml`) and sets it as the root
notification-policy receiver, replacing the previous `Telegram Alerts` route.
Grafana posts to the relay `grafana-hermes-relay.service` on the Pi5 at
`http://host.docker.internal:8787/`; the relay adds `X-Hub-Signature-256` (HMAC)
and forwards to the Hermes gateway at
`http://100.82.231.99:8644/webhooks/grafana-alerts` (subscription
`grafana-alerts`), which triages and escalates to Telegram. Verified end to end
on 2026-09-19: a Grafana-evaluated rule produced relay `POST / → 200` and Hermes
`POST /webhooks/grafana-alerts → 200`. Details:
`deploy/monitoring/grafana-alerts-contact-point.md`.

> **Migration status (2026-09-25):** the paragraph above describes the Pi5
> stack, where it was verified. On Oracle the rules now load and evaluate (see
> above), but **no alert reaches a human yet**: Grafana's root
> notification policy is still the no-op `empty` receiver, and the Hermes relay
> only runs on the Pi5. Wiring the receiver (and moving the relay to Oracle or
> pointing at it over the tailnet) is the next migration step. Until then the
> dashboards — including the §2.1 attribution row — are the working signal.

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
1. `curl -fsS https://qd.menezmethod.com/health` — confirm from off-host.
2. Check the Coolify app status (`GET /api/v1/applications/<uuid>`) and container.
3. Check RSS before restart — if it was OOM, capture the value for the incident.
4. Restart via Coolify; re-run `live.cjs`. If it stays down, escalate.

### Runbook: RankingsDegraded
1. `saucerjam_ranking_save_errors_total` / `saucerjam_rankings_status{status="degraded"}`.
2. SSH to the host; verify the rankings volume is mounted and writable.
3. Do **not** delete `rankings.json`; back it up before any manual edit.

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
