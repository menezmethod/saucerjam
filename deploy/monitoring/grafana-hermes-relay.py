#!/usr/bin/env python3
"""Tiny Grafana -> Hermes webhook relay.

Grafana alert contact points can send a static Authorization header, but they
cannot compute a per-request HMAC. Hermes inbound webhooks require
X-Hub-Signature-256 = sha256(hmac(secret, body)). This relay bridges the two:
it authenticates Grafana with a bearer token, then HMAC-signs the exact body
for Hermes.

Run on the Pi5 (or anywhere that can reach Hermes over Tailscale):
    GRAFANA_RELAY_TOKEN=<random> \
    HERMES_WEBHOOK_URL=http://100.82.231.99:8644/webhooks/grafana-alerts \
    HERMES_WEBHOOK_SECRET=<subscription secret> \
    python3 grafana-hermes-relay.py

Then add a Grafana contact point (webhook) at http://<host>:8787/ with header
`Authorization: Bearer <random>`.
"""
import hashlib
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("GRAFANA_RELAY_TOKEN", "")
HERMES_URL = os.environ.get("HERMES_WEBHOOK_URL", "")
HERMES_SECRET = os.environ.get("HERMES_WEBHOOK_SECRET", "")
PORT = int(os.environ.get("PORT", "8787"))


class Relay(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 - signature matches base class
        print("relay:", format % args, flush=True)

    def _deny(self, code, message):
        body = json.dumps({"error": message}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not TOKEN or self.headers.get("Authorization", "") != f"Bearer {TOKEN}":
            return self._deny(401, "unauthorized")
        if not (HERMES_URL and HERMES_SECRET):
            return self._deny(503, "relay not configured")
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw or b"{}")
        except Exception:
            return self._deny(400, "invalid JSON")

        # Normalise Grafana's alert payload into the flat fields the Hermes
        # "grafana-alerts" subscription prompt expects.
        alerts = payload.get("alerts") or []
        first = alerts[0] if alerts else {}
        labels = first.get("labels", {})
        annotations = first.get("annotations", {})
        message = {
            "alert.name": payload.get("title") or labels.get("alertname") or "SaucerJam alert",
            "alert.severity": labels.get("severity", "unknown"),
            "alert.service": labels.get("service", "unknown"),
            "alert.message": annotations.get("summary") or annotations.get("description") or "",
            "alert.current_value": str(first.get("value_string", "")),
            "alert.triggered_at": payload.get("state", ""),
            "alert.dashboard_url": payload.get("externalURL", ""),
            "alert.panel_url": "",
            "status": payload.get("status", ""),
        }
        body = json.dumps(message).encode()
        signature = "sha256=" + hmac.new(HERMES_SECRET.encode(), body, hashlib.sha256).hexdigest()

        import urllib.request

        req = urllib.request.Request(
            HERMES_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": signature,
                "X-GitHub-Event": "grafana-alert",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                code = resp.status
        except Exception as error:  # surface the failure back to Grafana
            return self._deny(502, f"hermes unreachable: {error}")
        self.send_response(200 if code < 300 else 502)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


if __name__ == "__main__":
    print(f"grafana-hermes-relay listening on :{PORT} -> {HERMES_URL}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Relay).serve_forever()
