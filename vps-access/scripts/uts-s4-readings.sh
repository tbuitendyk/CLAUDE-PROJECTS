#!/usr/bin/env bash
# uts-s4-readings.sh -- READ-ONLY. Every Stage 4 record set on this box and
# every reading stamped on it: the verdict blocks, the reserve grades, the
# other-units readings, the dropped readings, the rides, the half-life runs,
# the capture, the stop choices, and its parent's window layout. Written for
# the Held/Reserve build (VERIFY-DESIGN.md Part 9), so the migration of those
# stamps into held sets and reserve sets is planned from what is on disk and
# not from memory. Changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
python3 - "$D" <<'PY'
import json, os, sys, glob
D = sys.argv[1]
def load(p):
    try: return json.load(open(p))
    except Exception as e: return None
files = sorted(glob.glob(os.path.join(D, 's4-*.json')))
print(f'{len(files)} Stage 4 file(s) in {D}')
for f in files:
    doc = load(f)
    if not doc: print(f'{os.path.basename(f)}: unreadable'); continue
    if doc.get('stage') != 4: continue
    par = load(os.path.join(D, str((doc.get('parent') or {}).get('id')) + '.json'))
    layout = ((par or {}).get('params') or {}).get('windowLayout')
    d = doc.get('derived')
    print(f"== {doc.get('id')} | {doc.get('name')} | kind {doc.get('kind')} | release {doc.get('release')} | unit {doc.get('unit')} | survivors {(doc.get('counts') or {}).get('survivors')} | exam {bool(doc.get('exam'))}")
    print(f"   parent {(doc.get('parent') or {}).get('id')} layout {layout} | derived {json.dumps({k: d.get(k) for k in ('kind','from','run','judge','layout')}) if d else None}")
    # a held set or a reserve set (3.147.0): what it was read from, its number, what it stands on, its one block
    if doc.get('kind') in ('held', 'reserve'):
        b = doc.get('block') or {}
        so = doc.get('standsOn')
        print(f"   from {(doc.get('from') or {}).get('id')} ({(doc.get('from') or {}).get('kind')}) number {doc.get('number')} createdAt {str(doc.get('createdAt'))[:16]} | standsOn {so.get('id') if so else None}")
        print(f"   block {b.get('id')} look {b.get('look')} at {str(b.get('at'))[:16]} rel {b.get('release')} {'PASS' if (b.get('verdict') or {}).get('pass') else 'FAIL'} stretch {b.get('stretch')} read={'yes' if b.get('read') else 'no'} own={'yes' if (b.get('read') or {}).get('own') else 'no'} priced={len(b.get('priced') or []) if b.get('priced') is not None else None} heldBack-left={'heldBack' in b} rows-left={'rows' in b} gate-left={'gate' in b} | stopChoices {len(doc.get('stopChoices') or {})}")
        # every key the block carries, so a field today's blocks do not write is seen by name, not guessed
        print(f"   block keys: {sorted(b.keys())}")
        sv = (b.get('survivors') or {}).get('rows') or []
        print(f"   survivors rows {len(sv)}; first row keys: {sorted(sv[0].keys()) if sv else None}")
        print(f"   read keys: {sorted((b.get('read') or {}).keys())}")
    rd = doc.get('readings') or {}
    if rd:
        print("   readings: " + ' | '.join(f"{st}: others {len((rd.get(st) or {}).get('others') or [])}, dropped {len((rd.get(st) or {}).get('dropped') or [])}, ride {len((rd.get(st) or {}).get('ride') or [])}" for st in ('held', 'reserve')))
        for st in ('held', 'reserve'):
            for k in ('others', 'dropped', 'ride'):
                for x in ((rd.get(st) or {}).get(k) or []):
                    if not isinstance(x, dict): continue
                    rows = x.get('rows') or x.get('units') or []
                    r0 = rows[0] if rows and isinstance(rows[0], dict) else None
                    print(f"   reading {st}/{k} at {str(x.get('at'))[:16]} rel {x.get('release')} keys {sorted(x.keys())} | first row keys {sorted(r0.keys()) if r0 else None}")
    v = doc.get('verify') or []
    print(f"   verify blocks {len(v)}: " + '; '.join(f"{b.get('id')} look {b.get('look')} at {str(b.get('at'))[:16]} rel {b.get('release')} {'PASS' if (b.get('verdict') or {}).get('pass') else 'FAIL'} own={'yes' if (b.get('heldBack') or {}).get('own') else 'no'}" for b in v))
    u = doc.get('unread') or []
    print(f"   reserve grades {len(u)}: " + '; '.join(f"{b.get('id')} look {b.get('look')} at {str(b.get('at'))[:16]} rel {b.get('release')} {'PASS' if (b.get('verdict') or {}).get('pass') else 'FAIL'}" for b in u))
    for k in ('others', 'dropped', 'ride', 'halflife', 'heldBackLooks'):
        lst = doc.get(k) or []
        print(f"   {k} {len(lst)}: " + '; '.join(f"{str(x.get('at') or x.get('ts') or '')[:16]} rel {x.get('release')}" for x in lst if isinstance(x, dict)))
    cap = doc.get('capture')
    print(f"   capture: {json.dumps({k: cap.get(k) for k in ('at','release','captured','survivors')}) if cap else None} | stopChoices {len(doc.get('stopChoices') or {})} | heldBackReadAt {doc.get('heldBackReadAt')} | sealed {'yes' if doc.get('sealed') else 'no'} | rich {'yes' if doc.get('rich') else 'no'}")
PY
