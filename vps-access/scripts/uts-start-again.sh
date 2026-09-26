#!/usr/bin/env bash
# uts-start-again.sh <setId> -- WRITES: starts a paused record set again, on the
# owner's explicit order (GO NOW! 2026-09-26: "stop the current running job,
# deploy the code, run the stage testing, and then restart the job"). Asks the
# service's own door, the one Start stage 1 presses for a paused set; the set
# picks up where it was paused and keeps every unit already saved. Deletes
# nothing.
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: <setId>"; exit 0; }
case "$ID" in *[!A-Za-z0-9._-]*) echo "bad set id"; exit 1;; esac
echo "== starting $ID again =="
curl -sS --max-time 90 -X POST "http://127.0.0.1:8094/api/stageset/$ID/continue" -H 'Content-Type: application/json' -d '{}'; echo
