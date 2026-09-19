#!/usr/bin/env bash
# SaucerJam issue lifecycle collector - cron entrypoint.
#
# Deterministic: no model calls, no local state. Fider is the record, so this is
# correct after any restart and needs neither Hermes nor a database to be online.
# Keeping it here rather than as an agent cron is deliberate - an agent cron burns
# tokens every tick and would fail the same way the loop already failed.
#
# Contract (docs/HERMES-AUTOMATION-CONTRACT.md):
#   exit 0 + empty stdout = healthy/silent   (cron delivers nothing)
#   exit 0 + stdout       = an event         (delivered verbatim)
#   non-zero              = alert            (cron sends an error alert)
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REPO="${SAUCERJAM_REPO:-$HOME/code/github.com/menezmethod/saucerjam}"
SCRIPT="$REPO/scripts/ops/saucerjam-lifecycle.cjs"
[ -f "$SCRIPT" ] || SCRIPT="$HOME/.hermes/scripts/saucerjam-lifecycle.cjs"

# Load credentials only when missing, so an inherited environment always wins.
if [ -z "${FIDER_API_KEY:-}" ] && [ -f "$HOME/.hermes/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$HOME/.hermes/.env"; set +a
fi

if [ ! -f "$SCRIPT" ]; then
  echo "missing required file: $SCRIPT"
  exit 1
fi
if [ -z "${FIDER_API_KEY:-}" ]; then
  echo "missing required env: FIDER_API_KEY"
  exit 1
fi

# --- single-run exclusion -------------------------------------------------
# The collector reads a snapshot and then acts on it. Two overlapping runs can
# both see an unacknowledged report and both acknowledge it. Nothing in the
# collector can prevent that, so exclude it here.
# mkdir is atomic on every POSIX filesystem, which is the lock primitive that
# does not need `flock` (absent on macOS by default).
LOCK="${TMPDIR:-/tmp}/saucerjam-lifecycle.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A stale lock from a killed run must not wedge the collector forever.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    # Another run holds it and is doing this exact work. Stay silent: reporting
    # an overlap every tick would be noise, and no work is being missed.
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# --- deadline -------------------------------------------------------------
# Without one, a hung Fider request blocks this tick indefinitely and the next
# scheduled run is skipped rather than overlapping. Bounded is better.
# NOTE: do not `exec` here. exec would replace this shell, so the EXIT trap
# above would never run and the lock would leak - blocking or delaying the next
# tick. Run the collector as a child, capture its status, and let the trap fire.
TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"
DEADLINE="${SAUCERJAM_LIFECYCLE_TIMEOUT:-300}"

if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "$DEADLINE" node "$SCRIPT" --apply
  STATUS=$?
else
  node "$SCRIPT" --apply
  STATUS=$?
fi

# A timeout (124) or a collector error is a real event: exit non-zero so the cron
# surfaces it as an alert rather than delivering it as an ordinary message.
exit "$STATUS"
