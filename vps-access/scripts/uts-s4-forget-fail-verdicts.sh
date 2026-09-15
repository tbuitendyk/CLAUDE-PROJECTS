#!/usr/bin/env bash
# uts-s4-forget-fail-verdicts.sh <s4-set-id|all> -- OWNER ORDER 2026-09-15:
# "blow away *permanently* all of those fake 'Fail' verdicts that are stored
# and i'm going to re-run them with the fair comparison." Removes every
# verdict block stamped FAIL from the named Stage 4 record set (or from every
# one on the box); a block stamped PASS stays. Nothing else on the set is
# touched: the walk, the rule, the looks already counted, the other readings.
# The service reads each set off disk on every request, so the file is
# rewritten in place, atomically. NO BACKUP, by the owner's word "permanently".
# What was removed is printed, so the record of the deletion is the output.
set -uo pipefail
who="${1:?set id, or all}"
D=/opt/ultimate-trading-system/data/stagesets
B=http://127.0.0.1:8094
busy=$(curl -sf --max-time 20 "$B/api/stagesets" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("running") or "")' 2>/dev/null || true)
[ -n "$busy" ] && { echo "refused: the box is busy ($busy) — nothing removed"; exit 1; }
python3 - "$D" "$who" <<'PY'
import json, os, sys, glob
D, who = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(D, 's4-*.json'))) if who == 'all' else [os.path.join(D, who + '.json')]
total = 0
for f in files:
    try:
        doc = json.load(open(f))
    except Exception as e:
        print(f'{os.path.basename(f)}: unreadable ({e}) — untouched'); continue
    if doc.get('stage') != 4:
        continue
    blocks = doc.get('verify') or []
    fails = [b for b in blocks if not ((b.get('verdict') or {}).get('pass'))]
    if not fails:
        print(f'{doc.get("id")} | {doc.get("name")}: {len(blocks)} block(s), none stamped FAIL — untouched'); continue
    keep = [b for b in blocks if (b.get('verdict') or {}).get('pass')]
    doc['verify'] = keep
    tmp = f + '.tmp-forget'
    with open(tmp, 'w') as out:
        json.dump(doc, out)
    os.replace(tmp, f)
    total += len(fails)
    print(f'{doc.get("id")} | {doc.get("name")}: removed {len(fails)} FAIL block(s), kept {len(keep)}')
    for b in fails:
        print(f'   gone: {b.get("id")} look {b.get("look")} at {b.get("at")} release {b.get("release")} :: {((b.get("verdict") or {}).get("sentence") or "")[:160]}')
print(f'removed {total} FAIL verdict block(s) in all')
PY
