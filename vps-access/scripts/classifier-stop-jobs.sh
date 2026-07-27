#!/usr/bin/env bash
# classifier-stop-jobs.sh -- the UI's "Stop jobs" kill switch from the ops
# channel: aborts the General Classifier's running screen and any in-flight
# training within seconds. Completed runs and saved results are kept; the
# screen is marked cancelled/interrupted. Read-only otherwise.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/abort
echo
