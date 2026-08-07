#!/usr/bin/env bash
# classifier-forwardbooks-raw.sh -- READ-ONLY: raw forward-book JSON, for
# diagnosing the reader rather than the result.
set -uo pipefail
curl -sS --max-time 900 http://127.0.0.1:8093/api/forwardbooks
