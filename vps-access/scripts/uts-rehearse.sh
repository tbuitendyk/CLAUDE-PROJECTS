#!/usr/bin/env bash
# Starts the REHEARSAL and watches the status line. It writes a whole store
# beside the real one, runs every check the real run runs -- row count, block
# count, block boundaries -- and stops at the rename. Then it throws its store
# away. The real store is never touched.
#
# It also prints the line at every change, so whether the status reporting
# actually moves is a thing seen rather than a thing claimed.
set -uo pipefail
B=http://127.0.0.1:8094
ID=s3-mte0oajo-1
echo "== starting the rehearsal: unit 0, keeping 10 =="
curl -s --max-time 60 -X POST -H 'Content-Type: application/json' \
  -d '{"keep":10,"dryRun":true,"onlyUnit":0}' "$B/api/stageset/$ID/kept-fill"
echo; echo
echo "== the line, printed every time it changes =="
LAST=""
END=$(( $(date +%s) + 500 ))
while [ "$(date +%s)" -lt "$END" ]; do
  L=$(curl -s --max-time 15 "$B/api/stageset/$ID" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('set') or {}
print((d.get('status') or '?') + ' | ' + (d.get('progress') or '')[:170])
" 2>/dev/null)
  if [ "$L" != "$LAST" ]; then printf '  [%3ds] %s\n' "$(( $(date +%s) - (END-500) ))" "$L"; LAST="$L"; fi
  case "$L" in done*PROVING*|done*stopped*) echo; echo "== landed =="; break;; esac
  sleep 5
done
