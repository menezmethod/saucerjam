# Saucerjam — agent handoff notes

This file is loaded automatically by Claude Code (and is useful to any agent
working in this repo). Keep it short; delete entries once they're stale.

## ACTIVE — grenade cancel gesture (`feat/grenade-cancel`)

**Status: 2026-09-26.** Implemented, `npm test` 228/228 green, browser suite
green 5/5 locally. **Not yet merged and not yet playtested on a real device.**

A previous `claude --resume` session (7b45e801) hit its weekly usage limit
mid-verification on this branch. An OpenCode/DeepSeek session picked it up,
finished the verification, and fixed the flaky test. **Do not revert,
re-implement, or "clean up" the items below without reading them first —
each one is a deliberate fix, several of them for real bugs found by CI.**

What's on the branch (uncommitted at handoff):

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
   baseline flake rate on `master` was ~50%; it is now stable.

**Remaining before merge:** real touch-device playtest of the cancel gesture
(hold, drag out, drag back, release) — automation cannot judge feel. Then merge
as usual (squash).

**Known non-issues (don't "fix" these):**
- `pendingThrow`/`pendingThrowAim` are read-and-cleared in `input()` in the
  same tick they're set by `pointerEnd`; that's the one-shot throw contract.
- The grenade cannot be thrown at a target behind cover by design
  (`pickTarget` traces walls).

## Untracked dirs

`.agents/`, `.claude/`, and `agent/` each contain a copy of the `typesafe-ai`
skill and are untracked. Left alone deliberately; not part of this branch.
