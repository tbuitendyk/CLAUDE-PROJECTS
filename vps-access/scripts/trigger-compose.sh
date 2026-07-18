#!/usr/bin/env bash
# trigger-compose.sh -- start a composition-lab search on the semi-auto
# balancer from the ops channel (the UI's own button is behind the site's
# HTTP Basic Auth; this hits the service's LOCAL API on 127.0.0.1:8092,
# where the app's own APP_PASSWORD gate is disabled). The job runs IN the
# service process exactly as the UI button would, so it survives, persists
# its result on completion, and shows live progress in the UI.
#
# Usage via run-script:
#   arg = "<profileId>"              -> intensive (1,000,000 combos)
#   arg = "<profileId>-<samples>"    -> explicit sample count
#   append "-cs"                     -> current-holdings allocation × sensitivity
# e.g. arg "2" or "2-1000000" (full universe), "2-200000-cs" (Bitso MAIN,
# current-holdings allocation search at 200k splits).
set -euo pipefail

ARG="${1:-}"
if [[ -z "$ARG" ]]; then
  echo "usage: run-script trigger-compose.sh <profileId>[-<samples>][-cs]" >&2
  exit 1
fi
CURRENTSET=false
if [[ "$ARG" == *-cs ]]; then CURRENTSET=true; ARG="${ARG%-cs}"; fi
PID="${ARG%%-*}"
if [[ "$ARG" == *-* ]]; then SAMPLES="${ARG#*-}"; else SAMPLES=1000000; fi

echo "Triggering composition search: profile=${PID} samples=${SAMPLES} currentSet=${CURRENTSET}"
curl -sS -m 30 -X POST "http://127.0.0.1:8092/api/profiles/${PID}/compose" \
  -H 'Content-Type: application/json' \
  -d "{\"samples\":${SAMPLES},\"currentSet\":${CURRENTSET}}"
echo
echo "Started. Watch progress in the UI (Composition lab) or poll /api/jobs/<id>."
