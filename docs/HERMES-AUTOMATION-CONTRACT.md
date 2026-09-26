# Hermes automation contract (SaucerJam)

Purpose: make this game's automations **executable by the Hermes agent**, not just
documented. Prose in `docs/SRE.md` / `docs/AUTOMATION.md` is for humans; the files
below are for the agent.

Written by Hermes (CEO Mac) on 2026-09-19 after auditing the live fleet. Treat the
"State as measured" section as fact, not as a guess.

## Hard constraints (never break)

1. Never deploy the Coolify production app. Never POST `/api/v1/deploy` for the app
   uuid below. A previous run did this by mistake.
2. Never merge to `main`, never `git push --force`, never edit production env vars,
   never touch DNS/TLS, never `docker rm -f`.
3. Work on branch `chore/hermes-automation-contract`, push it, open a PR against
   `release/1.4.0`. PR only — no merge.
4. Do not create or use a `qd7.menezmethod.com` preview. It does not exist.

## State as measured (2026-09-19 ~12:10 EDT)

| Fact | Value |
| --- | --- |
| Production | `https://saucerjam.com` — `/health` 200, `/metrics` **404**, `/api/community/queue` **404** → prod is pre-1.4 |
| Coolify apps | exactly one SaucerJam app: uuid `aoeefnsohotlncnvmpgwmaao`, fqdn `https://saucerjam.com`, branch `main`. **No preview app exists.** |
| Coolify creds | `~/.config/menez/coolify.env` (vars: `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_APP_SAUCERJAM`) |
| Prometheus on Pi5 | `prometheus-prometheus-1`, rules **now load** — 8 alerts / 3 groups verified via `promtool`. Fixed by bind-mounting the rules file. |
| Prometheus scrape | target `saucerjam` = `down`, `server returned HTTP status 404` (because `/metrics` is not deployed) |
| Grafana | `prometheus-grafana-1` running on Pi5 |
| Grafana → Hermes relay | code exists at `/home/menez/grafana-hermes-relay/` (`.env` present) but **no process is running**, nothing listens on `:8787`, no systemd unit, no `GET /health`, and `deploy/monitoring/grafana-alerts-contact-point.md` (referenced by the rules file) does not exist |
| Hermes side | cron jobs `saucerjam-sre`, `saucerjam-community` are **not installed**; `COMMUNITY_ACTION_TOKEN` unset; git gateway `POST /webhooks/grafana-alerts` exists on the Mac at `100.82.231.99:8644` |
| `SaucerJamPlayersStuck` | exists only as a snippet in `docs/SRE-INSIGHTS.md`; **not** in `deploy/monitoring/saucerjam.rules.yml` (which has 8 alerts) |

## Deliverables

### D1 — `deploy/hermes/automation.json`
One object per heartbeat, machine-readable, no prose:

```json
{
  "saucerjam-sre": {
    "kind": "cron", "schedule": "*/15 * * * *",
    "entrypoint": "scripts/ops/saucerjam-sre.sh check",
    "heal_command": "scripts/ops/saucerjam-sre.sh heal",
    "deliver": "telegram",
    "skills": ["coolify-deploys"],
    "enabled_toolsets": ["terminal", "file"],
    "workdir": "<repo root>",
    "model": "deepseek-v4.1-flash", "provider": "opencode-go",
    "timeout_s": 60,
    "required_env": ["COOLIFY_TOKEN", "COOLIFY_URL"],
    "silent_when": "exit 0 and empty stdout"
  },
  "saucerjam-community": { "...": "same shape, */30, requires COMMUNITY_ACTION_TOKEN" }
}
```

### D2 — `deploy/hermes/authority.json`
One row per alert name in `deploy/monitoring/saucerjam.rules.yml`
(`SaucerJamDown`, `SaucerJamHealthDegraded`, `SaucerJamRoomsSaturated`,
`SaucerJamJoinFailureSpike`, `SaucerJamManyHumansPerRoom`, `SaucerJamMemoryHigh`,
`SaucerJamRankingSaveErrors`, `SaucerJamRateLimitStorm`):

```json
{ "SaucerJamDown": {
    "allowed_autonomously": true,
    "command": "<exact command the agent runs>",
    "escalate_when": "two restarts fail",
    "runbook_anchor": "docs/SRE.md#runbook-saucerjamdown" } }
```

### D3 — `scripts/ops/saucerjam-sre.sh`, `scripts/ops/saucerjam-community.sh`
Shell wrappers (Hermes runs non-`.sh` cron scripts with Python — the Node body must
live behind a `.sh`). Contract:

- `check` subcommand: read-only, safe to run at any time.
- `heal` subcommand: only actions marked `allowed_autonomously` in D2; idempotent;
  at most one retry with a short backoff; appends to `logs/ops/<name>.log`.
- exit 0 + **empty stdout** = healthy → Hermes stays silent.
- exit 0 + stdout = an event → delivered verbatim.
- non-zero exit = alert, regardless of stdout.
- flags: `--json`, `--dry-run`. Hard internal timeout < 60s, elapsed time to stderr.
- state file `logs/ops/<name>.state.json` so a standing condition reports once, then
  stays quiet until it clears or the cooldown expires (declare the cooldown).
- missing `required_env` → print exactly one line naming the variable, exit non-zero.
  Never a silent no-op.

### D4 — `scripts/ops/contract-check.cjs`
Asserts, against a URL argument (default `https://saucerjam.com`):
`/health` 200 · `/metrics` contains `saucerjam_rooms` · `/api/community/queue` 200 with
the token. One line per check, non-zero exit on failure. Must work against a local
server too (`npm run serve`), so it is useful before prod is live.

### D5 — `npm run ops:selftest`
Proves the silence contract: healthy fixture → exit 0 and **empty** stdout; broken
fixture → non-zero with a message; identical repeated condition → silent.

### D6 — `deploy/hermes/provision.sh`
Prints set/missing for `COOLIFY_URL`, `COOLIFY_TOKEN`, `COMMUNITY_ACTION_TOKEN`,
`GRAFANA_RELAY_TOKEN`, `HERMES_WEBHOOK_SECRET`. Never prints values. Documents
`~/.config/menez/coolify.env` as the Coolify source. Non-zero exit when something
required is missing.

### D7 — Close the alert path
- systemd unit on Pi5 running `deploy/monitoring/grafana-hermes-relay.py` with
  `Restart=always` and its env file (token, `HERMES_WEBHOOK_URL=http://100.82.231.99:8644/webhooks/grafana-alerts`,
  `HERMES_WEBHOOK_SECRET`).
- Add `GET /health` to the relay returning `{ok, uptime, hermes_reachable}` so it can be watchdogs.
- Write the missing `deploy/monitoring/grafana-alerts-contact-point.md` with the exact
  Grafana contact-point settings.
- Verify with `curl -s localhost:8787/health` on Pi5 and one real alert round-trip.

### D8 — Insights rule
Move `SaucerJamPlayersStuck` from `docs/SRE-INSIGHTS.md` into
`deploy/monitoring/saucerjam.rules.yml`, reload Prometheus the same way the mount bug
was fixed, and confirm the rule count.

## Sync protocol (how Hermes follows your work)

Append one JSON object per line to `docs/loop/HERMES_SYNC.jsonl`, flushed as you go —
not at the end:

```json
{"ts":"2026-09-19T16:20:00Z","deliverable":"D3","status":"in_progress|done|blocked",
 "artifact":"scripts/ops/saucerjam-sre.sh","evidence":"<command run + key result>",
 "blocker":""}
```

Hermes polls this file and reports to the user, so a line per deliverable transition
beats a long final essay. Write files **before** printing a summary.

## Definition of done

1. All of D1–D8 present, committed on `chore/hermes-automation-contract`, pushed, PR
   open against `release/1.4.0`.
2. `npm run ops:selftest` passes — paste raw output.
3. `node scripts/ops/contract-check.cjs http://127.0.0.1:<port>` passes against a local
   `npm run serve` — paste raw output.
4. `node scripts/ops/contract-check.cjs https://saucerjam.com` is allowed to
   FAIL (prod is pre-1.4). Report its real output as-is; do not "fix" prod.
5. `docs/loop/HERMES_SYNC.jsonl` has a closing line with `status: done`.

## Anti-goals

- No production deploy, no Coolify deploy of the app uuid, no preview-domain guessing.
- No new secrets committed; no values printed.
- No refactor of game code — this is ops/automation surface only.
- No "everything is green" summaries that contradict the raw output above.
