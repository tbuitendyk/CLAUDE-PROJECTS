#!/usr/bin/env bash
# classifier-pilot-live-check.sh -- READ-ONLY: is the deployed classifier
# serving the live-pilot surfaces? Prints the deployed version, healthz,
# whether pilot.html is served, and the head of /api/pilot (config+anatomy
# presence). No writes, no orders, no job interaction.
set -uo pipefail
APPDIR=/opt/general-classifier
echo "deployed version: $(grep -oE '"version": "[^"]+"' $APPDIR/package.json 2>/dev/null || echo '?')"
echo "healthz: $(curl -sS -m 5 http://127.0.0.1:8093/api/healthz)"
code=$(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8093/pilot.html)
echo "pilot.html: HTTP $code"
curl -sS -m 10 http://127.0.0.1:8093/api/pilot | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('api/pilot keys:', sorted(d.keys())[:10])
print('journal present:', d.get('present'))
c = d.get('config') or {}
print('config model pair:', (c.get('model') or {}).get('tradedPair'))
a = d.get('anatomy') or {}
print('anatomy pipeline stages:', len(a.get('pipeline') or []), '| committee:', len(a.get('committee') or []))
"
echo "(read-only)"
