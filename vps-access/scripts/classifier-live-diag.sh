#!/usr/bin/env bash
# classifier-live-diag.sh -- READ-ONLY: why is the live rail quiet? Prints the
# arm/halt state, the newest journal + decision + stand-down stamps, the recent
# incident kinds, the producer/push timer state and their last runs. No writes,
# no orders, no job interaction.
set -uo pipefail
APPDIR=/opt/general-classifier

echo "== now =="
date -u +'%Y-%m-%dT%H:%M:%SZ'

# EVERY LIVE PROFILE, from its own status endpoint. This script used to read
# only the box endpoint, which reports the MACHINE (armed, halted, wallet) and
# knows nothing about what any profile decided. After the book moved to a
# profile it printed "decisions n=0" while the profile's screen held the whole
# history — the diagnostic looked broken because it was pointed at the wrong
# thing.
echo
echo "== live profiles =="
curl -sS -m 20 http://127.0.0.1:8093/api/live/setups | python3 -c "
import sys, json, urllib.request
d = json.load(sys.stdin)
rows = [s for s in d.get('setups', []) if s.get('state') in ('paper', 'live', 'stopped')]
if not rows:
    print('  none')
for s in rows:
    print(f\"  {s['id']}  {s['state']}  {s['name']}\")
    try:
        with urllib.request.urlopen(
                'http://127.0.0.1:8093/api/live/setups/' + s['id'] + '/status', timeout=20) as r:
            st = json.load(r)
    except Exception as e:
        print(f'    status unreadable: {e}'); continue
    op = st.get('openPositions') or []
    print(f\"    decisions {len(st.get('decisions') or [])}  open {len(op)}  \"
          f\"closed {len(st.get('closedRecent') or [])}  halted {st.get('halted')}\")
    for p in op:
        print(f\"    OPEN {p.get('side')} qty {p.get('qty')} entry {p.get('entry_utc')} \"
              f\"wallet {p.get('key_ref') or '(shared)'}\")
    for dec in (st.get('decisions') or [])[:4]:
        print(f\"    DEC  {str(dec.get('entry_utc'))[:16]}  {dec.get('side')}  \"
              f\"votes {dec.get('votes')}  {dec.get('fate')}\")
"

echo
echo "== the box (machine-level: armed, halted, wallet) =="
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
# Decisions are per PROFILE now: one append-only JSONL each under data/live,
# not a shared directory of one file per day. Counting files in the old
# directory reported 0 for a perfectly healthy system.
echo "  decisions: $(ls -1 $APPDIR/data/live/decisions/*.jsonl 2>/dev/null | wc -l) profile file(s), newest: $(ls -1t $APPDIR/data/live/decisions/*.jsonl 2>/dev/null | head -1 | xargs -r basename)"
# NO-TRADE DAYS ARE NOT RECORDED (open gap, 2026-08-19). live-produce.js writes a
# decision record only when the call is actionable and not FLAT, so a day the
# committee declined to trade leaves nothing behind and is indistinguishable
# from a day the tick never ran. The retired rail had a backfiller for exactly
# this; the replacement has no equivalent yet.
for f in $APPDIR/data/live/decisions/*.jsonl; do
  [ -e "$f" ] || continue
  echo "    $(basename "$f" .jsonl): $(wc -l < "$f") recorded call(s) — trade days only, see note above"
done
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
