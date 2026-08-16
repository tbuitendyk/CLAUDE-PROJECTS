#!/usr/bin/env bash
# classifier-live-diag.sh -- READ-ONLY: why is the live rail quiet? Prints the
# arm/halt state, the newest journal + decision + stand-down stamps, the recent
# incident kinds, the producer/push timer state and their last runs. No writes,
# no orders, no job interaction.
set -uo pipefail
APPDIR=/opt/general-classifier

echo "== now =="
date -u +'%Y-%m-%dT%H:%M:%SZ'

echo
echo "== /api/pilot summary =="
curl -sS -m 20 http://127.0.0.1:8093/api/pilot | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('present:', d.get('present'))
print('armed:', d.get('armed'), '| halted:', d.get('halted'), '| haltReason:', d.get('haltReason'))
print('armRequest:', json.dumps(d.get('armRequest')))
print('armPending:', d.get('armPending'))
print('journalSyncedUtc:', d.get('journalSyncedUtc'))
m = d.get('mirror') or {}
print('mirror:', json.dumps({k: m.get(k) for k in ('utc','ok','checked','breaks','note') if k in m}))
pv = d.get('previewDecision')
print('preview:', json.dumps(pv)[:300] if pv else None)
fr = d.get('dataFreshness') or []
for f in fr:
    print('  data', f.get('symbol'), 'through', f.get('throughUtc'), 'ageH', f.get('closedAgeHours'), 'stale', f.get('stale'))
dec = d.get('decisions') or []
print('decisions n=%d' % len(dec))
for x in dec[-8:]:
    print('  ', json.dumps(x)[:240])
inc = d.get('incidents') or []
print('incidents n=%d' % len(inc))
for x in inc[-10:]:
    print('  ', json.dumps(x)[:240])
op = d.get('openPositions') or []
print('openPositions n=%d' % len(op))
for x in op:
    print('  ', json.dumps(x)[:240])
ls = (d.get('liveStatus') or {}).get('items') or []
for x in ls:
    print('  next:', x.get('what'), '|', x.get('whenUtc'), '|', (x.get('why') or '')[:150])
" 2>&1 | sed 's/^/  /'

echo
echo "== pilot data files (mtime, size) =="
for f in journal.jsonl preview.json mirror.json arm-request.json stop-sweep.json; do
  p="$APPDIR/data/pilot/$f"
  if [ -f "$p" ]; then
    printf '  %-20s %s  %s bytes\n' "$f" "$(date -u -r "$p" +'%Y-%m-%dT%H:%M:%SZ')" "$(stat -c %s "$p")"
  else
    printf '  %-20s MISSING\n' "$f"
  fi
done
echo "  decisions dir:  $(ls -1 $APPDIR/data/pilot/decisions 2>/dev/null | wc -l) files, newest: $(ls -1t $APPDIR/data/pilot/decisions 2>/dev/null | head -1)"
echo "  standdowns dir: $(ls -1 $APPDIR/data/pilot/standdowns 2>/dev/null | wc -l) files, newest: $(ls -1t $APPDIR/data/pilot/standdowns 2>/dev/null | head -1)"
echo "  journal tail:"
tail -6 "$APPDIR/data/pilot/journal.jsonl" 2>/dev/null | cut -c1-220 | sed 's/^/    /'

echo
echo "== timers =="
systemctl list-timers --all --no-pager 2>/dev/null | grep -Ei 'pilot|classifier|live' | sed 's/^/  /'

echo
echo "== last producer/push runs =="
for u in pilot-produce-and-push.service pilot-produce.service live-produce-and-push.service; do
  st=$(systemctl show -p ExecMainStartTimestamp -p Result --value "$u" 2>/dev/null | tr '\n' ' ')
  [ -n "${st// /}" ] && printf '  %-34s %s\n' "$u" "$st"
done
echo "  --- journalctl (last 40 lines, pilot units) ---"
journalctl -u 'pilot-produce*' -u 'live-produce*' --no-pager -n 40 2>/dev/null | cut -c1-200 | sed 's/^/    /'

echo "(read-only)"
