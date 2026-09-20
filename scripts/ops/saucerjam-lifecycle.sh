#!/usr/bin/env bash
# SaucerJam issue lifecycle collector - cron entrypoint.
#
# Deterministic: no model calls, no local state. Fider is the record, so this is
# correct after any restart and needs neither Hermes nor a database to be online.
# Keeping it a plain script rather than an agent cron is deliberate - an agent cron
# burns tokens every tick and would fail the same way the loop already failed.
#
# Contract (docs/HERMES-AUTOMATION-CONTRACT.md):
#   exit 0 + empty stdout = healthy/silent   (cron delivers nothing)
#   exit 0 + stdout       = an event         (delivered verbatim)
#   non-zero              = alert            (cron sends an error alert)
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# --- resolve the collector ------------------------------------------------
# The collector must come from a git checkout, so the code that runs is always a
# reviewable commit. There is deliberately NO fallback to an unversioned copy under
# ~/.hermes: that would let the deployed code drift from the reviewed code, which is
# the exact class of failure this loop exists to remove. If no checkout provides it,
# fail LOUDLY rather than silently run something unreviewed.
SCRIPT=""
for candidate in "${SAUCERJAM_REPO:-}" \
                 "$HOME/code/github.com/menezmethod/saucerjam" \
                 "$HOME/code/github.com/menezmethod/saucerjam-lifecycle"; do
  if [ -n "$candidate" ] && [ -f "$candidate/scripts/ops/saucerjam-lifecycle.cjs" ]; then
    SCRIPT="$candidate/scripts/ops/saucerjam-lifecycle.cjs"
    break
  fi
done
if [ -z "$SCRIPT" ]; then
  echo "saucerjam-lifecycle: no git checkout provides scripts/ops/saucerjam-lifecycle.cjs"
  exit 1
fi

# Load credentials only when missing, so an inherited environment always wins.
if [ -z "${FIDER_API_KEY:-}" ] && [ -f "$HOME/.hermes/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$HOME/.hermes/.env"; set +a
fi
if [ -z "${FIDER_API_KEY:-}" ]; then
  echo "missing required env: FIDER_API_KEY"
  exit 1
fi

DEADLINE="${SAUCERJAM_LIFECYCLE_TIMEOUT:-300}"

# --- single-run exclusion -------------------------------------------------
# The collector reads a snapshot and then acts on it, so two overlapping runs can
# both see the same unacknowledged report and both acknowledge it. Nothing inside
# the collector can prevent that.
# The path is FIXED rather than $TMPDIR: cron, a login shell and a test harness can
# each carry a different TMPDIR, and two runs that disagree about the lock path are
# not excluded at all. mkdir is atomic on every POSIX filesystem, which is the lock
# primitive that avoids needing `flock` (absent on macOS by default).
LOCK="/tmp/saucerjam-lifecycle.lock"
# The staleness threshold must sit beyond the deadline, or a slow-but-alive run
# could have its lock stolen while it is still writing.
STALE_MIN=$(( DEADLINE / 60 * 2 + 5 ))

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +"$STALE_MIN" 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    # Another run holds the lock and is doing this exact work. Stay silent:
    # reporting an overlap on every tick would be noise, and nothing is missed.
    exit 0
  fi
fi

# --- run ------------------------------------------------------------------
# The collector runs as a CHILD, never via `exec`: exec would replace this shell, so
# the EXIT trap would never fire and the lock would leak on every run.
# The trap also kills the child, so a run interrupted by the scheduler cannot leave
# a node process behind holding the lock or racing the next tick.
CHILD=""
cleanup () {
  if [ -n "$CHILD" ]; then kill "$CHILD" 2>/dev/null; fi
  rmdir "$LOCK" 2>/dev/null
}
trap cleanup EXIT INT TERM

TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "$DEADLINE" node "$SCRIPT" --apply &
else
  node "$SCRIPT" --apply &
fi
CHILD=$!
wait "$CHILD"
STATUS=$?

# A timeout (124) or a collector error is a real event: exit non-zero so the cron
# surfaces it as an alert rather than delivering it as an ordinary message.
exit "$STATUS"
