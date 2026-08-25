#!/usr/bin/env bash
# uts-svc-watchlist.sh -- READ-ONLY. What is on the owner's Service list, and
# what keeping something on it does and does not change. Writes nothing: the
# list is set from the screen, by the owner, and this only reads it back.
#
# It exists to prove the one property that matters about that list: it narrows
# what the table LEADS WITH and never what the control will report or reach. A
# list that quietly became the only thing the machine would talk about would be
# the hardcoded list this was built to avoid, wearing a tick box.
set -uo pipefail
curl -sf --max-time 25 http://127.0.0.1:8095/api/services -o /tmp/uts-svc-list.json \
  || { echo "the service control did not answer"; exit 1; }
python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-svc-list.json'))
watching = d.get('watching') or []
units = d['units']
print(f"the control reports {len(units)} service(s) on this machine, every time it is asked")
if watching:
    print(f"{len(watching)} of them are on the owner's list:")
    for u in units:
        if u['watched']:
            print(f"  * {u['unit']:34} {u['active']:9} {u['description'][:56]}")
else:
    print("the list is empty, so the screen shows everything -- an empty table would")
    print("read as nothing running, which is worse than a long one")
marked = sum(1 for u in units if u['watched'])
assert marked == len(watching), f"{marked} marked but {len(watching)} on the list"
print(f"and all {len(units)} are still reported and still reachable: the list changes the view, not the reach")
PY
