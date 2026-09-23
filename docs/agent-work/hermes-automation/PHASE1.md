# Phase 1 completion report — recoverable intake and truthful recovery

STATUS: **ready_for_review** (not self-accepted)
Task: `/root/automation_core`
Workspace: `/Users/luisgimenez/.codex/.chatgpt-projects/g-p-6aab4b96dc3c8191b8ccfe2c26819988/saucerjam-automation`
Branch: `fix/hermes-end-to-end` (baseline `b1d4cce34a912a430fb6ccc9c1890339133c131d`)

No commits, pushes, deployments, or production calls were made. All tests use
temporary state files and local HTTP fixtures.

## What changed

**Durable journal (new `server/community-queue.js`, `server/community-core.js`)**

The in-memory `Map` became a JSON journal on mounted storage, written atomically
(temp file, `fsync`, `rename`). It records work, attempts, leases, and
side-effect receipts. It fails closed: a corrupt, truncated, unreadable, or
wrong-shaped file is reported through `/health` and every write refuses until an
operator repairs it — a failed read is never treated as an empty store. Capacity
refuses new intake at the ceiling (default 5000 unfinished records) and never
evicts. The post number is the canonical key; the Fider internal id survives as a
compatibility alias so pre-existing callers and fixtures that look up by `id`
still resolve.

**Fider reconciliation (new `server/community-fider.js`)**

The only module that reads Fider's post list. Boot pass plus a bounded interval
(default 5 min, `<=5` per the brief), per-request timeout, `running` guard so
passes cannot overlap. Reads `view=all|declined|duplicate&limit=all`. Terminal
states close work; planned/started stay live; reopens and content edits
invalidate the outstanding lease and refresh the input hash. Ordering uses
Fider `createdAt`. Posts 9 and 10 are excluded as documented smoke posts and
nothing else; the set is configurable. **A partial or failed snapshot changes
nothing**, so an unreadable Fider cannot terminalize work. The timer is stopped in
`server.close()`.

**Claim / complete protocol (`server/server.js`)**

`POST /api/community/claim` returns at most one eligible item with an
unguessable lease token, the input hash, the attempt number, and the expiry, or a
cheap `{ item: null }`. The lease is persisted before the token is returned, so a
crash cannot double-issue it. `POST /api/community/action` keeps the existing
allow-list but now requires a valid unexpired matching lease for state-changing
completions (428 without one; `COMMUNITY_LEGACY_ACTIONS=true` is the explicit
fixture-only escape hatch). Conflicts are 409 with a machine-readable `reason`.
An exact replay is accepted and adds no receipt. `request-info` maps to
`request_info`; a comment is a distinct acknowledgement receipt. `fix-pr` /
`prototype-pr` are validated against exactly
`https://github.com/menezmethod/saucerjam/pull/<number>` and record `actioned`,
never `done`. `POST /api/community/fail` is the guarded failed-attempt path with
bounded exponential backoff; three attempts dead-letter. There is no merge or
deploy action anywhere on this surface, and no worker assertion can terminalize.

**Truthful checks and health (`server/server.js`, `scripts/ops/saucerjam-ops.cjs`)**

`/health` carries a community block and readiness; a broken store degrades it
while the game itself stays `ok`, and missing optional integration credentials do
not. `/api/community/queue` answers 503 from an unusable store instead of
reporting an empty queue. Label-free community metrics expose queue size,
backlog, exhaustion, store health, oldest-due timestamp, reconcile freshness, and
claim/conflict counters. The SRE checker now requires a parseable JSON health body
with `status`, `rankings`, and the community block all `ok`, and requires the
rankings metric to be present and healthy — a missing series is no longer a
healthy signal. It also alerts on a store reporting itself unhealthy.

**Bounded SRE heal (`scripts/ops/saucerjam-ops.cjs`)**

Re-confirms the failure at invocation time (a saved `down` state is never acted
on), requires credentials, requires a second sample after a short backoff, and
restarts only for true unavailability — degraded rankings and malformed bodies
are reported and skipped. It defers while a deployment is active, enforces a
cooldown, and keeps a **persistent** budget of 2 restarts per incident across
invocations. An accepted restart POST does not clear the budget; only an observed
healthy sample does. Recovery is verified inside a bounded budget (< 55s), and
accepted-but-still-down is reported as a failure. No deploy endpoint is
referenced.

**Ops and packaging**: `deploy/hermes/authority.json` gains
`SaucerJamHealthMalformed` and a corrected escalation clause; `automation.json`
documents the heal bounds and worker endpoints; `Dockerfile` copies the new
server modules and sets `COMMUNITY_QUEUE_FILE`; `server/env.example` documents
every new variable.

**Docs**: `docs/COMMUNITY-LOOP-CONTRACT.md` §5a is the new authoritative
protocol (states, lease/complete/fail, reconciliation, fail-closed store);
`docs/SRE.md` documents the heal bounds, the new pipeline shape, the metrics, and
the environment variables; `docs/AUTOMATION.md`'s diagram and Hermes contract
match the leased flow.

## Verification

| Command | Result |
| --- | --- |
| `npm run ops:selftest` | **pass** — 11/11 assertions, `ops:selftest OK` |
| `node --check` on all 8 changed/added JS files | **pass** |
| `node --test tests/community-durability.test.js` | **pass** — 33/33 |
| `node --test tests/automation.test.js tests/community.test.js tests/loop-audit-fixes.test.js tests/community-webhook.test.js tests/community-guard.test.js tests/community-standing-cooldown.test.js tests/metrics.test.js tests/security.test.js tests/lifecycle*.test.js` | **pass** — 97/97 |
| Durative store smoke (terminal/reopen, legacy id lookup, restart round trip) | **pass** — `durability smoke OK` |
| Socket-free heal harness (fixtures, unreachable Coolify) | **pass** — 10/10: healthy silence, degraded refusal, budget 1 then 2, third invocation escalates, budget held at 2, credential gate, healthy clears the incident |

Two defects were found and fixed by running the heal path against fixtures:
an unreachable Coolify used to throw out of `restartSaucerJam()`, so the
incident budget was never recorded and the loop retried forever; and
`Number(env) || default` silently discarded an explicit `0`, making the new
tunables impossible to disable. Both are covered now.

### Not verified (blocker)

`tests/ops-heal.test.js` (9 new tests) has been written but **has never been
executed**. Node tests that bind a local loopback socket are blocked by the
sandbox, and the escalation path that previously allowed them began failing
mid-session:

```
Automatic approval review failed: You've hit your usage limit ...
The action was not executed because automatic approval review could not be
completed. This is a review failure, not a determination that the action is
unsafe.
```

The same denial now also affects re-runs of the suites that were passing earlier.
The heal suite needs one escalated run to confirm, plus a final full-suite run
for the record.

`tests/progression.test.js` crashes the Node 26.7.0 process
(`node::InternalCallbackScope::Close` assertion). It fails identically in the
untouched original checkout, so it is pre-existing and unrelated.

## Decisions for Astra

1. **`/health` shape changed.** It now always includes a `community` block. That
   is the intended contract, but anything parsing `/health` strictly should be
   checked.
2. **Two existing test files carry edited fixture bodies.**
   `tests/automation.test.js`, `tests/loop-audit-fixes.test.js`,
   `tests/community-guard.test.js`, `tests/community-standing-cooldown.test.js`,
   and `scripts/ops/selftest.cjs` were updated only where phase 1 replaced the
   asserted behavior: health fixtures gained real `status`/`rankings`/`community`
   fields, the API queue assertion became "these three posts", the completion
   test now claims a lease, and the recorded action name is the journal
   transition (`actioned`) with the worker detail preserved. No guarantee was
   weakened.
3. **`communityStateFile` is injected, not implicit.** `createGameServer` stays
   in memory unless a path is passed, so importing the server from a test can
   never write into the repo's `server/data`. Only the real entrypoint installs
   the production default. Root owns mounting it.
4. **Reconciliation is opt-in** (`COMMUNITY_RECONCILE=true`), and inert without
   `FIDER_BASE_URL` + `FIDER_API_KEY`.
5. **Backoff has a 1s floor** in production code so a millisecond-configured
   retry cannot be won by busy-spinning against a millisecond-resolution clock.

## Next checkpoint

Run `node --test tests/ops-heal.test.js` with local socket access, then one full
`npm test`-equivalent sweep, and paste both results into this file.
