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
Durable CommunityQueue.ingest()        deterministic triage → proposal
      │  fix-pr | prototype-pr | matchmaking-proposal | discuss
      │  journal on mounted storage: attempts, leases, receipts
      ▼
POST /api/community/claim              (x-community-token)   ← Hermes leases one item
      │  { item: null } when there is no work; no model run
      ▼
Hermes agent                            drafts a change, opens branch/PR
      │
POST /api/community/action             (allow-list: open-fix-pr, open-prototype-pr,
      │                                  comment, flag-duplicate, request-info)
      │  POST /api/community/fail      explicit failed attempt, same lease
      ▼
Gates (docs/RELEASE-LOOP.md + PR checks) ──► maintainer/community acceptance
      │
      ▼
Merge to main (human-triggered only) ──► Coolify deploy ──► /metrics reflects it

Read-only reconciliation (COMMUNITY_RECONCILE) re-reads Fider on boot and every
5 minutes, so a missed webhook, a restart, or an eviction cannot lose work.
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
5. **Rate/abuse limited.** `/api` is rate-limited and the durable queue refuses
   new intake past `COMMUNITY_MAX_ITEMS` (default 5000 unfinished records) rather
   than evicting unfinished work. The webhook route is the one deliberate
   exception: Fider permanently
   disables a webhook on the first non-2xx it sees and never retries, so a 429
   there would silently drop every future report. It is registered ahead of the
   `/api` limiter and metered separately, and an over-limit delivery is dropped
   with a counted `202` rather than a `429`.
6. **No automatic deploy.** The loop never calls a deploy endpoint; production
   releases are human-triggered. The binding rules — lifecycle, invariant,
   idempotency keys, retries, and forbidden actions — live in
   `docs/COMMUNITY-LOOP-CONTRACT.md`, which this document defers to.

## Hermes agent contract

Hermes leases one item at a time (cron/heartbeat) and handles it:

```
POST <game>/api/community/claim                     header: x-community-token
     { "workerId": "<stable worker id>" }
  -> { "item": {...}, "leaseToken": "...", "inputHash": "...", "attempt": 1 }
  -> { "item": null }                              when there is no work

POST <game>/api/community/action                    header: x-community-token
     { "id": "<post number>", "action": "open-fix-pr",
       "detail": "https://github.com/menezmethod/saucerjam/pull/<n>",
       "leaseToken": "<from claim>", "inputHash": "<from claim>" }

POST <game>/api/community/fail                      header: x-community-token
     { "id": "<post number>", "detail": "<why>",
       "leaseToken": "<from claim>", "inputHash": "<from claim>" }
```

`GET /api/community/queue` still exists for inspection; it answers non-200 when
the durable store cannot be read, because an unusable store must never look like
an empty queue. The lease is mandatory for a state-changing completion: without
it a worker could mark unrelated work done. A `detail` that is not an exact PR
URL in this repository is rejected — a receipt records that a PR was opened, and
it never marks a report done. That only happens when Fider itself reports a
terminal status.

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

## Merge and release gate

- `main` is protected: the `verify` check (`.github/workflows/ci.yml`) must pass;
  no direct or force pushes, enforced for administrators too.
- `.github/workflows/automerge.yml` runs from `main` after every successful
  `verify` on a PR and every 30 minutes. It merges at most one PR per run, and only
  when `verify` passed on the exact head SHA, the PR comes from this repo, it has
  no `prototype`/`no-automerge`/`hold` label, and every changed path passes
  `scripts/ops/automerge-eligible.cjs` (styles, static page shell, ordinary docs).
  Everything else waits for a human merge. Labels and PR text cannot widen it.
- Coolify auto-deploys `main`; that is the only deploy trigger. Its container
  `HEALTHCHECK` keeps a failing build from replacing the running one, and the SRE
  heartbeat (`saucerjam-ops sre check`, then a bounded `heal`) covers the rest.
- Ops cron wrappers run from a dedicated clone pinned to `origin/main`, not from a
  working checkout, so an agent switching branches cannot change what ops run.
