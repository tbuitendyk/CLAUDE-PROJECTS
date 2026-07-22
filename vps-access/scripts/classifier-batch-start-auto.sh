#!/usr/bin/env bash
# classifier-batch-start-auto.sh -- fire the pair screen with the ADAPTIVE
# dormant band: each pair's band is calibrated on its own training weeks so
# the -1/0/+1 classes split near-evenly (band = 33rd percentile of the
# |Tue->Thu move|). Full history, both models, compressed features.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/batch \
  -H "Content-Type: application/json" \
  -d '{"dormantPct":"auto","startMonth":"2018-01","endMonth":"2026-06","featureSet":"compressed"}'
echo
