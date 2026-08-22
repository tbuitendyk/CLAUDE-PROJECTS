#!/usr/bin/env bash
# uts-run-detail.sh <run-id> -- READ-ONLY. Everything a saved run recorded about
# itself: what it was for, what it was asked to do, and how it ended.
#
# Written 2026-08-22. The owner typed a description into a sweep and it did not
# come back; the only way to tell whether it reached the run or was lost on the
# way is to read what the run actually holds.
set -uo pipefail
ID="${1:-}"
case "$ID" in
  ''|*[!A-Za-z0-9._-]*) echo "usage: uts-run-detail.sh <run-id>   (letters, digits, dot, dash, underscore)"; exit 2;;
esac
python3 - "/opt/ultimate-trading-system/data/batches/$ID.json" <<'PY'
import json,sys,os
p=sys.argv[1]
if not os.path.exists(p): print('no such run:', os.path.basename(p)); raise SystemExit(1)
d=json.load(open(p))
print('id         :', d.get('id'))
print('status     :', d.get('status'))
print('error      :', d.get('error'))
print('started    :', d.get('startedAt'), ' finished:', d.get('finishedAt'))
print('description:', repr(d.get('description')))
print('progress   :', repr(d.get('progress')))
print('plan       :', json.dumps(d.get('plan')))
print('perf       :', json.dumps(d.get('perf')))
print('failures   :', len(d.get('failures') or []))
for f in (d.get('failures') or [])[:5]: print('   ', json.dumps(f)[:300])
print('slimResults:', len(d.get('slimResults') or []))
print('leaders    :', len(d.get('leaders') or []))
print('edgeCensus :', len(d.get('edgeCensus') or []))
print('file bytes :', os.path.getsize(p))
prm=d.get('params') or {}
print('--- params ---')
for k in sorted(prm):
    v=prm[k]
    s=json.dumps(v)
    print(f'  {k:22} {s[:220]}{" …("+str(len(s))+" chars)" if len(s)>220 else ""}')
PY
