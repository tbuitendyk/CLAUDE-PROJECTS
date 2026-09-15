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
