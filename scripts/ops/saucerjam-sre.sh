#!/usr/bin/env bash
# Cron entrypoint for the SaucerJam SRE heartbeat. Hermes runs non-.sh cron
# scripts with Python, so the Node body lives behind this wrapper.
set -euo pipefail
exec node "$(dirname "$0")/saucerjam-ops.cjs" sre "$@"
