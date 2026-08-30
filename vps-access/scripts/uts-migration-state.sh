#!/usr/bin/env bash
# uts-migration-state.sh -- READ-ONLY. Exactly where the record migration got
# to, and whether anything is missing. Reads; changes nothing at all.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "== every directory that could hold the stage 3 records =="
ls -la "$D/batches" 2>/dev/null | grep -i "s3-" || echo "  (nothing matching s3- in batches)"
echo
for dir in "$D"/batches/s3-*; do
  [ -d "$dir" ] || continue
  echo "  $dir"
  du -sh "$dir" 2>/dev/null | awk '{print "    size "$1}'
  ls -la "$dir" | tail -n +2 | awk '{print "    "$5" "$9}' | grep -v '^\s*[0-9]* \.$' | head -8
  m="$dir/records.jsonl.gz.meta.json"
  [ -f "$m" ] && python3 -c "
import json
m=json.load(open('$m'))
b=m.get('blocks') or []
print('    blocks', len(b), ' rows', sum(x.get('rows',0) for x in b))
" || echo "    (no meta sidecar)"
done
echo
echo "== the set document =="
python3 -c "
import json,glob
for f in sorted(glob.glob('$D/stagesets/s3-*.json')):
    d=json.load(open(f))
    pl=d.get('plan') or {}; p=d.get('params') or {}
    labs=pl.get('settingLabels') or []
    print(' ', d.get('id'), 'status', d.get('status'), 'recordsVersion', d.get('recordsVersion'))
    print('    tallyError:', d.get('tallyError'))
    print('    params agreeBar', repr(p.get('agreeBar')), 'agreePermuteBar', repr(p.get('agreePermuteBar')))
    print('    settingLabels', len(labs), 'of which retired-name', sum(1 for l in labs if l.startswith('unusual ')))
"
echo
echo "== derived files =="
ls -la "$D"/stagesets/*-tally.json.gz "$D"/stagesets/*-agreed.json.gz 2>/dev/null || echo "  (none — both deleted)"
echo
echo "== is anything running =="
curl -sf --max-time 20 http://127.0.0.1:8094/api/stagesets | python3 -c "
import json,sys; d=json.load(sys.stdin); print('  running:', d.get('running'))" 2>/dev/null || echo "  (no answer)"
echo "== service =="
systemctl is-active ultimate-trading-system 2>/dev/null || true
journalctl -u ultimate-trading-system --since "-40 min" --no-pager 2>/dev/null | grep -iE "migrat|error|throw|Cannot|ENOENT" | tail -12 || echo "  (no matching log lines)"
