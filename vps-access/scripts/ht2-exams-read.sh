#!/usr/bin/env bash
# ht2-exams-read.sh -- read-only: exam-gate status + every HT v2 run's
# stamped verdict.
set -uo pipefail
echo "== exam gate =="
curl -s http://127.0.0.1:8093/api/httwo/exams
echo; echo "== runs =="
cd /opt/general-classifier
for f in $(ls -t data/batches/httwo-*.json 2>/dev/null | head -6); do
  ID=$(basename "$f" .json)
  echo "-- $ID"
  python3 -c "import json;d=json.load(open('$f'));print('   status',d['status'],'| progress',repr(d.get('progress','')),'| folds',len(d.get('foldRows') or []),'| failures',len(d.get('failures') or []))"
  curl -s "http://127.0.0.1:8093/api/httwo/$ID/verdict" | head -c 900
  echo
done
