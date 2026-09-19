# Grafana contact point: `grafana-hermes` (SaucerJam alerts -> Hermes)

Grafana cannot sign an inbound Hermes webhook (no per-request HMAC), so alerts go
to the relay on Pi5 (`grafana-hermes-relay.py`), which adds
`X-Hub-Signature-256 = sha256=hmac(secret, body)` and forwards to Hermes.

## Endpoint

| Setting | Value |
| --- | --- |
| Integration | Webhook |
| URL | `http://127.0.0.1:8787/` (Grafana and the relay both run on Pi5) |
| HTTP method | `POST` |
| Authorization header | `Bearer <GRAFANA_RELAY_TOKEN>` |
| Basic auth | disabled |
| TLS | off (loopback only; the relay reaches Hermes over Tailscale) |
| Custom payload | left at default (Grafana's standard JSON) |

The relay recognises these payload fields (`title`, `state`, `status`,
`alerts[].labels`, `alerts[].annotations`, `alerts[].value_string`,
`externalURL`) and forwards them to `HERMES_WEBHOOK_URL`.

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

## Verify

```bash
curl -s localhost:8787/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/ \
  -H "Authorization: Bearer $GRAFANA_RELAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"test","state":"alerting","status":"firing","alerts":[{"labels":{"severity":"warning","service":"saucerjam"},"annotations":{"summary":"test"}}]}'
```
