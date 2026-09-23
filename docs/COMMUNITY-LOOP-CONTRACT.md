# Community loop contract (SaucerJam)

Single source of truth for the Fider → queue → reconcile loop. Code follows this
document; where it does not, the code is wrong. `docs/AUTOMATION.md`,
`docs/SRE.md`, and `docs/LOOP.md` defer to it.

## 1. Lifecycle states

| State | Meaning | Terminal? |
| --- | --- | --- |
| `new` | Fider post recorded, no loop action yet | no |
| `in_progress` | Work started (PR/branch open, draft in flight) | no |
| `actioned` | The loop performed its side effect; awaiting outcome | no |
| `done` | Outcome confirmed (released/answered/closed) | yes |
| `request_info` | Waiting on the reporter; no automated attempts | yes (until reopened) |
| `dead_letter` | Attempts exhausted or unrecoverable | yes (until reopened) |

Permitted transitions:

```
new -> in_progress -> actioned -> done
new|in_progress|actioned -> request_info
new|in_progress|actioned -> dead_letter
request_info|dead_letter -> new   (explicit reopen only)
```

**Ack ≠ actioned ≠ terminal.** An ack is a comment saying "we have your report".
`actioned` means the loop performed its side effect. Terminal means no further
automated work will happen. They are three different facts and must never be
conflated.

## 2. Invariant

Every Fider post created after `2026-09-19T16:30:00Z` that is not in a terminal
state must have (a) an ack comment on Fider and (b) a queue record, within its
ack SLO (default 15 minutes). A missing ack or record is an incident, not a
retry.

## 3. Idempotency keys

Every side effect is keyed and recorded durably before it is attempted:

| Side effect | Key |
| --- | --- |
| Webhook ingest | `post:<postNumber>` |
| Ack comment | `ack:<postNumber>` |
| Reconcile action | `apply:<postNumber>:<derivedState>:<inputHash>` |
| GitHub issue/PR | `gh:<postNumber>:<proposal>` |
| Status/alert message | `notify:<postNumber>:<state>` |

Replaying a payload or a reconcile pass with the same key is a no-op.

## 4. Retries, backoff, dead-letter

- Attempt ceiling: **3**. Exceeding it makes the item terminal (`dead_letter`)
  with a recorded reason. It never retries forever.
- Backoff: per-item exponential, base 30s, factor 2, cap 1h, **and** a global
  token bucket. Use the **max** of the two. Add 15–25% jitter to every backoff
  and sweep interval.
- No re-attempt on identical input: if the last N attempts produced the same
  outcome for the same input hash, dead-letter instead of looping.
- Terminal errors (validation/parse/unrecoverable) dead-letter at once and
  increment `community_triage_exhausted_total`.

## 5. Level-triggered, not edge-triggered

A webhook is only a hint to enqueue a key. Reconcile re-reads all state it needs
from Fider every pass, processes a bounded batch (`limits.maxPerPass`, default
10) one key at a time, and must be correct if invoked twice. Status is derived
from Fider; local state holds only attempts, leases, and idempotency keys.

## 5a. Durable record and lease protocol (phase 1)

The queue is a JSON document on mounted storage (`COMMUNITY_QUEUE_FILE`,
default `/app/server/data/community.json`). It is written atomically
(temp file + `rename` + `fsync`) and it **fails closed**: a corrupt, truncated,
or unreadable file is reported through `/health` and every write refuses until
an operator repairs it. An empty store is only ever the result of an absent
file, never of a failed read.

The **post number is the canonical key**. The Fider internal post id is kept as
a compatibility alias so a webhook template carrying only `post_id` resolves to
the same record.

Capacity refuses new intake at the ceiling (`COMMUNITY_MAX_ITEMS`, default 5000
unfinished records). It never evicts: the old in-memory implementation deleted
the oldest entry regardless of whether it was finished.

| Local state | Meaning |
| --- | --- |
| `new` | queued, claimable once its backoff has passed |
| `in_progress` | a worker holds the lease |
| `actioned` | a receipt exists (PR opened / proposal recorded) |
| `request_info` | parked waiting on the reporter |
| `done` | Fider reports completed / declined / duplicate |
| `dead_letter` | attempts exhausted |

Only Fider's own terminal status reaches `done`. A worker asserting that a fix
shipped is recorded as `actioned`; it is never release evidence.

### Claim / complete

```
POST /api/community/claim    { "workerId": "<id>" }      x-community-token
  -> 200 { item, leaseToken, inputHash, attempt, leaseExpiresAt } | { item: null }

POST /api/community/action   { id, action, detail, leaseToken, inputHash }
POST /api/community/fail     { id, detail, leaseToken, inputHash }
```

- The lease is persisted **before** the token is returned, so a crash between
  write and response cannot hand the same item to two workers.
- `leaseTtlMs` defaults to 15 minutes. An expired lease is a **failed attempt**.
- `actioned` requires `detail` to match exactly
  `https://github.com/menezmethod/saucerjam/pull/<number>`. A fork, another
  repository, a non-numeric PR, or prose is rejected with 400.
- Replaying the exact same completion is accepted and adds no second receipt.
- A stale lease (the post was edited), a consumed lease, or a terminal item
  answers 409 with a machine-readable `reason`.
- `request-info` maps to `request_info`; a comment is an acknowledgement receipt
  (`ackedAt`) and is distinct from a terminal discussion outcome.
- `POST /api/community/fail` is the explicit failed-attempt path, guarded by the
  same lease, and drives the same bounded backoff.
- **No merge or deploy action exists on this surface.**

`COMMUNITY_LEGACY_ACTIONS=true` relaxes the lease requirement for fixtures
written against the pre-lease surface. It is off by default and must never be
enabled in production.

### Reconciliation

`COMMUNITY_RECONCILE=true` starts the read-only pass on boot and then every
`COMMUNITY_RECONCILE_INTERVAL_MS` (default 5 minutes), with a per-request
timeout. It reads `/api/v1/posts?view=all|declined|duplicate&limit=all`.

- Empty queue + Fider posts -> the posts are enqueued.
- Terminal Fider status -> `done`.
- Open/planned/started -> tracked as live work.
- An explicit reopen or a content edit invalidates the outstanding lease and
  refreshes the input hash; the stale worker gets a conflict.
- **A failed or partial fetch changes nothing.** Only a complete snapshot is
  applied, so an unreadable Fider can never terminalize work.
- Posts 9 and 10 are excluded as documented smoke posts; override with
  `COMMUNITY_RECONCILE_EXCLUDE`. No other post is excluded by default.

## 6. Forbidden

The loop must never:

- merge a pull request;
- push to `main`;
- deploy (no deploy endpoint, no production Coolify action);
- write text derived from a Fider post (title/body) into an alert, log line, or
  public artifact without the output guard: length cap 200, NFKC-normalise
  first, then strip control, bidi, and zero-width characters.

## 7. Failure mode

Fail closed and loud. If the store is unavailable, refuse public side effects.
Never continue in a state where the loop looks healthy but is not durable.
