#!/usr/bin/env bash
# Reports set/missing for the Hermes environment. Never prints values.
# Coolify credentials are loaded from ~/.config/menez/coolify.env.
# Exits non-zero when a required variable is missing.
set -u

COOLIFY_ENV="${COOLIFY_ENV:-$HOME/.config/menez/coolify.env}"
if [ -f "$COOLIFY_ENV" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$COOLIFY_ENV"
  set +a
fi

required=(COOLIFY_URL COOLIFY_TOKEN COMMUNITY_ACTION_TOKEN)
optional=(GRAFANA_RELAY_TOKEN HERMES_WEBHOOK_SECRET)
missing=0

echo "coolify source: $COOLIFY_ENV"
for name in "${required[@]}"; do
  if [ -n "${!name-}" ]; then
    echo "set     $name (required)"
  else
    echo "missing $name (required)"
    missing=1
  fi
done
for name in "${optional[@]}"; do
  if [ -n "${!name-}" ]; then
    echo "set     $name (optional)"
  else
    echo "missing $name (optional)"
  fi
done

exit "$missing"
