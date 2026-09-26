# Saucerjam — agent handoff notes

This file is loaded automatically by Claude Code (and is useful to any agent
working in this repo). Keep it short; delete entries once they're stale.

## ACTIVE — grenade cancel gesture (`feat/grenade-cancel`)

**Status: 2026-09-26 — MERGED.** Squash-merged into `main` as `1b3aa9d`
(PR #40, https://github.com/menezmethod/saucerjam/pull/40). `npm test`
228/228; browser suite green (6/6 local, and green in CI after the gesture
checks were converted from fixed sleeps to polling). Auto-deploys via Coolify
on `main`. **Only the real-device playtest remains** — if the gesture feels off,
open a new PR; don't reflexively revert a merged, CI-verified fix.

A previous `claude --resume` session (7b45e801) hit its weekly usage limit
mid-verification on this branch. An OpenCode/DeepSeek session picked it up,
finished the verification, fixed the flaky test, and merged it. **Do not
revert or re-implement the items below — each is a deliberate fix, several
for real bugs found by CI.**

What shipped:

1. **Grenade cancel gesture** (`src/index.js`): hold to charge. Drag past the
   dead zone = armed; drag back to center before releasing = cancel (tracked as
   `grenade_cancelled`, fire stick dims via `.cancel-armed`). Release while
   armed = throw. This is the "clever cancel" the user asked for, not a bug.
2. **Throw aim computed fresh at release** (`pendingThrowAim`), not the
   low-pass-smoothed `this.aim` — the smoothed value lags and on a fast
   tap-release can point the *opposite* way. Uses the same sticky target
   selection as the on-screen preview so the throw matches the reticle.
3. **Fallback**: if no fresh target exists at the release instant (only enemy
   just died/protected/broke line of sight), throw at `this.aim` instead of
   silently doing nothing.
4. **Energy banner removed** (`src/index.js` + `main.css`): the centered
   "Recharging energy…" banner is gone; `#vital-energy` now pulses amber
   (`.insufficient`) in place. User asked for less on-screen clutter.
5. **Flaky grenade test fixed for real** (`tests/browser.cjs` +
   `shared/simulation.js`): the test was racing a practice bot that could
   **kill the local player mid-gesture**, which calls `clearInput()` and wipes
   the fire stick/aim. Added a harness flag (`invulnerable` on the practice
   local player, opt-in via `?invulnerable` or
   `window.__SAUCERJAM_PRACTICE_INVULNERABLE`, mirroring `?lowgfx`). The
   baseline flake rate was ~50%; it is now stable. The gesture assertions were
   also changed from fixed `sleep(150)`+assert to polling for each step's
   observable effect, because back-to-back touch moves can coalesce on a
   starved CI runner and skip the arm step.

**Still to do:** real touch-device playtest of the cancel gesture (hold, drag
out, drag back, release). Automation cannot judge feel. If it's wrong, open a
new PR — the merge is already CI-verified.

**Known non-issues (don't "fix" these):**
- `pendingThrow`/`pendingThrowAim` are read-and-cleared in `input()` in the
  same tick they're set by `pointerEnd`; that's the one-shot throw contract.
- The grenade cannot be thrown at a target behind cover by design
  (`pickTarget` traces walls).

## Untracked dirs

`.agents/`, `.claude/`, and `agent/` each contain a copy of the `typesafe-ai`
skill and are untracked. Left alone deliberately; not part of this branch.
