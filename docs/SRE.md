# SRE: metrics, alerts, and AI operations

SaucerJam is monitored by the self-hosted **Prometheus + Grafana** stack on Pi5
(`192.168.0.207`), and alerts are triaged by the **Hermes** agent. This document
is the operational contract: what is measured, what fires, what the AI may do on
its own, and what always needs a human.

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
| `saucerjam_rate_limited_total{route}` | counter | Limiter rejections |
| `saucerjam_http_requests_total{method,route,status}` | counter | HTTP requests |
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

Pi5 Prometheus config: `/home/menez/docker/prometheus/prometheus.yml` — job
`saucerjam` scrapes `https://qd.menezmethod.com/metrics` every 15s. Alert rules:
`/home/menez/docker/prometheus/saucerjam.rules.yml` (loaded via `rule_files`).
Repo copies live in `deploy/monitoring/`.

To re-apply on a new host (never use `sed`; it corrupts multi-line YAML):

```bash
scp deploy/monitoring/scrape.yml deploy/monitoring/saucerjam.rules.yml menez@192.168.0.207:/tmp/
ssh menez@192.168.0.207 'python3 - <<"PY"
import yaml, shutil, time
p="/home/menez/docker/prometheus/prometheus.yml"
c=yaml.safe_load(open(p))
c.setdefault("rule_files",[])
if "/home/menez/docker/prometheus/saucerjam.rules.yml" not in c["rule_files"]:
    c["rule_files"].append("/home/menez/docker/prometheus/saucerjam.rules.yml")
c["scrape_configs"]=[j for j in c["scrape_configs"] if j.get("job_name")!="saucerjam"]
c["scrape_configs"].append({"job_name":"saucerjam","scheme":"https","metrics_path":"/metrics","scrape_interval":"15s","static_configs":[{"targets":["qd.menezmethod.com"],"labels":{"service":"saucerjam","env":"production"}}]})
shutil.copy(p,p+".bak."+time.strftime("%Y%m%d%H%M%S")); yaml.dump(c,open("/tmp/p.new","w"),sort_keys=False); shutil.copy("/tmp/p.new",p)
PY
cp /tmp/saucerjam.rules.yml /home/menez/docker/prometheus/saucerjam.rules.yml
docker kill -s SIGHUP prometheus-prometheus-1'
```

Verify:

```bash
curl -s 'http://192.168.0.207:9090/api/v1/targets' | python3 -c "import sys,json;[print(t['scrapeUrl'],t['health']) for t in json.load(sys.stdin)['data']['activeTargets'] if t['labels'].get('job')=='saucerjam']"
```

Grafana dashboard **SaucerJam** (`/d/saucerjam-sre/saucerjam`) is file-provisioned
from `/home/menez/docker/prometheus/grafana/provisioning/dashboards/saucerjam-dashboard.json`.
Repo source: `deploy/monitoring/grafana-dashboard.json`.

## 3. Alerts

Rules live in `deploy/monitoring/saucerjam.rules.yml`. Each alert carries
`severity`, `service=saucerjam`, a `summary`/`description`, and a `runbook_url`
pointing at a section below.

| Alert | Severity | Fires when |
| --- | --- | --- |
| `SaucerJamDown` | critical | `up{job="saucerjam"} == 0` for 2m |
| `SaucerJamHealthDegraded` | warning | rankings persistence degraded for 5m |
| `SaucerJamRoomsSaturated` | warning | `saucerjam_rooms >= 8` for 5m |
| `SaucerJamJoinFailureSpike` | warning | join failures > 0.5/s for 5m |
| `SaucerJamManyHumansPerRoom` | warning | pilots/room > 24 for 5m |
| `SaucerJamMemoryHigh` | warning | RSS > 384 MiB for 10m (container cap 512 MiB) |
| `SaucerJamRankingSaveErrors` | warning | any round save error in 15m |
| `SaucerJamRateLimitStorm` | warning | limiter rejections > 5/s for 5m |

Grafana routes firing alerts to Hermes (contact point → Hermes webhook on
`:8644`, subscription `grafana-alerts`), which triages and escalates to Telegram.

## 4. AI authority (self-heal vs escalate)

**Hermes may do automatically, with no human approval:**

- Restart the SaucerJam container via Coolify (`POST /api/v1/deploy?uuid=<app>`),
  and restart `coolify-proxy` on Pi5 if ingress is down. Never `docker rm -f`,
  never delete volumes, never edit DNS/TLS.
- Re-run the bounded smoke check (`node scripts/verification/live.cjs <url> 2`).
- Open a **fix PR** or a **prototype branch + PR preview** in response to a
  community report (see §6).
- Post a status message to Telegram and a comment on the Fider post.

**Hermes must escalate to a human (no action) when:**

- The fix would change game balance, monetization, or the public roadmap.
- The change touches secrets, Supabase auth config, billing, or DNS.
- Two automatic restart attempts fail, or the error is not reproducible.
- A community proposal fails the gates in §6.

**Hard invariants:** no automatic merge to `main`; no `git push --force`; no
editing production env vars; deployments end active matches, so never deploy
during a visibly busy window without noting it.

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
1. Inspect `route` label; `chat` and `/api/*` are the usual suspects.
2. Distinguish abuse (single IP) from a stuck client; only the latter is a bug.

## 6. Community → AI pipeline

See `docs/AUTOMATION.md` for the full design. Summary: Fider webhook → signed
`POST /api/community/webhook` → deterministic proposal → Hermes reads
`GET /api/community/queue` with `x-community-token` → acts via
`POST /api/community/action` (allow-list only) → maintainer/community gate.

## 7. Environment variables (server)

| Variable | Purpose |
| --- | --- |
| `FIDER_WEBHOOK_SECRET` | HMAC secret for inbound Fider webhooks |
| `COMMUNITY_ACTION_TOKEN` | Shared secret for the AI queue/action endpoints |
| `FIDER_BASE_URL`, `FIDER_API_KEY` | Existing outbound report bridge (Coolify env) |
| `MAX_ROOMS`, `MAX_ROOM_PLAYERS`, `MAX_CONNECTIONS` | Admission limits (unchanged) |

Never commit real values; set them in Coolify.
