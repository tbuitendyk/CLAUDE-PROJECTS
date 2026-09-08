#!/usr/bin/env bash
# uts-reserve-dollars.sh -- READ-ONLY. The newest reserve grade on the Stage 4
# record set: what every one of its setups made on the sealed window, in
# dollars. Setups that price the identical trade are grouped, because the fold
# means many share one figure; the count says how many. The summary and the
# verdict are printed LAST, since the caller keeps only the tail. Presses
# nothing, spends no look.
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
if not gs:
    print('no reserve grade stamped on this set'); raise SystemExit(0)
g = gs[0]
rows = g.get('rows') or []
def m(v):
    if not isinstance(v, (int, float)): return '-'
    return ('-$%.2f' % -v) if v < 0 else ('$%.2f' % v)
groups = {}
for r in rows:
    k = (r.get('money'), r.get('trades'), r.get('stops'))
    groups.setdefault(k, []).append(str(r.get('label')))
print('%10s %7s %6s  %5s  %s' % ('reserve $', 'trades', 'stops', 'setups', 'one of them'))
for (money, trades, stops), labels in sorted(groups.items(), key=lambda kv: (kv[0][0] is None, -(kv[0][0] or 0))):
    print('%10s %7s %6s  %5d  %s' % (m(money), trades, stops, len(labels), labels[0][:52]))
vals = [r['money'] for r in rows if isinstance(r.get('money'), (int, float))]
pos = [v for v in vals if v > 0]; neg = [v for v in vals if v < 0]
tot = sum(vals)
w = g.get('window') or {}
def day(ts):
    try: return datetime.datetime.utcfromtimestamp(int(ts)/1000).strftime('%Y-%m-%d')
    except Exception: return '?'
r = g.get('read') or {}; c = g.get('copies') or {}; sv = g.get('survivors') or {}
print()
print('SET      %s | %s' % (d.get('name'), d.get('unitName') or d.get('unit')))
print('GRADE    %s, look %s, stamped %s, release %s' % (g.get('id'), g.get('look'), (g.get('at') or '')[:19], g.get('release')))
print('WINDOW   %s to %s, %s chunks; the box held prices to %s' % (day(w.get('fromTs')), day(w.get('toTs')), w.get('chunks'), day(w.get('seenToTs'))))
print('SETUPS   %d priced, %d with a figure: %d made money, %d lost, %d flat; %d distinct figures'
      % (len(rows), len(vals), len(pos), len(neg), len(vals) - len(pos) - len(neg), len(set(round(v, 2) for v in vals))))
print('DOLLARS  total %s | average %s a setup | best %s | worst %s'
      % (m(tot), m(tot / len(vals)) if vals else '-', m(max(vals)) if vals else '-', m(min(vals)) if vals else '-'))
print('READING  %s a setting; beats %s of %s scrambled copies, bar %s; %s of %s setups clear their own bar, about %s would by chance'
      % (m(r.get('real')), c.get('beats'), c.get('copies'), c.get('bar'), sv.get('passing'), sv.get('survivors'),
         (('%.1f' % sv['byChance']) if isinstance(sv.get('byChance'), (int, float)) else '?')))
if g.get('missing'): print('NOT PRICED %d: %s' % (len(g['missing']), ', '.join(g['missing'][:5])))
print('VERDICT  %s' % ('PASS' if (g.get('verdict') or {}).get('pass') else 'FAIL'))
PY
done
