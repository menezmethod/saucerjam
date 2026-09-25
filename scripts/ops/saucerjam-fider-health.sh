#!/usr/bin/env bash
# Hermes cron watchdog for Fider's outbound webhook to SaucerJam.
#
# Why this exists: a failed Fider webhook AUTO-DISABLES ITSELF (status 1 -> 3) and
# then silently stops delivering. Nothing else alarms on that, so community intake
# can be dead for weeks while the queue just looks empty.
#
# Contract: exit 0 + EMPTY stdout = healthy (cron stays silent).
#           non-empty stdout / non-zero exit = alert.
#
# FIDER_HOST=local (default) runs docker directly on this box via `sudo docker`
# (Fider and Hermes are co-located on Oracle). Set FIDER_HOST=user@host to check
# a remote Fider over ssh instead, as this ran before the Oracle migration.
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
HOST="${FIDER_HOST:-local}"
DB_CONTAINER="${FIDER_DB_CONTAINER:-database-3eryqh2shspqvr0yn8hpo2oo}"
FIDER_CONTAINER="${FIDER_CONTAINER:-fider-3eryqh2shspqvr0yn8hpo2oo}"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10"

run() {
  if [ "$HOST" = "local" ]; then
    if command -v timeout >/dev/null 2>&1; then timeout 25 bash -c "$1" 2>/dev/null
    else bash -c "$1" 2>/dev/null; fi
    return
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout 25 ssh $SSH_OPTS "$HOST" "$1" 2>/dev/null
  else
    ssh $SSH_OPTS "$HOST" "$1" 2>/dev/null
  fi
}

# 1. Reachability. Remote: ssh must succeed. Local: docker must answer at all.
if [ "$HOST" = "local" ]; then
  REACH="$(run 'sudo -n docker inspect --format ONLINE '"$FIDER_CONTAINER"' 2>/dev/null')"
  [ "$REACH" = "ONLINE" ] || { echo "FiderUnreachable: sudo docker inspect $FIDER_CONTAINER failed — community intake is unmonitored"; exit 1; }
else
  REACH="$(run 'echo ONLINE')"
  [ "$REACH" = "ONLINE" ] || { echo "FiderUnreachable: cannot ssh $HOST — community intake is unmonitored"; exit 1; }
fi

# 2. Webhook rows: status 1 = enabled, 3 = auto-disabled after a failure.
DOCKER="docker"; [ "$HOST" = "local" ] && DOCKER="sudo -n docker"
ROWS="$(run "U=\$($DOCKER inspect $DB_CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p'); $DOCKER exec $DB_CONTAINER psql -U \"\$U\" -d fider -tAc 'select id,status from webhooks order by id;'")"
if [ -z "$ROWS" ]; then
  echo "FiderWebhookUnreadable: could not read the webhooks table on $HOST"
  exit 1
fi

DISABLED="$(printf '%s\n' "$ROWS" | awk -F'|' 'NF>=2 && $2+0 != 1 {print $1}')"
if [ -n "$DISABLED" ]; then
  echo "FiderWebhookDisabled: webhook id(s) $DISABLED are not enabled — Fider silently stopped delivering to SaucerJam. Check: $DOCKER logs --tail 40 $FIDER_CONTAINER | grep -i webhook"
  exit 1
fi

# 3. Judge only the MOST RECENT delivery — old failures in the log window are not
#    current state (this exact bug made the first version of this script always red).
LAST="$(run "$DOCKER logs --tail 200 $FIDER_CONTAINER 2>&1 | grep -i 'webhook' | tail -1")"
case "$LAST" in
  *"error response code"*|*"Could not"*)
    echo "FiderWebhookFailing: the most recent delivery failed — $LAST"
    exit 1
    ;;
esac

exit 0
