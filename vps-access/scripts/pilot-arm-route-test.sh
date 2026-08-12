#!/usr/bin/env bash
# pilot-arm-route-test.sh -- isolate WHERE the START POST dies: backend vs nginx.
# Hits the classifier DIRECTLY on 127.0.0.1:8093 (bypassing the site's nginx), so
# a success here means the route works and the failure is in the proxy/site layer.
#
# SAFETY: it POSTs /api/pilot/disarm (armed:false), NOT arm. The box is already
# STOPPED, so writing a disarm request is a no-op that cannot open a position — it
# only proves the write path functions. It never touches /api/pilot/arm.
set -uo pipefail
APP=/opt/general-classifier
REQ="$APP/data/pilot/arm-request.json"

echo "== before: arm-request.json present? $([ -f "$REQ" ] && echo YES || echo NO) =="

echo "== GET /api/pilot (should already work — the screen reads it) =="
gc=$(curl -sS -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:8093/api/pilot)
echo "   GET  /api/pilot           -> HTTP $gc"

echo "== POST /api/pilot/disarm (SAFE: box already stopped; proves the write path) =="
body=$(curl -sS -m 8 -w '\nHTTP %{http_code}' -X POST \
  -H 'Content-Type: application/json' --data '{}' \
  http://127.0.0.1:8093/api/pilot/disarm)
echo "$body" | sed 's/^/   /'

echo "== after: did the backend write the request file? =="
if [ -f "$REQ" ]; then
  echo "   YES — backend route WORKS. arm-request.json now exists:"
  python3 - "$REQ" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
if d.get("hmac"): d["hmac"]=d["hmac"][:8]+"...(present)"
print("     ", json.dumps(d))
PY
  echo "   (this is a DISARM request — box stays stopped; harmless)"
else
  echo "   NO — backend did NOT write the file: the route itself is broken on 8093"
fi
echo "(direct-to-backend test; nginx/site layer NOT exercised here)"
