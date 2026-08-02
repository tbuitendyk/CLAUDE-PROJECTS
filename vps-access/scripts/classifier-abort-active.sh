#!/usr/bin/env bash
# classifier-abort-active.sh -- owner-ordered stop of the ACTIVE batch job
# (POST /api/abort). Prints what was running first so the ledger shows
# exactly which job was stopped and at what progress. Finished units are
# kept by the engine; ticks and saved results are unaffected.
set -uo pipefail
B="http://127.0.0.1:8093"
echo "before:"
curl -sS --max-time 20 "$B/api/batches" | python3 -c "
import sys, json
bs = json.load(sys.stdin)['batches']
run = [b for b in bs if b['status'] == 'running']
if not run:
    print('  nothing running')
for b in run:
    print(f\"  {b['id']}  {b['runsDone']}/{b['runsTotal']} setups\")
"
curl -sS --max-time 20 -X POST "$B/api/abort"
echo
