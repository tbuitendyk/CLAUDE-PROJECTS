#!/usr/bin/env bash
# job-status.sh -- read the status of a running/finished analysis job on the
# semi-auto balancer via the service's LOCAL API (127.0.0.1:8092, no site
# auth). Read-only. Usage via run-script: arg = "<jobId>".
set -euo pipefail
JOB="${1:-}"
if [[ -z "$JOB" ]]; then echo "usage: run-script job-status.sh <jobId>" >&2; exit 1; fi
curl -sS -m 15 "http://127.0.0.1:8092/api/jobs/${JOB}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('status:', d.get('status'), '| pct:', d.get('progressPct'), '| progress:', d.get('progress'), '| error:', d.get('error'))" \
  2>/dev/null || echo "job not found (expired from memory — if it finished, its result is persisted; if the service restarted, it was lost)"
