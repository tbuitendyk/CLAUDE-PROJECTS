#!/usr/bin/env bash
# uts-sets-and-versions.sh -- READ-ONLY. Which record sets are on this box, what
# engine release and measurement block each was written under, and what a change
# to either would refuse. Changes nothing.
#
# Why it exists: a stage launch refuses a parent written by a different engine
# release, and refuses one built on an older measurement block. So bumping the
# release strands every set already on disk, and the only honest way to say how
# much that costs is to count them first.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-sets.json \
  || { echo "the record-set list did not answer"; exit 1; }
curl -sf --max-time 25 "$B/api/planted-gate/status" -o /tmp/uts-pg2.json 2>/dev/null || true
python3 <<'PY'
import json, os
d = json.load(open('/tmp/uts-sets.json'))
sets = d.get('sets') or []
running = d.get('running')
cur = None
if os.path.exists('/tmp/uts-pg2.json'):
    try: cur = json.load(open('/tmp/uts-pg2.json')).get('engineVersion')
    except Exception: cur = None
print(f"this box runs engine {cur or '(could not read)'}")
print(f"{len(sets)} record set(s) on disk" + (f"; {running} is running right now" if running else "; nothing running"))
if not sets:
    print("nothing would be stranded by a release bump.")
else:
    print()
    print(f"  {'id':<28} {'stg':<4} {'status':<11} {'engine':<9} {'block':<6} name")
    for s in sets:
        print(f"  {str(s.get('id'))[:28]:<28} {str(s.get('stage')):<4} {str(s.get('status')):<11} "
              f"{str(s.get('engineVersion') or '-'):<9} {str(s.get('measurementsVersion') or '-'):<6} {str(s.get('name'))[:40]}")
    print()
    by = {}
    for s in sets:
        by.setdefault((s.get('engineVersion'), s.get('measurementsVersion')), []).append(s)
    for (ev, mv), rows in sorted(by.items(), key=lambda kv: str(kv[0])):
        note = ''
        if cur and ev and ev != cur:
            note = ' -- ALREADY refused as a parent (different engine release)'
        elif cur and ev == cur:
            note = ' -- would be refused as a parent the moment the release changes'
        print(f"  engine {ev or '-'} / block {mv or '-'}: {len(rows)} set(s){note}")
PY
