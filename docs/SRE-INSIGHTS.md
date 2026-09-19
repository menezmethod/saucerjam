# Behavioural insights: detecting struggle before it is reported

`server/insights.js` + `POST /api/insights` collect **friction signals** so the
automation loop can see players struggling and fix it proactively, rather than
waiting for a Fider report. Everything is aggregate: allow-listed event names,
coarse `device`/`platform` buckets, no identifiers, no free text, no history.

## Signals and what they mean

| Event | Meaning | Loop response |
| --- | --- | --- |
| `stuck_no_input` | Joined but sent no movement/fire for 10s | Onboarding or control-binding problem |
| `no_aim_fire` | Fired without ever moving aim | Touch aim not discoverable |
| `died_without_kill` | Died before landing a single hit | Difficulty spike / spawn danger |
| `controls_struggle` | Died again within 3s of respawn | Spawn camping or control confusion |
| `menu_opened_repeatedly` | Opened the Flight menu 3+ times in a session | Player is lost; feature unclear |
| `touch_guide_dismissed` | Dismissed the first-run guide | Compare against `stuck_no_input` |
| `help_opened` / `report_opened` | Sought help / filed feedback | Support load |

Each is also emitted as `insight_friction_ratio{signal="…_per_session"}` — the
share of sessions that hit the signal (clamped to 1). **A rising ratio is the
alert-worthy signal**, not an absolute count.

## What the loop does with them

1. Watch `insight_friction_ratio` on the Grafana dashboard.
2. If one signal crosses a threshold (e.g. `stuck_no_input` > 0.15 and rising),
   open an investigation: reproduce on that `device` bucket, check the relevant
   runbook, and either fix it or open a PR.
3. Re-measure after the change — the metric is the acceptance test.
4. If a signal persists without a code cause, it becomes a design question for a
   human, not an automated change.

Suggested first thresholds (tune with real data, do not treat as truth):

```yaml
- alert: SaucerJamPlayersStuck
  expr: insight_friction_ratio{signal="stuck_no_input_per_session"} > 0.15
  for: 30m
  labels: { severity: warning, service: saucerjam }
  annotations:
    summary: "New pilots are joining but not playing"
    runbook_url: ".../docs/SRE.md"
```

## Privacy guardrails

- `EVENT_ALLOW` is an allow-list; anything else is dropped server-side.
- No IP, token, name, or precise data is attached; the ingest is rate-limited and
  bounded. Device/platform are two fixed buckets.
- The data informs product decisions; it is never sold or joined to identity.
```
