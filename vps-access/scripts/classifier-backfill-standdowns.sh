#!/usr/bin/env bash
# classifier-backfill-standdowns.sh -- one-shot: reconstruct the pilot's daily
# stand-down history (FLAT calls shipped no intent and were recorded nowhere,
# so the screen's daily history showed only trade days). Runs the idempotent
# backfiller as the service user; touches only data/pilot/standdowns/ —
# display history, never the mirror's decision store, never an intent.
set -euo pipefail
cd /opt/general-classifier
sudo -u classifier node pilot-backfill-standdowns.js "${1:-2026-08-08T00:00:00Z}"
echo "--- standdown records now present ---"
ls -1 data/pilot/standdowns/ 2>/dev/null || echo "(none)"
