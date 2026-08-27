#!/usr/bin/env bash
# uts-tally-peek.sh -- READ-ONLY: does the stage 3 set's totalled table
# answer, and does its tally file exist on disk. Fires nothing.
set -uo pipefail
ID="${1:-s3-mtb7gy7e-1}"
echo "== the ranked table endpoint =="
curl -sS --max-time 30 "http://127.0.0.1:8094/api/stageset/$ID/ranked?from=0&n=1" | head -c 400; echo
echo "== the tally file on disk =="
ls -la /opt/ultimate-trading-system/data/stagesets/ | grep -i tally || echo "  (no tally file)"
echo "== the set document's tail =="
python3 -c "
import json
d = json.load(open('/opt/ultimate-trading-system/data/stagesets/$ID.json'))
print(' status:', d.get('status'), '| progress:', d.get('progress'))
print(' tallyError:', d.get('tallyError'))
print(' finishedAt:', d.get('finishedAt'))
"
