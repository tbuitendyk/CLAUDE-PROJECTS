#!/usr/bin/env bash
# pilot-produce-once.sh -- run ONE producer pass now (writes data/pilot/preview.json
# and computes the current intent). Ships NOTHING (no scp; that is the push wrapper).
# Used to populate today's decision preview after a mid-window deploy.
set -uo pipefail
cd /opt/general-classifier || { echo "no app"; exit 1; }
PILOT_SOCKS=127.0.0.1:1080 node pilot-produce.js >/dev/null 2>&1 || true
echo "--- preview.json ---"; cat data/pilot/preview.json 2>/dev/null || echo "(none)"
