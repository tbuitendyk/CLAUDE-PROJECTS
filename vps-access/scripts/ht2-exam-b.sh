#!/usr/bin/env bash
# ht2-exam-b.sh -- fire HT v2 entrance exam B (PLANTEDUSDT).
set -uo pipefail
curl -s -X POST http://127.0.0.1:8093/api/httwo -H 'Content-Type: application/json' -d '{"examPair":"PLANTEDUSDT"}'
echo
