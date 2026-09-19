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
