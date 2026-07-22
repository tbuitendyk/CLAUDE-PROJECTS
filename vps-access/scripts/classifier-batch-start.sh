#!/usr/bin/env bash
# classifier-batch-start.sh -- kick off the General Classifier's pair-screen
# batch on the local service (127.0.0.1:8093, no site auth on loopback).
# Defaults live in the service (17 high-cap pairs vs BTCUSDT, both models,
# dormant +/-5%, 2018-01..2026-06, compressed features). Prints the JSON
# response ({"batchId": ...} or an error). Rejected with 409 if a batch is
# already running.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/batch \
  -H "Content-Type: application/json" \
  -d '{"dormantPct":5,"startMonth":"2018-01","endMonth":"2026-06","featureSet":"compressed"}'
echo
