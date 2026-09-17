#!/usr/bin/env bash
# uts-served-panel.sh -- READ-ONLY. Does the page the box is SERVING carry the
# new panel, and what release does it say it is?
set -uo pipefail
curl -s -m 60 http://127.0.0.1:8094/construct.js | grep -c 'Choose early, read late' | sed 's/^/"Choose early, read late" appears /'
curl -s -m 60 http://127.0.0.1:8094/construct.js | grep -o 'windows to choose on (blank = half)' | head -1
curl -s -m 60 http://127.0.0.1:8094/healthz | head -c 300; echo
