# The self-healing, self-improving loop

This is the operating loop that keeps SaucerJam improving after launch with
minimal human input. It reuses Hermes (`hermes` CLI), the existing Coolify
deploys, the Prometheus/Grafana stack on Pi5, and the Fider community portal.
It is constrained on purpose: **the AI may run the game, observe it, diagnose
it, and open proposals — it may not ship to production without a human.**

## The invariant

```
Observe  →  Diagnose  →  Propose  →  Human/community gate  →  Deploy (human)
(metrics)   (Hermes)     (PR/branch)  (review + vote)          (Coolify)
```

Every cycle is observable (`saucerjam_community_actions_total`,
`saucerjam_rounds_completed_total`, Grafana alerts) and every automated change
is reversible (it lives on a branch or PR, never directly on `main`).

## Cadences

| Loop | Trigger | Owner | Allowed to do |
| --- | --- | --- | --- |
| SRE heartbeat | cron `/15 * * * *` | Hermes (`saucerjam-sre`) | Check health/metrics/alerts; restart app or proxy on Pi5; re-run live smoke; escalate |
| Community heartbeat | cron `/30 * * * *` | Hermes (`saucerjam-community`) | Read Fider queue; open fix/prototype PR; comment; escalate balance |
| Release gate | human or maintainer approval | Human | Merge PR, deploy, tag |
| Product review | weekly | Human + Hermes summary | Read the Grafana dashboard + retention gauge; pick the next roadmap item |

## What the loop optimizes

Metrics now exist for all of these, so decisions are evidence-based:

- **Availability** — `up{job="saucerjam"}`, `SaucerJamDown`.
- **Stability** — `saucerjam_ranking_save_errors_total`, `saucerjam_process_resident_memory_bytes`.
- **Capacity** — `saucerjam_rooms`, `saucerjam_players`, `saucerjam_capacity_ratio`, join-failure reasons.
- **Fun/retention** — `saucerjam_rounds_completed_total`, `saucerjam_game_events_total{type="kill"}`, `saucerjam_distinct_pilots_7d`, `saucerjam_ws_round_trip_seconds`.
- **Community pull** — `saucerjam_community_ingest_total`, `saucerjam_community_actions_total`.

## Cycle instructions (the agent's loop)

1. **Observe.** Read `/health`, `/metrics`, and the firing alerts.
2. **Detect.** Is anything outside its expected band (down, degraded, saturated,
   memory climbing, join failures spiking, retention flat week over week)?
3. **Diagnose.** Use the `/metrics` labels + `docs/SRE.md` runbooks. Reproduce
   with `scripts/verification/live.cjs` or a local build.
4. **Repair (bounded).** Only the self-heal actions in `docs/SRE.md` §4. If it
   needs code, go to step 5.
5. **Propose.** Open a PR (bug → fix PR; feature → prototype branch + preview).
   Run `npm test`, `npm run test:browser`, and `node scripts/verification/ux-audit.cjs`.
   Attach evidence. Never merge.
6. **Record.** Post the outcome to Telegram only if judgment is needed; update
   `docs/STATUS.json` with the checkpoint (baseline → active → next action).
7. **Stop cleanly.** If usage/time is low, leave a checkpoint and exit. The loop
   resumes from STATUS, not from conversation memory.

## Guardrails (non-negotiable)

- No auto-merge, no force-push, no production env edits, no DNS/TLS changes.
- Self-heal is a bounded restart only — **never a deploy**; never `docker rm -f`,
  never delete volumes.
- Balance, monetization, and roadmap changes are **human decisions** — the AI
  drafts a proposal, not a shipped change.
- Every automated action counts toward `saucerjam_community_actions_total` and is
  visible in Grafana.

## Bootstrap checklist (once, at launch)

See `docs/AUTOMATION.md` §Setup for the Fider webhook + `COMMUNITY_ACTION_TOKEN`.
Install the two Hermes subscriptions from `deploy/hermes/subscriptions.json`:

```bash
hermes webhook list
# add saucerjam-community (cron */30) and saucerjam-sre (cron */15) from the JSON,
# setting SAUCERJAM_URL and COMMUNITY_ACTION_TOKEN in the Hermes environment.
```

Then verify each loop once by hand (`/api/community/queue`, a test alert) before
trusting it unattended.

## Honest boundaries

- The relay and dashboard are staged; Grafana alert **routing to Hermes** requires
  running `deploy/monitoring/grafana-hermes-relay.py` on a host that can reach the
  Mac's Hermes gateway (Tailscale `100.82.231.99:8644`).
- Community acceptance and any public promotion are human-triggered.
- Hardware-level performance (battery/thermal) is not measurable from CI; treat
  it as a launch-week manual pass.
