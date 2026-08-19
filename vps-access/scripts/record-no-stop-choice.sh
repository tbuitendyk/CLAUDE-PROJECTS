#!/usr/bin/env bash
# record-no-stop-choice.sh -- ONE-SHOT: record the owner's decision (2026-08-19)
# to run with NO protective stop, so it reads as a choice rather than a gap.
#
# Changes NO engine behaviour. The carry already reads a null stop as CLEAR and
# the box already has no FIXED_STOP_PCT; this writes only the record of WHY, via
# the same endpoint the Constructing screen's "No stop (clear)" button uses.
#
# Delete after use — it exists to place one decision, not to be kept around.
set -uo pipefail
APP=/opt/general-classifier

echo "== before =="
curl -sS -m 8 http://127.0.0.1:8093/api/pilot/fixed-stop | sed 's/^/  /'; echo

echo "== record the decision =="
curl -sS -m 10 -X POST http://127.0.0.1:8093/api/pilot/stop-apply \
  -H 'Content-Type: application/json' \
  -d '{"stopPct":null,"why":"full-history scan 2026-08-19 over 1804 trades: every stop level is net negative (12% -$50.22, 32.163% -$14.22, 40% -$7.20). The margin floor is the catastrophe brake instead."}' \
  | sed 's/^/  /'; echo

echo "== after =="
curl -sS -m 8 http://127.0.0.1:8093/api/pilot/fixed-stop | sed 's/^/  /'; echo

echo "== the box must be UNCHANGED — no stop before, no stop after =="
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
  admin@$BOX_HOST 'grep -E "^FIXED_STOP_PCT" ~/.executor-env 2>/dev/null || echo "FIXED_STOP_PCT not set — no stop on any order (unchanged)"' 2>/dev/null | sed 's/^/  /'
