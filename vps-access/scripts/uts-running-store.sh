#!/usr/bin/env bash
# uts-running-store.sh -- READ-ONLY. The record store of the stage set running
# right now: bytes on disk, rows and blocks its sidecar says are complete, and
# when it was last written. Writes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data
ID=$(python3 -c "
import json,glob
for f in glob.glob('$D/stagesets/s3-*.json'):
    d=json.load(open(f))
    if d.get('status')=='running': print(d['id']); break
")
[ -n "$ID" ] || { echo "nothing running"; exit 0; }
date -u +"now %Y-%m-%dT%H:%M:%SZ"
# the store is a DIRECTORY per set, one file per store inside it
S="$D/batches/$ID.rows"
[ -d "$S" ] || { echo "no store directory $S"; exit 0; }
ls -la --time-style=+%Y-%m-%dT%H:%M:%SZ "$S" | tail -n +2
python3 - "$S" <<'PY2'
import json,sys,os,glob
S=sys.argv[1]
for f in sorted(glob.glob(os.path.join(S,'*.meta.json'))):
    m=json.load(open(f))
    bl=m.get('blocks') or []
    print('   %s: rows %s   blocks %s%s' % (os.path.basename(f), m.get('rows'), len(bl), ('   last block firstRow %s rows %s' % (bl[-1].get('firstRow'), bl[-1].get('rows'))) if bl else ''))
PY2
