#!/usr/bin/env bash
# uts-reserve-dollars.sh -- READ-ONLY. The newest reserve grade on the Stage 4
# record set: its verdict sentence, its totals, and what every one of the
# set's setups made on the sealed window, in dollars. Presses nothing, spends
# no look.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-rd-sets.json || { echo "the record-set list did not answer"; exit 1; }
IDS=$(python3 -c 'import json;print(" ".join(s["id"] for s in (json.load(open("/tmp/uts-rd-sets.json")).get("sets") or []) if s.get("stage")==4))')
for ID in $IDS; do
  curl -sf --max-time 90 "$B/api/funnel/set/$ID/unread" -o /tmp/uts-rd-dry.json || { echo "$ID: the dry read did not answer"; continue; }
  python3 - <<'PY'
import json, datetime
d = json.load(open('/tmp/uts-rd-dry.json'))
gs = d.get('grades') or []
print('== %s | %s' % (d.get('name'), d.get('unitName') or d.get('unit')))
if not gs:
    print('   no reserve grade stamped on this set'); raise SystemExit(0)
g = gs[0]
w = g.get('window') or {}
def day(ts):
    try: return datetime.datetime.utcfromtimestamp(int(ts)/1000).strftime('%Y-%m-%d')
    except Exception: return '?'
print('   grade %s, look %s, stamped %s, release %s' % (g.get('id'), g.get('look'), (g.get('at') or '')[:19], g.get('release')))
print('   window %s to %s, %s chunks; the box held prices to %s' % (day(w.get('fromTs')), day(w.get('toTs')), w.get('chunks'), day(w.get('seenToTs'))))
rows = g.get('rows') or []
vals = [r for r in rows if isinstance(r.get('money'), (int, float))]
pos = [r for r in vals if r['money'] > 0]
neg = [r for r in vals if r['money'] < 0]
tot = sum(r['money'] for r in vals)
print('   %d setups priced (%d of them with a figure): %d positive, %d negative, %d flat'
      % (len(rows), len(vals), len(pos), len(neg), len(vals) - len(pos) - len(neg)))
print('   total %s, average %s per setup'
      % (('-$%.2f' % -tot) if tot < 0 else ('$%.2f' % tot),
         ('-$%.2f' % -(tot/len(vals))) if vals and tot/len(vals) < 0 else ('$%.2f' % (tot/len(vals)) if vals else 0)))
r = g.get('read') or {}
c = g.get('copies') or {}
print('   the reading: %s a setting; beats %s of %s scrambled copies, bar %s; verdict %s'
      % (r.get('real'), c.get('beats'), c.get('copies'), c.get('bar'), 'PASS' if (g.get('verdict') or {}).get('pass') else 'FAIL'))
print('   %s' % (g.get('verdict') or {}).get('sentence', '')[:600])
if g.get('missing'): print('   NOT PRICED (%d): %s' % (len(g['missing']), ', '.join(g['missing'][:6])))
print()
print('   %-58s %12s %8s %8s' % ('setup', 'reserve $', 'trades', 'stops'))
def money(v): return '-$%.2f' % -v if isinstance(v,(int,float)) and v < 0 else ('$%.2f' % v if isinstance(v,(int,float)) else '-')
for x in sorted(rows, key=lambda r: (r.get('money') is None, -(r.get('money') or 0))):
    print('   %-58s %12s %8s %8s' % (str(x.get('label'))[:58], money(x.get('money')), x.get('trades'), x.get('stops')))
PY
done
