#!/usr/bin/env bash
# ht2-exam-a.sh -- fire HT v2 entrance exam A (PLANTEDLATEUSDT).
set -uo pipefail
curl -s -X POST http://127.0.0.1:8093/api/httwo -H 'Content-Type: application/json' -d '{"examPair":"PLANTEDLATEUSDT"}'
echo
