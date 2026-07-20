#!/usr/bin/env bash
# job-cancel.sh -- request cooperative cancellation of a running analysis job
# on the semi-auto balancer via the LOCAL API. The job aborts at its next
# progress report (seconds); nothing is persisted. Usage: arg = "<jobId>".
set -euo pipefail
JOB="${1:-}"
if [[ -z "$JOB" ]]; then echo "usage: run-script job-cancel.sh <jobId>" >&2; exit 1; fi
curl -sS -m 15 -X POST "http://127.0.0.1:8092/api/jobs/${JOB}/cancel" -H 'Content-Type: application/json'
echo
