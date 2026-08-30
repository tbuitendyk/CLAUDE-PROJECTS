#!/usr/bin/env bash
# uts-drop-stale-agreed.sh -- ONE-OFF REPAIR. Deletes the stage 3 answers file
# that was rebuilt while the same-trade fold was dropping one of the two quorum
# bars, so it holds only half of what it should. It is a DERIVED file: the next
# time the tables are opened it is worked out again from the stage 2 parent's
# kept votes. No record is touched.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
for f in "$D"/s3-*-agreed.json.gz; do
  [ -e "$f" ] || continue
  python3 -c "
import gzip,json,collections
m=json.load(gzip.open('$f'))['map']
bars=collections.Counter(k.split('|')[3] for k in m)
print('  $f')
print('    entries', len(m), ' by bar', dict(bars))
"
  rm -f "$f" && echo "    deleted — it will be worked out again when the tables are next opened"
done
echo
echo "== what is left beside the set =="
ls -la "$D"/s3-*-tally.json.gz "$D"/s3-*-agreed.json.gz 2>/dev/null || echo "  no derived files: both will rebuild"
echo "== the records themselves, untouched =="
python3 -c "
import json
m=json.load(open('/opt/ultimate-trading-system/data/batches/s3-mte0oajo-1.rows/records.jsonl.gz.meta.json'))
b=m.get('blocks') or []
print('  blocks', len(b), ' rows', sum(x.get('rows',0) for x in b))
"
