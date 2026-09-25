#!/usr/bin/env python3
"""Generate the official SaucerJam Grafana dashboards.

Usage:
    python3 deploy/monitoring/dashboards/generate.py deploy/monitoring/dashboards

Writes ``saucerjam-product.json`` (business/VP), ``saucerjam-platform.json``
(principal: dependencies, DB, capacity) and ``saucerjam-health.json`` (SRE: SLOs
+ the four golden signals). The three share one story — business -> system ->
incident — and cross-link in their headers. The JSON is committed and
file-provisioned into Grafana, so edit this script and re-run it rather than
editing the JSON by hand. Every panel carries a ``description`` (the (i) icon)
explaining what it measures and why, following Google SRE guidance; the sources
are listed in the intro text panels and in ``docs/SRE.md``.

The datasource UID must stay ``prom`` to match the provisioned Prometheus.
"""
import json, sys

OUT = sys.argv[1]
DS = {"type": "prometheus", "uid": "prom"}
U = 'route!~"/health|/metrics"'  # probes are ~99% of requests; users are what we measure
SLO_AVAIL = 0.995
# Blip-tolerant availability SLI, recorded by saucerjam.rules.yml: 1 if any
# blackbox probe in the last minute succeeded, so one failed 15s scrape is not
# billed as downtime. Raw blips are surfaced in the attribution row instead.
SLI = 'saucerjam:sli_availability:up1m'
PROBE = 'probe_success{job="blackbox-http",service="saucerjam"}'
EXPECTED_30D = 30 * 24 * 60 * 4  # 15s samples in 30 days = 172800

class Board:
    def __init__(self):
        self.panels, self.y, self.x, self.rowh = [], 0, 0, 0

    def _place(self, w, h):
        if self.x + w > 24:
            self.y += self.rowh; self.x = 0; self.rowh = 0
        pos = {"x": self.x, "y": self.y, "w": w, "h": h}
        self.x += w; self.rowh = max(self.rowh, h)
        return pos

    def row(self, title):
        self.y += self.rowh; self.x = 0; self.rowh = 0
        self.panels.append({"type": "row", "title": title, "collapsed": False, "panels": [], "gridPos": self._place(24, 1)})
        self.y += 1; self.x = 0; self.rowh = 0

    def text(self, md, w=24, h=6, title=""):
        self.panels.append({"type": "text", "title": title, "gridPos": self._place(w, h), "options": {"mode": "markdown", "content": md}})

    def add(self, typ, title, desc, targets, w=8, h=7, unit=None, no_value=None, thresholds=None, minv=None, maxv=None, extra=None, legend=True):
        defaults = {}
        if unit: defaults["unit"] = unit
        if no_value: defaults["noValue"] = no_value
        if minv is not None: defaults["min"] = minv
        if maxv is not None: defaults["max"] = maxv
        if thresholds:
            defaults["thresholds"] = {"mode": "absolute", "steps": [{"color": c, "value": v} for v, c in thresholds]}
            defaults["color"] = {"mode": "thresholds"}
        p = {"type": typ, "title": title, "description": desc, "datasource": DS, "gridPos": self._place(w, h),
             "fieldConfig": {"defaults": defaults, "overrides": []},
             "targets": [{"refId": chr(65 + i), "datasource": DS, "expr": e, "legendFormat": l} for i, (e, l) in enumerate(targets)]}
        if typ == "timeseries":
            p["options"] = {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": legend}, "tooltip": {"mode": "multi"}}
        if typ == "stat":
            p["options"] = {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "none"}
        if extra: p.update(extra)
        self.panels.append(p)

    def dump(self, uid, title, desc, tags, links):
        return {"uid": uid, "title": title, "description": desc, "tags": tags, "timezone": "browser", "schemaVersion": 39,
                "refresh": "1m", "time": {"from": "now-24h", "to": "now"}, "editable": True, "links": links, "panels": self.panels}

LINKS = [
    {"title": "Product & growth", "type": "link", "url": "/d/saucerjam-product"},
    {"title": "Platform & dependencies", "type": "link", "url": "/d/saucerjam-platform"},
    {"title": "Service health (SLOs)", "type": "link", "url": "/d/saucerjam-health"},
    {"title": "Runbooks (docs/SRE.md)", "type": "link", "url": "https://github.com/menezmethod/saucerjam/blob/main/docs/SRE.md", "targetBlank": True},
]

def ratio_line(slo):
    # dashed red target line drawn from a constant query
    return {"matcher": {"id": "byName", "options": "SLO target"}, "properties": [
        {"id": "custom.lineStyle", "value": {"fill": "dash", "dash": [10, 10]}}, {"id": "color", "value": {"mode": "fixed", "fixedColor": "red"}}]}

# ---------------------------------------------------------------- Service health
b = Board()
b.text("""### How to read this dashboard
Read it **top to bottom**, the way Google SREs triage a page.

1. **SLOs (top row):** *are players OK?* An SLO (Service Level Objective) is the reliability target we promise, e.g. "up 99.5% of the time". The **error budget** is the 0.5% we're *allowed* to fail. Budget left → ship features. Budget gone → fix reliability first.
2. **The four golden signals** (Google SRE book, ch. 6): **Latency** (how slow), **Traffic** (how much), **Errors** (how often it fails), **Saturation** (how full). If you can only watch four things, watch these.
3. Rule of thumb: **alert on symptoms players feel** (top rows), **debug with causes** (bottom rows). A full CPU nobody notices is not an emergency; a failed join is.

**Low-traffic caveat:** SaucerJam has only a handful of players, so request-based numbers are noisy or empty ("no players in window" is normal). That's why the headline availability uses a **synthetic probe**: the blackbox exporter fetches `qd.menezmethod.com/health` through Cloudflare every 15s, like a robot player, and records *why* it failed when it does. The SRE workbook recommends this for low-traffic services.

**One failed probe is not an outage.** The availability SLI counts a minute as up if *any* probe in it succeeded, so a single transient network blip does not spend error budget — only a sustained outage does. Every raw failure is still shown in **Error budget attribution**, so nothing is hidden.
Sources: [SRE book: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) · [Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/) · [Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) · [Google Cloud SRE blog](https://cloud.google.com/blog/products/devops-sre) · [SRE Weekly](https://sreweekly.com/)""", h=10)

b.row("SLOs: are players OK? (30-day window)")
b.add("stat", "Availability, 30d (SLO 99.5%)", f"""**SLI:** share of minutes a blackbox probe from outside reached `https://qd.menezmethod.com/health` through Cloudflare.
**SLO: {SLO_AVAIL:.1%}**, about 3.6 hours of allowed downtime per month.
**Blip-tolerant on purpose:** a minute counts as available if *any* 15s probe in it succeeded, so one transient network hiccup is not billed as an outage. Sustained failures still count in full.
**Why 99.5% and not 99.99%?** One free VM, no redundancy, one developer. Google's advice: set the target to what users need and what you can afford, not "as high as possible". Each extra nine costs about 10x more work.
**Why a probe?** Too few players for request-based numbers to mean anything (the workbook's advice for low-traffic services).""",
      [(f'avg_over_time({SLI}[30d])', "")], w=6, h=6, unit="percentunit",
      thresholds=[(None, "red"), (SLO_AVAIL, "green")], extra={"options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "none", "decimals": 3}})
b.add("stat", "Error budget left, 30d", f"""**Error budget** = 100% minus SLO = {1-SLO_AVAIL:.1%} of the month we're allowed to be down. 100% = untouched, 0% = spent.
**Read it with the coverage panel next door.** This is a 30-day window, so before the probe has run for 30 days the number is an extrapolation from the time covered so far — a couple of early failures look worse than they are, and it climbs back as clean minutes accumulate.
**How to use it (Google's error-budget policy):** budget left → take risks, ship features, deploy on Fridays. Budget spent → freeze risky changes and fix reliability. When it drops, the **Error budget attribution** row says exactly what spent it.""",
      [(f'1 - (1 - avg_over_time({SLI}[30d])) / {1-SLO_AVAIL}', "")], w=6, h=6, unit="percentunit",
      thresholds=[(None, "red"), (0.25, "orange"), (0.5, "green")], minv=0)
b.add("stat", "SLO window coverage, 30d", f"""How much of the 30-day window actually has probe data.
`100%` = a full month of history (only true ~30 days after monitoring started). Until then the error budget is an extrapolation, and this panel is the honesty check: **low coverage → treat the budget as provisional**, not as a monthly verdict.
The probe was added on 2026-09-25, so coverage reaches 100% around late October.""",
      [(f'count_over_time({SLI}[30d]) / {EXPECTED_30D}', "")], w=6, h=6, unit="percentunit",
      thresholds=[(None, "red"), (0.5, "orange"), (0.9, "green")], extra={"options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "none", "decimals": 1}})
b.add("stat", "Burn rate, 1h", f"""**Burn rate** = how fast we're spending the error budget. 1 = exactly on pace to use it all in 30 days. 14.4 = the whole month's budget gone in about 2 days.
Google's **multi-window, multi-burn-rate** alerting pages a human when the 1h burn rate is above **14.4** (2% of the monthly budget in one hour) *and* the 5m burn rate confirms it's still happening.
This is the number a mature setup would page on.""",
      [(f'(1 - avg_over_time({SLI}[1h])) / {1-SLO_AVAIL}', "")], w=6, h=6, unit="x",
      thresholds=[(None, "green"), (6, "orange"), (14.4, "red")])
b.add("stat", "Burn rate, 6h", """Same idea over 6 hours. The workbook's second paging tier: burn rate above **6** over 6h (5% of the monthly budget) means a slower but real problem.
Two windows catch both kinds of failure: sudden outages (1h) and slow leaks (6h).""",
      [(f'(1 - avg_over_time({SLI}[6h])) / {1-SLO_AVAIL}', "")], w=6, h=7, unit="x",
      thresholds=[(None, "green"), (1, "orange"), (6, "red")])
b.add("timeseries", "Availability, hourly vs SLO (sustained)", """Hourly availability on the blip-tolerant SLI. Any dip below the dashed line is budget being spent.
Look for **patterns**: dips at the same time every day usually mean a cron job, backup or deploy.""",
      [(f'avg_over_time({SLI}[1h])', "availability"), (str(SLO_AVAIL), "SLO target")], w=18, h=7, unit="percentunit", maxv=1,
      extra={"fieldConfig": {"defaults": {"unit": "percentunit", "max": 1}, "overrides": [ratio_line(SLO_AVAIL)]}})

b.add("stat", "Join success, 30d (SLO 99%)", """**SLI for the most important player journey: pressing "Play online" and getting into a match.**
= successful joins / (successful joins + joins rejected by the server).
Rejections by `rate_limited` or `debounced` are excluded: those are the server protecting itself from spam clicks, not failures a real player feels.
Measure **user journeys**, not servers (Google: "SLIs should be as close to the user as possible").
Empty = nobody tried to join in the window.""",
      [('sum(increase(saucerjam_joins_total[30d])) / (sum(increase(saucerjam_joins_total[30d])) + (sum(increase(saucerjam_join_failures_total{reason!~"rate_limited|debounced"}[30d])) or vector(0)) > 0)', "")],
      w=6, h=5, unit="percentunit", no_value="no joins in window", thresholds=[(None, "red"), (0.99, "green")])
b.add("stat", "Request success, 30d (SLO 99.5%)", f"""**SLI:** share of real HTTP requests (health checks and /metrics excluded) that did *not* return a 5xx.
**Only 5xx counts as bad.** A 404 from a scanner guessing URLs is the client's fault, not ours. Google counts errors the *service* causes.
Health checks are excluded because they're about 99% of all requests and would keep this number at 100% forever.""",
      [(f'1 - ((sum(increase(saucerjam_http_requests_total{{status=~"5..",{U}}}[30d])) or vector(0)) / (sum(increase(saucerjam_http_requests_total{{{U}}}[30d])) > 0))', "")],
      w=6, h=5, unit="percentunit", no_value="no requests in window", thresholds=[(None, "red"), (0.995, "green")])
b.add("stat", "Fast requests, 30d (SLO 95% < 250ms)", f"""**Latency SLI:** share of real HTTP requests answered in under **250ms**.
**Why a threshold ratio and not "average latency"?** Averages hide pain: 99 fast requests and 1 ten-second one average out to "fine". Google recommends "X% of requests faster than Y", which also plugs straight into an error budget.
250ms is one of the histogram's bucket edges, so this is exact, not interpolated.""",
      [(f'sum(increase(saucerjam_http_request_duration_seconds_bucket{{le="0.25",{U}}}[30d])) / (sum(increase(saucerjam_http_request_duration_seconds_count{{{U}}}[30d])) > 0)', "")],
      w=6, h=5, unit="percentunit", no_value="no requests in window", thresholds=[(None, "red"), (0.95, "green")])
b.add("stat", "Smooth pings, 30d (SLO 90% < 150ms)", """**Game-feel SLI:** share of in-game pings (reported by players' browsers) that round-tripped in under **150ms**.
For a real-time shooter, this *is* the latency players feel. Above about 150ms, hits start to feel wrong.
It measures the player's network + Cloudflare + our server, so a bad number can be the player's Wi-Fi. That's fine: an SLI measures what the user experiences, whoever is at fault.
Empty = nobody played online in the window.""",
      [('sum(increase(saucerjam_ws_round_trip_seconds_bucket{le="0.15"}[30d])) / (sum(increase(saucerjam_ws_round_trip_seconds_count[30d])) > 0)', "")],
      w=6, h=5, unit="percentunit", no_value="no online play in window", thresholds=[(None, "red"), (0.9, "green")])

b.row("Error budget attribution: who spent it?")
b.text("""### Reading attribution
When the budget drops, this row answers *what* did it. Two layers:

1. **Raw vs billed.** Every failed 15s probe is a *raw* failure. A *billed* outage is one that lasted a full minute (see the intro). Most blips are raw-only and cost nothing.
2. **Cause.** The blackbox probe records how far the request got. If `probe_http_status_code` is present, the connection worked and **Cloudflare or the app returned a bad status**. If it is absent while the phase timings stop, the failure was **DNS, TCP or TLS** — i.e. below our app.

Player-facing budgets (join, request, latency, ping) are attributed by the panels in the **Errors** row further down.""", h=8)
b.add("stat", "Billed outage, 30d", f"""Sustained downtime that actually spends the error budget: 15s per billed sample.
Raw single-scrape blips are excluded here on purpose — they are not outages a player felt — but they are counted next door.""",
      [(f'(count_over_time({SLI}[30d]) - sum_over_time({SLI}[30d])) * 15', "")], w=6, h=6, unit="s",
      thresholds=[(None, "green"), (60, "orange"), (600, "red")], no_value="0 (no sustained outage)")
b.add("stat", "Single-scrape blips, 30d (ignored)", """Raw probe failures too short to count as downtime — the ones that used to make the budget look spent.
A handful is normal internet noise. A steady stream points at a flaky path (Cloudflare edge, DNS, or the VM's network).""",
      [(f'clamp_min((count_over_time({PROBE}[30d]) - sum_over_time({PROBE}[30d])) - (count_over_time({SLI}[30d]) - sum_over_time({SLI}[30d])), 0)', "")], w=6, h=6,
      thresholds=[(None, "green"), (1, "orange"), (10, "red")], no_value="0")
b.add("stat", "Raw probe failures, 30d", "Every failed 15s probe, billed or not. The union of the two panels to the left.",
      [(f'count_over_time({PROBE}[30d]) - sum_over_time({PROBE}[30d])', "")], w=6, h=6, no_value="0")
b.add("stat", "TLS certificate expires in", """Days until the Cloudflare-served certificate for `qd.menezmethod.com` expires.
A leading indicator: if it reaches 0 the probe fails with a TLS error and **players cannot connect either**.""",
      [('(probe_ssl_earliest_cert_expiry{job="blackbox-http",service="saucerjam"} - time()) / 86400', "")], w=6, h=6, unit="d",
      thresholds=[(None, "red"), (14, "orange"), (30, "green")])
b.add("timeseries", "Probe success (each step down = a failure)", """The probe result over time. `0` is a failure. Most dips are a single scrape; a sustained line at 0 is a real outage.
Cross-reference with the panels to the right to see whether it was HTTP, TLS, TCP or DNS.""",
      [(f'{PROBE}', "probe success")], w=12, unit="short", minv=0, maxv=1)
b.add("timeseries", "Probe HTTP status code (200 = healthy)", """The status the probe received. A non-200 here means the connection succeeded and the failure was **above** DNS/TCP/TLS: a Cloudflare error page (5xx), a redirect, or the app returning an error.
If this line *disappears* during a failure, the request never got a response — look at the timing panel below.""",
      [('probe_http_status_code{job="blackbox-http",service="saucerjam"}', "status")], w=12, unit="short")
b.add("timeseries", "Probe time by phase (where it failed)", """How long each phase took: `resolve` (DNS), `connect` (TCP), `tls` (handshake), `processing` (server), `transfer` (body).
On a failure, whichever phase **stops appearing** is where it broke. A spike in one phase before a failure is your early warning.""",
      [('probe_http_duration_seconds{job="blackbox-http",service="saucerjam"}', "{{phase}}")], w=24, unit="s")

b.row("Golden signal 1: Latency (how slow?)")
b.add("timeseries", "HTTP latency p50 / p95 / p99 (real requests)", """**Percentiles, not averages.** p95 = 95% of requests were faster than this line. p99 = the unlucky 1%.
Tail latency (p99) is what your worst-off players feel, and with many requests per session, most players hit the tail eventually.
Health checks excluded. Gaps = no requests.""",
      [(f'histogram_quantile({q}, sum by (le) (rate(saucerjam_http_request_duration_seconds_bucket{{{U}}}[5m])))', f"p{int(q*100)}") for q in (0.5, 0.95, 0.99)],
      w=12, unit="s")
b.add("timeseries", "In-game ping p50 / p95 (player-reported)", """Round trip from the player's browser to the game server and back.
Rising p95 with flat server latency = network or Cloudflare problem, not our code. This split is how you find where time goes.""",
      [(f'histogram_quantile({q}, sum by (le) (rate(saucerjam_ws_round_trip_seconds_bucket[5m])))', f"p{int(q*100)}") for q in (0.5, 0.95)],
      w=12, unit="s")
b.add("timeseries", "p95 latency by route", """Which endpoint is slow? Once the top panel says *something* is slow, this panel says *what*.
Routes are templates (e.g. `/api/statistics`), never raw URLs. Raw URLs would let anyone create unlimited series (cardinality explosion).""",
      [(f'histogram_quantile(0.95, sum by (le, route) (rate(saucerjam_http_request_duration_seconds_bucket{{{U}}}[5m])))', "{{route}}")], w=12, unit="s")
b.add("timeseries", "Probe latency (outside-in)", """How long Prometheus takes to fetch /metrics through Cloudflare.
Always has data, even with zero players, so it's the **low-traffic stand-in** for user latency. A jump here with no code change usually means the network or the Oracle VM.""",
      [('scrape_duration_seconds{job="saucerjam"}', "probe")], w=12, unit="s")

b.row("Golden signal 2: Traffic (how much demand?)")
b.add("timeseries", "Pilots online: humans vs bots", """**Traffic** for a game = people playing, not HTTP hits.
Bots fill rooms so a lone player still has opponents. Humans going up while bots go down is the healthy pattern.
Also gives context to every other panel: an error spike with 0 humans online hurt nobody.""",
      [("saucerjam_players", "humans"), ("saucerjam_bots", "bots")], w=8)
b.add("timeseries", "Joins / leaves per minute", """Demand at the door. Leaves split by cause:
- **client**: the player chose to leave (normal)
- **transport**: the connection dropped (bad: network, deploy restart, or crash)
Many transport leaves at once = everyone got kicked. Check for a deploy at that time.""",
      [("sum(rate(saucerjam_joins_total[5m])) * 60", "joins"), ('sum by (cause) (rate(saucerjam_leaves_total[5m])) * 60', "leaves: {{cause}}")], w=8)
b.add("timeseries", "HTTP requests/s by route (real requests)", """Page loads and API calls from players. `unmatched` 200s are static game files (the page itself).
Health checks and /metrics are hidden: they're robots, and at about 99% of all hits they'd flatten everything else.""",
      [(f'sum by (route) (rate(saucerjam_http_requests_total{{{U}}}[5m]))', "{{route}}")], w=8, unit="reqps")

b.row("Golden signal 3: Errors (how often does it fail?)")
b.add("timeseries", "Server errors (5xx) by route", """Failures **we** caused. Feeds the "Request success" SLO above.
Zero is the normal state. Any sustained line here deserves a look at the container logs in Coolify.""",
      [(f'sum by (route) (rate(saucerjam_http_requests_total{{status=~"5..",{U}}}[5m]))', "{{route}}")], w=8, unit="reqps", no_value="0 server errors")
b.add("timeseries", "Join rejections by reason", """Why players couldn't get into a match:
- `rooms_full`: all 8 arenas busy (**capacity** problem, see Saturation)
- `room_not_found`: bad invite code or the room just closed
- `rate_limited` / `debounced`: spam clicks, the server protecting itself (excluded from the SLO)""",
      [('sum by (reason) (rate(saucerjam_join_failures_total[5m]))', "{{reason}}")], w=8, unit="reqps", no_value="0 rejections")
b.add("timeseries", "Leaderboard saves failing", """Round results that failed to save to Supabase. The game keeps working, but that match's rankings are lost.
`rankings degraded` = 1 means the last save failed. It usually means Supabase is paused, down, or the key rotated.
This is a **correctness** error: silent to players in the moment, painful later.""",
      [("sum(increase(saucerjam_ranking_save_errors_total[5m]))", "failed saves"), ('saucerjam_rankings_status{status="degraded"}', "rankings degraded")], w=8, no_value="0 failures")
b.add("timeseries", "Client errors (4xx), not counted against us", """Shown for contrast with 5xx. Mostly scanners probing random URLs (`unmatched` 404) and cached files (304 isn't even an error).
A sudden **429** spike means the rate limiter is rejecting a real client, or someone is hammering the API.""",
      [(f'sum by (status) (rate(saucerjam_http_requests_total{{status=~"4..",{U}}}[5m]))', "{{status}}")], w=12, unit="reqps")
b.add("timeseries", "Rate-limited by route", """Requests the server refused to protect itself (`chat` = chat flood control, `/api` = shared API bucket).
Occasional = working as designed. Constant = either an abuser or limits too tight for real players.""",
      [("sum by (route) (rate(saucerjam_rate_limited_total[5m]))", "{{route}}")], w=12, unit="reqps", no_value="0 rejected")

b.row("Golden signal 4: Saturation (how full are we?)")
b.add("gauge", "Game memory vs 512 MiB limit", """How close the game container is to its memory cap. At 100% Docker kills it and every match drops.
Saturation is a **leading** indicator: it warns *before* players feel it. Google suggests acting well before 100%, since latency usually degrades first.
Steady climb over days without more players = memory leak.""",
      [("saucerjam_process_resident_memory_bytes / (512 * 1024 * 1024)", "")], w=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.75, "orange"), (0.9, "red")])
b.add("gauge", "Arenas in use (of 8)", """Rooms open / MAX_ROOMS (8). At 100% new "Play online" joins get `rooms_full`.
This is the game's real capacity limit, and it will hit long before CPU or memory does. It's the first dial to watch if a post goes viral.""",
      [("saucerjam_rooms / 8", "")], w=6, unit="percentunit", minv=0, maxv=1, thresholds=[(None, "green"), (0.75, "orange"), (1, "red")])
b.add("gauge", "Oracle VM memory used", """The whole free server (12 GB), shared with Coolify, Fider, gimenez.dev, XamQuiz and this monitoring.
A noisy neighbour can starve the game. That's the trade-off of one shared box.""",
      [('1 - node_memory_MemAvailable_bytes{job="oci-node"} / node_memory_MemTotal_bytes{job="oci-node"}', "")], w=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.8, "orange"), (0.9, "red")])
b.add("gauge", "Oracle VM CPU busy", """Share of the 2 free ARM cores in use (5-min average).
The game simulates every match on the server (authoritative), so CPU grows with **active matches**, not page views.""",
      [('1 - avg(rate(node_cpu_seconds_total{job="oci-node",mode="idle"}[5m]))', "")], w=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.7, "orange"), (0.9, "red")])
b.add("timeseries", "Game process memory (RSS vs JS heap)", """RSS = total memory the process holds. Heap = memory used by JavaScript objects.
Both climbing = leak in game code (e.g. rooms never cleaned up). RSS climbing alone = native/buffer growth.
Resets to low after each deploy (process restart).""",
      [("saucerjam_process_resident_memory_bytes", "RSS"), ("saucerjam_process_heap_bytes", "JS heap")], w=12, unit="bytes")
b.add("timeseries", "Load average vs cores", """1-minute load average. Above the core count (2) = work is queuing and ticks will be late (players feel lag).
`saucerjam_system_load1` is reported by the game itself, `node` is the host view. They should match.""",
      [("saucerjam_system_load1", "load1 (game)"), ('node_load1{job="oci-node"}', "load1 (node)"), ("2", "cores")], w=12)

health = b.dump("saucerjam-health", "SaucerJam: Service health (SLOs)",
                "Official SaucerJam reliability dashboard: SLOs + four golden signals, following Google SRE guidance.",
                ["saucerjam", "sre", "official"], LINKS)

# ---------------------------------------------------------------- Product & growth
DB = 'container_label_com_docker_compose_service="supabase-db"'
GAME = 'container_label_coolify_resourceName="saucerjam"'
nod = {"options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "none"}}

b = Board()
b.text("""### Product & growth: the business view
For a VP/product reader: **are people playing, coming back, and is it worth investing in?**
This board is deliberately **separate from reliability** (Google's advice): a quiet Tuesday is not an outage and nobody gets paged for it. Reliability lives on **Service health**; the machinery underneath lives on **Platform & dependencies**.

**Read it as a funnel, top to bottom:** is the data trustworthy -> audience -> retention -> funnel -> depth -> experience -> community -> cost.
Act on the **shape over weeks**, not the last minute.

**Low-traffic caveat:** with a handful of players most panels are **empty or a single spike** at any moment — normal, not broken. Empty means "nobody did this in the window". Widen the range before concluding; 5m/1h rates at this scale are mostly noise.

**Blind vs calm:** a flat line can mean the telemetry stopped, not that players are happy. **Pipeline health** (row 1) is the heartbeat.
Metrics marked *needs deploy* appear after the next game deploy.""", h=10)

b.row("Pipeline health: is the data trustworthy?")
b.add("stat", "Landing views (24h)", """Page loads that reported telemetry in the last 24h — the top of the funnel and the first sanity check that the beacon works.
Empty = no landing views reported yet (or the client that emits `landing_view` is not deployed).""",
      [('sum(increase(insight_events_total{event="landing_view"}[24h]))', "")], w=6, h=6, extra=nod,
      no_value="no landing views yet")
b.add("stat", "Play sessions (24h)", """One websocket connection = one play session. The denominator for the friction ratios and the session-length panels.
Empty/0 across a day you *know* people played means telemetry is blind, not that nobody played.""",
      [("sum(increase(insight_sessions_total[24h]))", "")], w=6, h=6, extra=nod, no_value="no sessions yet")
b.add("stat", "Insight events (24h)", """Every UX event the client reported (starts, reports, friction, clicks) — the pipeline heartbeat.
**A flat zero is not good news**: it means the telemetry is blind (beacon blocked, JS error, endpoint down).""",
      [("sum(increase(insight_events_total[24h])) or vector(0)", "")], w=6, h=6, extra=nod)
b.add("timeseries", "Telemetry heartbeat (insight events per hour)", """The heartbeat over time. A gap is a period we cannot see player behaviour: usually a quiet spell (fine), occasionally a broken beacon (not fine).
Cross-check with starts: quiet telemetry *and* no starts = genuinely nobody playing.""",
      [("sum(increase(insight_events_total[1h]))", "events")], w=6, h=6)

b.row("Audience & retention: are people playing and coming back?")
b.add("stat", "Active pilots (24h)", "Distinct hashed pilot tokens that joined in the last 24h. *Needs deploy.*",
      [("saucerjam_distinct_pilots_1d", "")], w=6, h=5, extra=nod, no_value="needs deploy")
b.add("stat", "Active pilots (7d)", "Distinct pilots in the last 7 days — the single best 'is this game alive?' number.",
      [("saucerjam_distinct_pilots_7d", "")], w=6, h=5, extra=nod)
b.add("stat", "Active pilots (30d)", "Distinct pilots in the last 30 days. The bigger the gap to the 7d number, the more casual the audience. *Needs deploy.*",
      [("saucerjam_distinct_pilots_30d", "")], w=6, h=5, extra=nod, no_value="needs deploy")
b.add("stat", "Stickiness (24h / 30d)", """**DAU/MAU**: of everyone who played this month, what share played today?
A rising line = a habit forming. A high one-off spike = a launch you did not retain.""",
      [("saucerjam_distinct_pilots_1d / clamp_min(saucerjam_distinct_pilots_30d, 1)", "")], w=6, h=5, unit="percentunit",
      extra={**nod, "options": {**nod["options"], "decimals": 0}}, maxv=1, no_value="needs deploy")
b.add("timeseries", "Active pilots by window (24h / 7d / 30d)", """The three retention windows together. Watch the **shape**: 24h rising toward 7d means growing engagement; 7d flat while 30d climbs means new players are not returning.""",
      [("saucerjam_distinct_pilots_1d", "24h"), ("saucerjam_distinct_pilots_7d", "7d"), ("saucerjam_distinct_pilots_30d", "30d")], w=12)
b.add("timeseries", "Rounds finished by map", "Which maps get played to the end. A map nobody finishes is a candidate for a redesign.",
      [("sum by (map) (increase(saucerjam_rounds_completed_total[1h]))", "{{map}}")], w=12, no_value="no rounds in window")

b.row("Funnel: landing -> play -> finish")
b.add("stat", "Landing -> play", """Share of landing views that started a game (practice or online). The top-of-funnel conversion.
*Needs deploy.* Empty until `landing_view` is reported.""",
      [('sum(increase(insight_events_total{event=~"practice_start|online_start"}[24h])) / clamp_min(sum(increase(insight_events_total{event="landing_view"}[24h])), 1)', "")],
      w=6, h=5, unit="percentunit", maxv=1, extra={**nod, "options": {**nod["options"], "decimals": 0}}, no_value="needs deploy")
b.add("stat", "Join success (30d)", """Players who pressed "Play online" and got into a match.
Rejections from `rate_limited`/`debounced` are excluded — the server protecting itself, not a failure a player feels.""",
      [('sum(increase(saucerjam_joins_total[30d])) / clamp_min(sum(increase(saucerjam_joins_total[30d])) + (sum(increase(saucerjam_join_failures_total{reason!~"rate_limited|debounced"}[30d])) or vector(0)), 1)', "")],
      w=6, h=5, unit="percentunit", no_value="no joins in window")
b.add("stat", "Online start -> finished round", """Of the players who started an online match, how many played it to the end.
A low number = people bail mid-match; ask why in feedback (or check ping on Service health).""",
      [("sum(increase(saucerjam_rounds_completed_total[24h])) / clamp_min(sum(increase(insight_events_total{event=\"online_start\"}[24h])), 1)", "")],
      w=6, h=5, unit="percentunit", maxv=1, extra={**nod, "options": {**nod["options"], "decimals": 0}}, no_value="needs deploy")
b.add("stat", "Rounds finished (24h)", "Matches played to the end in the last day.",
      [("sum(increase(saucerjam_rounds_completed_total[24h])) or vector(0)", "")], w=6, h=5, extra=nod)
b.add("timeseries", "Funnel steps per hour", """The funnel in one picture: **landing views -> game starts -> joins -> finished rounds**.
A widening gap between two steps is where you lose people. Landing views and starts *need deploy*.""",
      [('sum(increase(insight_events_total{event="landing_view"}[1h]))', "landing views"),
       ('sum(increase(insight_events_total{event=~"practice_start|online_start"}[1h]))', "game starts"),
       ("sum(increase(saucerjam_joins_total[1h]))", "joins"),
       ("sum(increase(saucerjam_rounds_completed_total[1h]))", "rounds finished")], w=24)

b.row("Engagement depth: how much are they playing?")
b.add("stat", "Rounds per active pilot (24h)", "How many full matches the average active pilot played today. Rising = the core loop is holding attention. *Needs deploy.*",
      [("sum(increase(saucerjam_rounds_completed_total[24h])) / clamp_min(saucerjam_distinct_pilots_1d, 1)", "")], w=6, h=5, extra=nod, no_value="needs deploy")
b.add("stat", "Chat lines (24h)", "Social signal: players talking to each other is an early sign of community.",
      [("sum(increase(saucerjam_chat_messages_total[24h])) or vector(0)", "")], w=6, h=5, extra=nod)
b.add("timeseries", "Session length p50 / p95", """How long a play session lasts, from websocket connect to disconnect. p95 is the marathon session.
Sessions shorter than a round suggest people bounce; watch this after onboarding changes. *Needs deploy.*""",
      [(f'histogram_quantile({q}, sum by (le) (rate(saucerjam_session_seconds_bucket[30m])))', f"p{int(q*100)}") for q in (0.5, 0.95)],
      w=12, unit="s", no_value="needs deploy")
b.add("timeseries", "Time to first round p50 / p95", """From joining to finishing the first round. The single best onboarding number: if it is long, new pilots are wandering before they play. *Needs deploy.*""",
      [(f'histogram_quantile({q}, sum by (le) (rate(saucerjam_first_round_seconds_bucket[30m])))', f"p{int(q*100)}") for q in (0.5, 0.95)],
      w=12, unit="s", no_value="needs deploy")
b.add("timeseries", "Game events by type (per min)", """What happens inside matches: fire, hit, kill, portal use, pickups.
Ratios tell a design story: hits/fire = accuracy (too low = aiming is frustrating), kills/hit = how tanky players are.""",
      [("sum by (type) (rate(saucerjam_game_events_total[5m])) * 60", "{{type}}")], w=24)

b.row("Experience quality: where do they struggle?")
b.add("timeseries", "Friction signals (share of sessions)", """Behaviour hints that a player is confused, computed per session:
- `stuck_no_input`: sat there not pressing anything
- `died_without_kill`: never scored
- `no_aim_fire`: firing without aiming
- `menu_repeat`: bouncing around menus
These are UX smoke alarms, not errors. Rising after a deploy = something changed.""",
      [("insight_friction_ratio", "{{signal}}")], w=12, unit="percentunit")
b.add("timeseries", "Struggle by device", "Same friction signals split by device. If touch struggles far more than desktop, the mobile controls need work.",
      [('sum by (device) (rate(insight_events_total{event=~"died_without_kill|stuck_no_input|controls_struggle"}[15m]))', "{{device}}")], w=12)
b.add("timeseries", "Starts vs feedback opened (per min)", """Practice vs online starts, and how often players open the report form.
Reports rising faster than starts = something new is annoying people (often right after a deploy).""",
      [('sum(rate(insight_events_total{event="practice_start"}[10m]))*60', "practice starts"),
       ('sum(rate(insight_events_total{event="online_start"}[10m]))*60', "online starts"),
       ('sum(rate(insight_events_total{event="report_opened"}[10m]))*60', "reports opened")], w=12)
b.add("timeseries", "Most-used actions (per hour)", "What players actually click. Features nobody uses are candidates to cut.",
      [("sum by (event) (increase(insight_events_total[1h]))", "{{event}}")], w=12)

b.row("Community -> AI loop (Fider feedback pipeline)")
b.add("timeseries", "Feedback ingested by kind", """Fider posts accepted into the AI queue (bug / idea) — the input side of the automation loop.
Empty = no feedback in the window (normal until someone posts).""",
      [("sum by (kind) (increase(saucerjam_community_ingest_total[1h]))", "{{kind}}")], w=8, no_value="no feedback in window")
b.add("timeseries", "AI actions recorded", """What the automation did with feedback (triage, PR opened, ...).
**Ingest without actions = the loop is stuck.** Empty on both is a quiet pipeline; empty here *while* ingest is non-zero is the failure.""",
      [("sum by (action) (increase(saucerjam_community_actions_total[1h]))", "{{action}}")], w=8, no_value="no actions in window")
b.add("timeseries", "Webhooks rejected / Fider errors", """Rejected Fider webhooks by reason (bad signature, rate limit), plus `fider_last_error` = 1 when the last call to Fider failed.
Rejections from unknown sources are expected (the endpoint is public). Empty = the healthy state.""",
      [("sum by (reason) (increase(saucerjam_community_webhook_rejected_total[1h]))", "rejected: {{reason}}"), ("saucerjam_fider_last_error", "fider last call failed")], w=8, no_value="no rejections, no errors")

b.row("Cost & efficiency (Oracle Always Free)")
b.text("""SaucerJam runs entirely on the **Oracle Always Free** shape (2 ARM cores, 12 GB RAM, 200 GB disk): **$0/month**. There is no billing metric to graph, so the number that matters is **headroom** below.
If utilisation approaches the free shape, the decision is *scale up or move* — and that belongs on this board, because it is a business call, not an incident. Sources: [Google Cloud SRE blog](https://cloud.google.com/blog/products/devops-sre).""", h=4)
b.add("gauge", "Host CPU busy", "Share of the 2 free ARM cores in use (5-min average). The game simulates every match server-side, so CPU tracks active matches, not page views.",
      [('1 - avg(rate(node_cpu_seconds_total{job="oci-node",mode="idle"}[5m]))', "")], w=6, h=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.7, "orange"), (0.9, "red")])
b.add("gauge", "Host memory used", """The whole free VM (12 GB), shared with the game, Supabase, Fider and monitoring.
The database is the largest tenant — see Platform & dependencies.""",
      [('1 - node_memory_MemAvailable_bytes{job="oci-node"} / node_memory_MemTotal_bytes{job="oci-node"}', "")], w=6, h=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.8, "orange"), (0.9, "red")])
b.add("gauge", "Disk used (of 200 GB)", "Block-storage headroom on the free tier. Supabase, container images and the Prometheus 30-day TSDB all live here.",
      [('1 - node_filesystem_avail_bytes{job="oci-node",mountpoint="/"} / node_filesystem_size_bytes{job="oci-node",mountpoint="/"}', "")], w=6, h=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.8, "orange"), (0.9, "red")])
b.add("stat", "Free disk left", "Absolute headroom left on the free tier before you must pay or prune.",
      [('node_filesystem_avail_bytes{job="oci-node",mountpoint="/"} / 1024 / 1024 / 1024', "")], w=6, h=6, unit="decgbytes", extra=nod)

product = b.dump("saucerjam-product", "SaucerJam: Product & growth",
                 "Official SaucerJam business dashboard: audience, retention, funnel, engagement, and the cost of running it.",
                 ["saucerjam", "product", "business", "official"], LINKS)

# ---------------------------------------------------------------- Platform & dependencies
b = Board()
b.text("""### Platform & dependencies: the principal view
What this system is made of, where its limits are, and what will break first.
Read it when a symptom on **Service health** needs a *cause*, or before a capacity decision.

**Dependencies** (row 1) are things SaucerJam needs but does not control: Cloudflare, the Postgres behind Supabase, Fider, and the Oracle host.
**Data plane** (row 2) is the database; **capacity** (rows 3-4) is how full each layer is; **change correlation** (row 5) ties errors to deploys.

**Rule of thumb (Google SRE):** saturation is a *leading* indicator — act before 100%, because latency degrades first and players feel it before a graph turns red.""", h=9)

b.row("Dependency health: can we reach the things we depend on?")
b.add("stat", "Public path (Cloudflare)", """The outside-in blackbox probe of `https://qd.menezmethod.com/health`. 1 = reachable end to end.
This is the same signal the availability SLO uses — see Service health for the error budget.""",
      [(f'{PROBE}', "")], w=4, h=5, minv=0, maxv=1, extra=nod, thresholds=[(None, "red"), (1, "green")])
b.add("stat", "App container", "Prometheus scraping the game's own /metrics. 0 = the process is down or unreachable from the observatory.",
      [('up{job="saucerjam"}', "")], w=4, h=5, minv=0, maxv=1, extra=nod, thresholds=[(None, "red"), (1, "green")])
b.add("stat", "Postgres", """`pg_up` from postgres_exporter against the self-hosted Supabase database.
0 = the exporter cannot open a connection: the DB is down, overloaded, or credentials changed.""",
      [("pg_up", "")], w=4, h=5, minv=0, maxv=1, extra=nod, thresholds=[(None, "red"), (1, "green")], no_value="exporter down")
b.add("stat", "Fider API", "1 = the last call to Fider succeeded; 0 = it failed. Feedback depends on it, gameplay does not.",
      [("1 - saucerjam_fider_last_error", "")], w=4, h=5, minv=0, maxv=1, extra=nod, thresholds=[(None, "red"), (1, "green")], no_value="no Fider calls yet")
b.add("stat", "TLS cert expires in", "Days until the Cloudflare-served certificate expires. A leading indicator: 0 means the probe *and* players fail TLS.",
      [('(probe_ssl_earliest_cert_expiry{job="blackbox-http",service="saucerjam"} - time()) / 86400', "")], w=4, h=5, unit="d", extra=nod,
      thresholds=[(None, "red"), (14, "orange"), (30, "green")])
b.add("stat", "Game restarts (24h)", "Process uptime resets in the last day: deploys or crashes. Every restart drops active matches.",
      [("resets(saucerjam_process_uptime_seconds[24h])", "")], w=4, h=5, extra=nod, no_value="0 restarts")
b.add("timeseries", "Dependency availability (1 = healthy)", "The three reachability signals on one axis: public path, app scrape, and Postgres.",
      [(f'{PROBE}', "public (Cloudflare)"), ('up{job="saucerjam"}', "app container"), ("pg_up", "postgres")], w=24, minv=0, maxv=1, unit="short")

b.row("Data plane: self-hosted Supabase Postgres")
b.add("stat", "Connections", "Backends connected to the `postgres` database right now.",
      [('pg_stat_database_numbackends{datname="postgres"}', "")], w=6, h=5, extra={**nod, "options": {**nod["options"], "decimals": 0}},
      thresholds=[(None, "green"), (70, "orange"), (90, "red")])
b.add("stat", "Connection saturation", "Connections as a share of `max_connections` (100). Near 100% new requests queue or fail — a classic DB cliff.",
      [('pg_stat_database_numbackends{datname="postgres"} / pg_settings_max_connections', "")], w=6, h=5, unit="percentunit", maxv=1, extra=nod,
      thresholds=[(None, "green"), (0.7, "orange"), (0.9, "red")])
b.add("stat", "Database size", "Size of the `postgres` database. Growth here is the rankings ledger plus Supabase's own tables.",
      [('pg_database_size_bytes{datname="postgres"}', "")], w=6, h=5, unit="bytes", extra=nod)
b.add("stat", "Cache hit ratio", """Share of block reads served from shared buffers (not disk) in the last 5m.
Below ~95% the working set no longer fits in memory — usually the first sign the DB needs more RAM.""",
      [('sum(rate(pg_stat_database_blks_hit{datname="postgres"}[5m])) / clamp_min(sum(rate(pg_stat_database_blks_hit{datname="postgres"}[5m])) + sum(rate(pg_stat_database_blks_read{datname="postgres"}[5m])), 0.000001)', "")],
      w=6, h=5, unit="percentunit", maxv=1, extra=nod, thresholds=[(None, "red"), (0.95, "orange"), (0.99, "green")])
b.add("stat", "Rollbacks (24h)", "Transactions rolled back. A steady stream is normal; a spike means errors or contention.",
      [('increase(pg_stat_database_xact_rollback{datname="postgres"}[24h]) or vector(0)', "")], w=6, h=5, extra=nod, no_value="0 rollbacks")
b.add("stat", "Deadlocks (24h)", "Deadlocks detected. Anything above zero is worth a look — it means two writers blocked each other.",
      [('increase(pg_stat_database_deadlocks{datname="postgres"}[24h]) or vector(0)', "")], w=6, h=5, extra=nod,
      thresholds=[(None, "green"), (1, "red")], no_value="0 deadlocks")
b.add("stat", "Rounds failing to persist (24h)", """The app's own view of the DB: rounds that could not be saved to Supabase.
Silent to players in the moment, painful later — this is a *correctness* metric, not just a reliability one.""",
      [("sum(increase(saucerjam_ranking_save_errors_total[24h])) or vector(0)", "")], w=6, h=5, extra=nod, no_value="0 failures")
b.add("stat", "DB container memory", "Resident memory of the Postgres container (cAdvisor). The largest single tenant on the free VM.",
      [(f'container_memory_working_set_bytes{{{DB}}}', "")], w=6, h=5, unit="bytes", extra=nod)
b.add("timeseries", "Connections over time", "Connection count over time. A staircase up without more players usually means a connection leak.",
      [('pg_stat_database_numbackends{datname="postgres"}', "connections"), ("pg_settings_max_connections", "max")], w=12)
b.add("timeseries", "Transactions per minute (commit vs rollback)", "Write load on the rankings ledger. Rollbacks climbing while commits are flat = the app is retrying failures.",
      [('sum(rate(pg_stat_database_xact_commit{datname="postgres"}[5m])) * 60', "commits"), ("sum(rate(pg_stat_database_xact_rollback{datname=\"postgres\"}[5m])) * 60", "rollbacks")], w=12)
b.add("timeseries", "DB container CPU (cores)", "CPU used by the Postgres container. Spikes during heavy write bursts are expected; a sustained rise is not.",
      [(f'rate(container_cpu_usage_seconds_total{{{DB}}}[5m])', "cpu")], w=24, unit="short")

b.row("Host capacity & saturation (free-arm-01: 2 cores / 12 GB / 200 GB)")
b.add("gauge", "CPU busy", "Share of the 2 free ARM cores in use (5-min average).",
      [('1 - avg(rate(node_cpu_seconds_total{job="oci-node",mode="idle"}[5m]))', "")], w=6, h=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.7, "orange"), (0.9, "red")])
b.add("gauge", "Memory used", "Share of the 12 GB free VM in use, across every tenant.",
      [('1 - node_memory_MemAvailable_bytes{job="oci-node"} / node_memory_MemTotal_bytes{job="oci-node"}', "")], w=6, h=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.8, "orange"), (0.9, "red")])
b.add("gauge", "Disk used", "Share of the 200 GB free block storage in use.",
      [('1 - node_filesystem_avail_bytes{job="oci-node",mountpoint="/"} / node_filesystem_size_bytes{job="oci-node",mountpoint="/"}', "")], w=6, h=6, unit="percentunit", minv=0, maxv=1,
      thresholds=[(None, "green"), (0.8, "orange"), (0.9, "red")])
b.add("gauge", "Load1 vs 2 cores", "1-minute load average against the core count. Above 2 = work is queuing and game ticks will be late (players feel lag).",
      [("saucerjam_system_load1", "")], w=6, h=6, maxv=4,
      thresholds=[(None, "green"), (2, "orange"), (3, "red")])
b.add("timeseries", "Host CPU & memory over time", "Both saturation signals on one axis; watch for a slow climb that tracks container growth rather than players.",
      [('1 - avg(rate(node_cpu_seconds_total{job="oci-node",mode="idle"}[5m]))', "cpu busy"),
       ('1 - node_memory_MemAvailable_bytes{job="oci-node"} / node_memory_MemTotal_bytes{job="oci-node"}', "memory used")], w=12, unit="percentunit", maxv=1)
b.add("timeseries", "Top containers by memory", "The noisiest neighbours on the shared box. If a tenant crowds out the game, this is where it shows.",
      [('topk(6, container_memory_working_set_bytes{name=~".+"})', "{{name}}")], w=12, unit="bytes")
b.add("timeseries", "Load1 (game-reported vs host)", "Two views of the same load. They should match; a gap means the observatory is measuring a different moment.",
      [("saucerjam_system_load1", "load1 (game)"), ('node_load1{job="oci-node"}', "load1 (host)"), ("2", "cores")], w=24)

b.row("Game capacity")
b.add("gauge", "Arenas in use (of 8)", "Rooms open / MAX_ROOMS. At 100% new joins get `rooms_full`. This limit is hit long before CPU or memory.",
      [("saucerjam_rooms / 8", "")], w=6, h=6, unit="percentunit", minv=0, maxv=1, thresholds=[(None, "green"), (0.75, "orange"), (1, "red")])
b.add("gauge", "Pilots per arena", "Average humans per room. The server simulates all players, so this drives CPU.",
      [("saucerjam_players / clamp_min(saucerjam_rooms, 1)", "")], w=6, h=6, maxv=32,
      thresholds=[(None, "green"), (24, "orange"), (32, "red")])
b.add("stat", "Connections/s", "New websocket connections per second — the demand at the door.",
      [("sum(rate(saucerjam_connections_total[5m]))", "")], w=6, h=6, unit="reqps", extra=nod)
b.add("stat", "Pilots online now", "Human players connected right now (bots are added to fill rooms and are not counted here).",
      [("saucerjam_players", "")], w=6, h=6, extra=nod)
b.add("timeseries", "Joins / leaves per minute", """Demand and churn. Leaves split by cause: **client** = the player chose to leave (normal); **transport** = the connection dropped (network, deploy restart, or crash).
Many transport leaves at once = everyone got kicked — check the restarts panel.""",
      [("sum(rate(saucerjam_joins_total[5m])) * 60", "joins"), ('sum by (cause) (rate(saucerjam_leaves_total[5m])) * 60', "leaves: {{cause}}")], w=12)
b.add("timeseries", "Server errors (5xx) by route", "Failures **we** caused. Feeds the request SLO on Service health; here it is the *cause* view next to capacity.",
      [(f'sum by (route) (rate(saucerjam_http_requests_total{{status=~"5..",{U}}}[5m]))', "{{route}}")], w=12, unit="reqps", no_value="0 server errors")

b.row("Change & error correlation")
b.add("stat", "Game restarts (24h)", "Uptime resets in the last day. Each one ends active matches — correlate with any error spike.",
      [("resets(saucerjam_process_uptime_seconds[24h])", "")], w=8, h=5, extra=nod, no_value="0 restarts")
b.add("stat", "Public path scrape time", "How long the outside-in probe takes end to end. A jump with no code change usually means the network or Cloudflare.",
      [('scrape_duration_seconds{job="saucerjam"}', "")], w=8, h=5, unit="s", extra=nod)
b.add("stat", "5xx in 24h", "Total server errors we caused, across all routes.",
      [(f'sum(increase(saucerjam_http_requests_total{{status=~"5..",{U}}}[24h])) or vector(0)', "")], w=8, h=5, extra=nod, no_value="0 server errors")
b.add("timeseries", "Process uptime (drops = deploy or restart)", "A sawtooth here is a deploy; a sudden drop mid-run is a crash. Line it up with the 5xx panel to separate the two.",
      [("saucerjam_process_uptime_seconds", "uptime (s)")], w=24, unit="s")

platform = b.dump("saucerjam-platform", "SaucerJam: Platform & dependencies",
                  "Principal view of SaucerJam: dependencies, the self-hosted Postgres data plane, host and game capacity, and change correlation.",
                  ["saucerjam", "platform", "principal", "official"], LINKS)

for name, d in (("saucerjam-health", health), ("saucerjam-product", product), ("saucerjam-platform", platform)):
    json.dump(d, open(f"{OUT}/{name}.json", "w"), indent=2)
print("ok")
