# Community-driven automation (Fider → AI → release)

Goal: a self-healing, self-improving loop where community reports turn into
reviewed changes without a human writing the first draft, **and without the AI
ever shipping unreviewed code.**

## Architecture

```
Player reports in-game ──► POST /api/community/report ──► Fider post
                                                            │
Fider webhook (post created / status change) ───────────────┘
      │  Bearer token (FIDER_WEBHOOK_TOKEN) or HMAC sha256 (FIDER_WEBHOOK_SECRET)
      ▼
POST /api/community/webhook            (express.raw, credential verified)
      │
      ▼
CommunityQueue.ingest()                deterministic triage → proposal
      │  fix-pr | prototype-pr | matchmaking-proposal | discuss
      ▼
GET /api/community/queue               (x-community-token)   ← Hermes reads
      │
      ▼
Hermes agent                            drafts a change, opens branch/PR
      │
POST /api/community/action             (allow-list: open-fix-pr, open-prototype-pr,
      │                                  comment, flag-duplicate, request-info)
      ▼
Gates (docs/RELEASE-LOOP.md + PR checks) ──► maintainer/community acceptance
      │
      ▼
Merge to main (human-triggered only) ──► Coolify deploy ──► /metrics reflects it
```

## Gates — nothing skips these

A community request becomes exactly one of four proposals, chosen
deterministically by `propose()` in `server/community.js`:

| Proposal | Trigger | What AI may do |
| --- | --- | --- |
| `fix-pr` | `[bug]` or crash/broken/regression wording | Open a fix PR against `main`; run `npm test`, `test:browser`, `ux-audit`; attach evidence |
| `prototype-pr` | `[feature]`/`[idea]` | Open a **prototype** branch + Coolify PR preview; do **not** target `main` |
| `matchmaking-proposal` | `[balance]` damage/energy/speed | Draft a proposal doc; escalate — balance changes are human decisions |
| `discuss` | `[question]` | Answer; no code change |

Hard rules enforced in code and process:

1. **Allow-list only.** `POST /api/community/action` rejects anything outside the
   five safe actions; there is no "merge" or "close" action.
2. **No auto-merge.** Merging `main` is always a human action (or an explicit
   maintainer approval on the PR).
3. **Feature ≠ shipped feature.** Feature requests produce a *preview* the
   community can try and vote on, not a silent release.
4. **Unknown origin is rejected.** No webhook acts without a valid credential:
   an HMAC signature (`FIDER_WEBHOOK_SECRET`) or the shared bearer token
   (`FIDER_WEBHOOK_TOKEN`). Either one alone opens the gate; both are compared in
   constant time and never logged or echoed.
5. **Rate/abuse limited.** `/api` is rate-limited and the queue is bounded to 500
   items. The webhook route is the one deliberate exception: Fider permanently
   disables a webhook on the first non-2xx it sees and never retries, so a 429
   there would silently drop every future report. It is registered ahead of the
   `/api` limiter and metered separately, and an over-limit delivery is dropped
   with a counted `202` rather than a `429`.
6. **No automatic deploy.** The loop never calls a deploy endpoint; production
   releases are human-triggered. The binding rules — lifecycle, invariant,
   idempotency keys, retries, and forbidden actions — live in
   `docs/COMMUNITY-LOOP-CONTRACT.md`, which this document defers to.

## Hermes agent contract

Hermes polls the queue (cron/heartbeat) and handles each item:

```
GET  <game>/api/community/queue?status=new          header: x-community-token
POST <game>/api/community/action                    header: x-community-token
     { "id": "<post id>", "action": "open-fix-pr", "detail": "<PR url>" }
```

It reports to Telegram only when judgment is needed (see Hermes `AGENTS.md`:
"handle routine work silently; escalate only when judgment matters"). Expected
behaviour per proposal is in `deploy/hermes/saucerjam-community-triage.md`.

## Setup checklist (one-time)

1. **Fider webhook** — Admin → Site Settings → Webhooks → Add New:
   - Type: *Post Created* (add *Post Status Changed* as a second webhook).
   - URL: `https://qd.menezmethod.com/api/community/webhook`
   - Method: `POST`, header `Content-Type: application/json`, plus
     `Authorization: Bearer <FIDER_WEBHOOK_TOKEN>`.
   - Content must use `quote` on every free-text field (Fider security note):
     ```json
     {
       "post_id": {{ .post_id }},
       "post_number": {{ .post_number }},
       "post_title": {{ quote .post_title }},
       "post_description": {{ quote .post_description }},
       "post_url": {{ quote .post_url }},
       "post_votes": {{ .post_votes }}
     }
     ```
   - Set `FIDER_WEBHOOK_TOKEN` in Coolify and send it as
     `Authorization: Bearer <token>` (or `x-fider-token`). **Fider cannot
     HMAC-sign** — it only emits `X-Fider-UserID` — so the bearer token is the
     supported route. `FIDER_WEBHOOK_SECRET` remains available for any sender
     that can produce a `sha256` HMAC of the raw body. Configure at least one;
     with neither set the endpoint returns 503.
2. **Action token** — generate a long random `COMMUNITY_ACTION_TOKEN` in Coolify;
   store the same value in the Hermes secret source, never in git.
3. **Hermes** — install `deploy/hermes/saucerjam-community-triage.md` as a skill
   and add the heartbeat subscription (see §below).
4. **Verify** — `node --test tests/automation.test.js`.

## Hermes subscriptions (installed alongside this repo)

- `grafana-alerts` (existing) → receives SaucerJam SRE alerts from Grafana.
- `saucerjam-community` (added) → a cron heartbeat that polls the community queue
  and acts. It reuses the same guardrails as `fleet-pr-automation`: report-first,
  no merges, `[SILENT]` when there is nothing to do.

## Why this is safe to run unattended

- Every automated change lands on a branch or PR, never on `main`.
- Every action is allow-listed in code and unit-tested
  (`tests/automation.test.js`).
- The AI's worst case is opening a PR — which a human can close.
- All actions are counted (`saucerjam_community_actions_total`) and visible on the
  Grafana dashboard, so runaway automation is observable.
