#!/usr/bin/env bash
# job-log.sh -- read-only: service restarts + analysis-job lifecycle from the
# journal (last 8h), so "why didn't my run finish" is answerable: was the job
# killed by a restart, did it fail with an error, or did it complete?
set -euo pipefail
echo "== service starts/stops (8h) =="
journalctl -u semi-auto-balancer --since "8 hours ago" --no-pager 2>/dev/null \
  | grep -E "Started|Stopped|Stopping|listening" | tail -12 || true
echo "== job lifecycle + errors (8h) =="
journalctl -u semi-auto-balancer --since "8 hours ago" --no-pager 2>/dev/null \
  | grep -iE "job |compose|tune|failed|error" | grep -v "Poll failed" | tail -30 || echo "(none)"
