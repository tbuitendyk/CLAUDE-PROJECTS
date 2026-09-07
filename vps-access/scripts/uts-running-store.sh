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
for f in "$D/batches/$ID.rows" "$D/batches/$ID.rows.meta.json"; do
  [ -f "$f" ] && stat -c '   %n  %s bytes  last write %y' "$f"
done
python3 - "$D/batches/$ID.rows.meta.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print('   sidecar: rows %s   blocks %s   columns %s' % (m.get('rows'), len(m.get('blocks') or []), len(m.get('columns') or m.get('cols') or [])))
bl=m.get('blocks') or []
if bl: print('   last block: firstRow %s rows %s bytes %s' % (bl[-1].get('firstRow'), bl[-1].get('rows'), bl[-1].get('bytes')))
PY
ls -la "$D/batches/" | grep "$ID" | head
