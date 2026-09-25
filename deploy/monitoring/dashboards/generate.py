#!/usr/bin/env python3
"""Generate the official SaucerJam Grafana dashboards.

Usage:
    python3 deploy/monitoring/dashboards/generate.py deploy/monitoring/dashboards

Writes ``saucerjam-health.json`` (SLOs + the four golden signals) and
``saucerjam-players.json`` (product/engagement). The JSON is committed and
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
    {"title": "Service health (SLOs)", "type": "link", "url": "/d/saucerjam-health"},
    {"title": "Players & game", "type": "link", "url": "/d/saucerjam-players"},
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

**Low-traffic caveat:** SaucerJam has only a handful of players, so request-based numbers are noisy or empty ("no players in window" is normal). That's why the headline availability uses a **synthetic probe**: Prometheus fetches `qd.menezmethod.com/metrics` through Cloudflare every 15s, like a robot player. The SRE workbook recommends this for low-traffic services.
Sources: [SRE book: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) · [Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/) · [Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) · [Google Cloud SRE blog](https://cloud.google.com/blog/products/devops-sre) · [SRE Weekly](https://sreweekly.com/)""", h=10)

b.row("SLOs: are players OK? (30-day window)")
b.add("stat", "Availability (probe), 30d", f"""**SLI:** share of 15s probes (Prometheus scraping the public URL through Cloudflare) that succeeded.
**SLO: {SLO_AVAIL:.1%}**, about 3.6 hours of allowed downtime per month.
**Why 99.5% and not 99.99%?** One free VM, no redundancy, one developer. Google's advice: set the target to what users need and what you can afford, not "as high as possible". Each extra nine costs about 10x more work.
**Why a probe?** Too few players for request-based numbers to mean anything (see the workbook's advice for low-traffic services).
Note: this job was added to Oracle Prometheus on 2026-09-25, so "30d" covers less history until late October.""",
      [(f'avg_over_time(up{{job="saucerjam"}}[30d])', "")], w=6, h=5, unit="percentunit",
      thresholds=[(None, "red"), (SLO_AVAIL, "green")], extra={"options": {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "background", "graphMode": "none", "decimals": 3}})
b.add("stat", "Error budget left, 30d", f"""**Error budget** = 100% minus SLO = {1-SLO_AVAIL:.1%} of the month we're allowed to be down.
This panel shows how much of that allowance is left. 100% = untouched, 0% = spent.
**How to use it (Google's error-budget policy):** budget left → take risks, ship features, deploy on Fridays. Budget spent → freeze risky changes and fix reliability. It turns "is it reliable enough?" from an argument into a number.""",
      [(f'1 - (1 - avg_over_time(up{{job="saucerjam"}}[30d])) / {1-SLO_AVAIL}', "")], w=6, h=5, unit="percentunit",
      thresholds=[(None, "red"), (0.25, "orange"), (0.5, "green")], minv=0)
b.add("stat", "Burn rate, 1h", f"""**Burn rate** = how fast we're spending the error budget. 1 = exactly on pace to use it all in 30 days. 14.4 = the whole month's budget gone in about 2 days.
Google's **multi-window, multi-burn-rate** alerting pages a human when the 1h burn rate is above **14.4** (2% of the monthly budget in one hour) *and* the 5m burn rate confirms it's still happening.
We don't page on this yet (too little traffic, see docs/SRE.md), but this is the number a mature setup would page on.""",
      [(f'(1 - avg_over_time(up{{job="saucerjam"}}[1h])) / {1-SLO_AVAIL}', "")], w=6, h=5, unit="x",
      thresholds=[(None, "green"), (6, "orange"), (14.4, "red")])
b.add("stat", "Burn rate, 6h", """Same idea over 6 hours. The workbook's second paging tier: burn rate above **6** over 6h (5% of the monthly budget) means a slower but real problem.
Two windows catch both kinds of failure: sudden outages (1h) and slow leaks (6h).""",
      [(f'(1 - avg_over_time(up{{job="saucerjam"}}[6h])) / {1-SLO_AVAIL}', "")], w=6, h=5, unit="x",
      thresholds=[(None, "green"), (1, "orange"), (6, "red")])

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

b.add("timeseries", "Availability (probe), hourly vs SLO", """Hourly probe success rate. Any dip below the dashed line is budget being spent.
Look for **patterns**: dips at the same time every day usually mean a cron job, backup or deploy.""",
      [('avg_over_time(up{job="saucerjam"}[1h])', "availability"), (str(SLO_AVAIL), "SLO target")], w=24, h=7, unit="percentunit", maxv=1,
      extra={"fieldConfig": {"defaults": {"unit": "percentunit", "max": 1}, "overrides": [ratio_line(SLO_AVAIL)]}})

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

# ---------------------------------------------------------------- Players & game
b = Board()
b.text("""### Players & game: product health, not reliability
These are **business/product metrics**: are people playing, coming back, struggling?
Google keeps these **separate from SLOs** on purpose: a quiet Tuesday isn't an outage, and you should never get paged because fewer people played.
Use this board to decide **what to build next**. Use the Service health board to decide **what to fix now**.""", h=4)
b.row("Engagement: are people playing and coming back?")
b.add("stat", "Distinct pilots (7d)", """Unique players (hashed tokens, no personal data) seen in the last 7 days.
The best single "is this game alive?" number. It's the retention signal the Start Here checklist asks about: do people come back next week?""",
      [("saucerjam_distinct_pilots_7d", "")], w=6, h=5)
b.add("stat", "Pilots online now", "Human players connected right now.", [("saucerjam_players", "")], w=6, h=5)
b.add("stat", "Rounds finished (24h)", """Matches played to the end. Joins without finished rounds = people bail mid-match. Worth asking why in feedback.""",
      [("sum(increase(saucerjam_rounds_completed_total[24h])) or vector(0)", "")], w=6, h=5)
b.add("stat", "Chat lines (24h)", "Social signal: players talking to each other is an early sign of community.",
      [("sum(increase(saucerjam_chat_messages_total[24h])) or vector(0)", "")], w=6, h=5)
b.add("timeseries", "Rounds finished by map", "Which maps get played to the end. A map nobody finishes is a candidate for a redesign.",
      [("sum by (map) (increase(saucerjam_rounds_completed_total[1h]))", "{{map}}")], w=12)
b.add("timeseries", "Game events by type (per min)", """What happens inside matches: fire, hit, kill, portal use, pickups.
Ratios tell a design story: hits/fire = accuracy (too low = aiming is frustrating), kills/hit = how tanky players are.""",
      [("sum by (type) (rate(saucerjam_game_events_total[5m])) * 60", "{{type}}")], w=12)
b.row("Player experience: where do they struggle?")
b.add("timeseries", "Starts vs feedback opened (per min)", """Practice vs online starts, and how often players open the report form.
Reports rising faster than starts = something new is annoying people (often right after a deploy).""",
      [('sum(rate(insight_events_total{event="practice_start"}[10m]))*60', "practice starts"),
       ('sum(rate(insight_events_total{event="online_start"}[10m]))*60', "online starts"),
       ('sum(rate(insight_events_total{event="report_opened"}[10m]))*60', "reports opened")], w=12)
b.add("timeseries", "Friction signals (share of sessions)", """Behaviour hints that a player is confused, computed per session:
- `stuck_no_input`: sat there not pressing anything
- `died_without_kill`: never scored
- `no_aim_fire`: firing without aiming
- `menu_repeat`: bouncing around menus
These are UX smoke alarms, not errors.""",
      [("insight_friction_ratio", "{{signal}}")], w=12, unit="percentunit")
b.add("timeseries", "Struggle by device", "Same friction signals split by device. If touch struggles far more than desktop, the mobile controls need work.",
      [('sum by (device) (rate(insight_events_total{event=~"died_without_kill|stuck_no_input|controls_struggle"}[15m]))', "{{device}}")], w=12)
b.add("timeseries", "Most-used actions (per hour)", "What players actually click. Features nobody uses are candidates to cut.",
      [("sum by (event) (increase(insight_events_total[1h]))", "{{event}}")], w=12)
b.row("Community → AI loop (Fider feedback pipeline)")
b.add("timeseries", "Feedback ingested by kind", "Fider posts accepted into the AI queue (bug / idea). This is the input side of the automation loop.",
      [("sum by (kind) (increase(saucerjam_community_ingest_total[1h]))", "{{kind}}")], w=8)
b.add("timeseries", "AI actions recorded", "What the automation did with feedback (triage, PR opened, and so on). Ingest without actions = the loop is stuck.",
      [("sum by (action) (increase(saucerjam_community_actions_total[1h]))", "{{action}}")], w=8)
b.add("timeseries", "Webhooks rejected / Fider errors", """Rejected Fider webhooks by reason (bad signature, rate limit), plus `fider_last_error` = 1 when the last call to Fider failed.
Rejections from unknown sources are expected (the endpoint is public). A bad-signature rejection from Fider itself means the shared secret drifted.""",
      [("sum by (reason) (increase(saucerjam_community_webhook_rejected_total[1h]))", "rejected: {{reason}}"), ("saucerjam_fider_last_error", "fider last call failed")], w=8)

players = b.dump("saucerjam-players", "SaucerJam: Players & game",
                 "Official SaucerJam product dashboard: engagement, player friction, and the community to AI loop.",
                 ["saucerjam", "product", "official"], LINKS)

for name, d in (("saucerjam-health", health), ("saucerjam-players", players)):
    json.dump(d, open(f"{OUT}/{name}.json", "w"), indent=2)
print("ok")
