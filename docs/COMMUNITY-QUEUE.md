# Community queue: durable record, leases, reconciliation

Implements §5 of [COMMUNITY-LOOP-CONTRACT.md](COMMUNITY-LOOP-CONTRACT.md).

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

## Claim / complete

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

## Reconciliation

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
