#!/usr/bin/env bash
# uts-fillin-why.sh -- READ-ONLY. Did the fill-in start, is it going, did it
# die, and did anything reach disk? Reads and prints; changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data

echo "== the clock =="
date -u '+  now              %Y-%m-%d %H:%M:%S UTC'
systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value | sed 's/^/  service started  /'

echo
echo "== what the service says about the fill-in, per set =="
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "  $ID"
  curl -sf --max-time 20 "$B/api/stageset/$ID/fill-in/status" | sed 's/^/    status  /' || echo "    (no answer)"
done

echo
echo "== is a worker actually burning CPU =="
ps -o pid,etime,pcpu,rss,args -C node --sort=-pcpu 2>/dev/null | head -12 || echo "  (no node processes)"

echo
echo "== the records store on disk =="
for dir in "$D"/batches/s3-*; do
  [ -d "$dir" ] || continue
  echo "  $dir"
  for f in "$dir"/records*; do
    [ -f "$f" ] || continue
    stat -c '    %-46n %10s bytes   last written %y' "$f"
  done
  m="$dir/records.jsonl.gz.meta.json"
  [ -f "$m" ] && python3 -c "
import json
m=json.load(open('$m')); b=m.get('blocks') or []
print('    blocks %d  rows %d' % (len(b), sum(x.get('rows',0) for x in b)))"
done

echo
echo "== the set document: what it holds and what it has recorded =="
python3 - "$D" <<'PY'
import json, glob, sys, os
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'stagesets', 's3-*.json'))):
    d = json.load(open(f))
    pl = d.get('plan') or {}
    labs = pl.get('settingLabels') or []
    print(' ', d.get('id'), 'status', d.get('status'))
    print('    setting names held', len(labs))
    print('    appends recorded  ', json.dumps(d.get('appends'))[:300])
    print('    recordsVersion    ', d.get('recordsVersion'), ' release', d.get('release'))
PY

echo
echo "== anything the service logged about it =="
journalctl -u ultimate-trading-system --since '6 hours ago' --no-pager 2>/dev/null \
  | grep -iE 'fill|append|heap|out of memory|abort|unhandled|rejection|Error|error:' \
  | tail -40 || echo "  (nothing in the journal)"

echo
echo "== and the last of the journal whatever it says =="
journalctl -u ultimate-trading-system --since '6 hours ago' --no-pager 2>/dev/null | tail -25
