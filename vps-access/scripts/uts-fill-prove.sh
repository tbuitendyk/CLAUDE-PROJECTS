#!/usr/bin/env bash
# Starts the PROVING run: one unit priced, the whole store walked, NOTHING
# written. No writer is opened, so there is nothing to leave behind and nothing
# to swap. Then it watches until it lands and prints what it proved.
set -uo pipefail
B=http://127.0.0.1:8094
ID=s3-mte0oajo-1
echo "== asking for a proving run on unit 0, keeping 10 =="
curl -s --max-time 30 -X POST -H 'Content-Type: application/json' \
  -d '{"keep":10,"dryRun":true,"onlyUnit":0}' "$B/api/stageset/$ID/kept-fill"
echo; echo
echo "== watching (it prices one unit, then walks all 3,658 blocks) =="
for i in $(seq 1 40); do
  sleep 30
  line=$(curl -s --max-time 15 "$B/api/stageset/$ID" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('set') or {}
print(d.get('status'), '|', (d.get('progress') or '')[:150])
" 2>/dev/null)
  echo "  [$((i*30))s] $line"
  case "$line" in
    done*PROVING*|done*stopped*) echo; echo "== landed =="; break;;
  esac
done
