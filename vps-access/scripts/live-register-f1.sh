#!/usr/bin/env bash
# live-register-f1.sh -- run the 9.1 registration on the VPS: F1 appears on the
# Live Trading tab as setup f1-pilot, state DRAFT (visible, inert — drafts never
# produce intents and never enter the allowlist; the pilot keeps its own rails).
set -uo pipefail
cd /opt/general-classifier && node tools/register-f1-setup.js
echo "--- tab now lists ---"
curl -sS -m 6 http://127.0.0.1:8093/api/live/setups | python3 -m json.tool | head -20
