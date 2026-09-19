# Grafana contact point: `grafana-hermes` (SaucerJam alerts -> Hermes)

**Deployed and verified 2026-09-19** on the Pi5 (`prometheus-grafana-1`, Grafana
13.0.2). Grafana file-provisions both the contact point and the root notification
policy; the relay adds the HMAC signature and forwards to Hermes.

## Data path

    Grafana container (prometheus-grafana-1)
      -> http://host.docker.internal:8787/                    (host systemd: grafana-hermes-relay)
      -> http://100.82.231.99:8644/webhooks/grafana-alerts    (Hermes gateway, HMAC)

Grafana cannot sign an inbound Hermes webhook (no per-request HMAC), so alerts go
to the relay on Pi5 (`deploy/monitoring/grafana-hermes-relay.py`), which
authenticates Grafana with a bearer token and then signs the forwarded body with
`X-Hub-Signature-256 = sha256=hmac(secret, body)`.

## Contact point (file-provisioned)

Installed on the Pi5 as
`/home/menez/docker/prometheus/grafana/provisioning/alerting/contact-points.yaml`.
Repo mirror: `deploy/monitoring/grafana-provisioning/alerting/contact-points.yaml`.

| Setting | Value |
| --- | --- |
| name / uid | `grafana-hermes` |
| Integration | Webhook |
| URL | `http://host.docker.internal:8787/` |
| HTTP method | `POST` |
| Authorization scheme | `Bearer` |
| Authorization credentials | `<GRAFANA_RELAY_TOKEN>` (Grafana secure field; substituted on the host, never committed) |
| Basic auth | disabled |
| TLS | off (container -> host bridge; the relay reaches Hermes over Tailscale) |
| Resolve message | enabled (recovery notifications are forwarded too) |

The relay recognises `title`, `state`, `status`, `alerts[].labels`,
`alerts[].annotations`, `alerts[].value_string` and `externalURL`, and forwards
the flat fields the Hermes `grafana-alerts` subscription expects.

## Notification policy (file-provisioned)

Installed as `.../provisioning/alerting/policies.yaml`; repo mirror
`deploy/monitoring/grafana-provisioning/alerting/policies.yaml`.

- root receiver: `grafana-hermes`
- `group_by: [alertname, job]`
- `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 4h`

This **replaces** the previous API-provisioned root receiver (`Telegram Alerts`).
The `Telegram Alerts` contact point still exists but is no longer on the default
route, so firing alerts now reach Hermes instead of Grafana's own Telegram bot.

## Host prerequisites (re-creatable)

The relay stays a host systemd unit (`grafana-hermes-relay.service`). Two host-side
settings let the container reach it and must be reapplied on a rebuild:

1. Grafana needs the Docker host-gateway alias (in
   `/home/menez/docker/prometheus/docker-compose.yml`):

       extra_hosts:
         - "host.docker.internal:host-gateway"

2. `ufw` runs with `INPUT DROP`, which silently drops container -> host traffic.
   One scoped allow is required (172.16.0.0/12 covers the compose subnet):

       sudo ufw allow from 172.16.0.0/12 to any port 8787 proto tcp comment 'grafana-hermes relay'

3. Provisioning files must be owned by the Grafana user (uid 472) while keeping
   mode 0600, because `authorization_credentials` is a secure field:

       sudo chown 472:472 <...>/alerting/contact-points.yaml <...>/alerting/policies.yaml
       sudo chmod 600  <...>/alerting/contact-points.yaml <...>/alerting/policies.yaml

   With mode 600 but the wrong owner (e.g. `menez`), Grafana exits with
   `open /etc/grafana/provisioning/alerting/contact-points.yaml: permission denied`.

## Credentials used

The Grafana admin password was not present in the Pi's env. The Grafana HTTP API
was therefore called with the existing service-account token from the `mcp-grafana`
container's `GRAFANA_SERVICE_ACCOUNT_TOKEN` (user `sa-1-mcp-grafana`, `canAdmin`).
No password or token value is printed or committed.

## Relay environment (`/home/menez/grafana-hermes-relay/.env`)

| Variable | Purpose |
| --- | --- |
| `GRAFANA_RELAY_TOKEN` | Bearer token Grafana sends; must match the contact point |
| `HERMES_WEBHOOK_URL` | `http://100.82.231.99:8644/webhooks/grafana-alerts` |
| `HERMES_WEBHOOK_SECRET` | Subscription secret used to HMAC-sign the forwarded body |
| `PORT` | Optional, defaults to `8787` |

Never commit values. Rotate `GRAFANA_RELAY_TOKEN` and `HERMES_WEBHOOK_SECRET`
together with the contact point and the Hermes subscription.

## Health

`GET http://127.0.0.1:8787/health` returns
`{"ok": true, "uptime": <seconds>, "hermes_reachable": <bool>}`. A watchdog should
treat `hermes_reachable: false` as "relay up, path to Hermes down" and escalate.
From inside the Grafana container the same check is
`GET http://host.docker.internal:8787/health`.

## Verify

    curl -s localhost:8787/health
    docker exec prometheus-grafana-1 wget -qO- http://host.docker.internal:8787/health
    curl -s -H "Authorization: Bearer $GRAFANA_SA_TOKEN" \
      localhost:3001/api/v1/provisioning/contact-points
    curl -s -H "Authorization: Bearer $GRAFANA_SA_TOKEN" \
      localhost:3001/api/v1/provisioning/policies

End-to-end proof must go through Grafana's own evaluator, not a direct POST to the
relay. On 2026-09-19 a deliberately firing rule (`vector(1)` + classic condition
> 0) was created via `POST /api/v1/provisioning/alert-rules`, Grafana evaluated
it, and at 12:21:02 local the relay logged `POST / HTTP/1.1 200` (x5) while the
Hermes gateway logged `POST /webhooks/grafana-alerts HTTP/1.1 200` (x5) from the
Pi relay (`100.100.46.29`, `Python-urllib/3.11`) with no `Invalid signature`
warning. The rule and its temp folder were then deleted.
