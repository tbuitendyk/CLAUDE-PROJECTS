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
# The LIST row does not carry the stamps (it ships plan, counts and params
# only), so each set is fetched for the two fields that decide whether it can
# still be a parent. Read-only.
: > /tmp/uts-setdocs.jsonl
for id in $(python3 -c 'import json;print(" ".join(s["id"] for s in (json.load(open("/tmp/uts-sets.json")).get("sets") or [])))'); do
  curl -sf --max-time 25 "$B/api/stageset/$id" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin).get("set") or {}; o={k:d.get(k) for k in ("id","stage","status","name","engineVersion","measurements","progress","startedAt","createdAt")}; o["perf"]=d.get("perf"); print(json.dumps(o))' \
    >> /tmp/uts-setdocs.jsonl 2>/dev/null || true
done
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
    docs = {}
    try:
        for line in open('/tmp/uts-setdocs.jsonl'):
            r = json.loads(line); docs[r['id']] = r
    except Exception: pass
    print(f"  {'id':<28} {'stg':<4} {'status':<11} {'engine':<9} {'block':<6} name")
    for s in sets:
        d = docs.get(s.get('id'), {})
        print(f"  {str(s.get('id'))[:28]:<28} {str(s.get('stage')):<4} {str(s.get('status')):<11} "
              f"{str(d.get('engineVersion') or '?'):<9} {str(d.get('measurements') or '?'):<6} {str(s.get('name'))[:40]}")
    print()
    by = {}
    for s in sets:
        by.setdefault((s.get('engineVersion'), s.get('measurementsVersion')), []).append(s)
    by = {}
    for s in sets:
        d = docs.get(s.get('id'), {})
        by.setdefault((d.get('engineVersion'), d.get('measurements')), []).append(s)
    for (ev, mv), rows in sorted(by.items(), key=lambda kv: str(kv[0])):
        note = ''
        # THE SAME RULE THE ENGINE USES, not a stricter one. lib/stages.js
        # compares the FIRST digit only -- that digit is defined as "anything
        # that makes yesterday's records refuse" -- so a script that compares
        # the whole string reports work as lost when it is fine. This one said
        # exactly that about two good record sets minutes after the engine
        # stopped agreeing with it.
        major = lambda v: (str(v or '').split('.') + [''])[0]
        if cur and ev and major(ev) != major(cur):
            note = ' -- REFUSED as a parent: a different first digit'
        elif cur and ev:
            note = f' -- usable as a parent (engine {ev} and {cur} share a first digit)'
        print(f"  engine {ev or '-'} / block {mv or '-'}: {len(rows)} set(s){note}")
    # WHAT A RUNNING JOB IS ACTUALLY DOING, and how fast. Read-only: the rate
    # is worked out here from what the set has already written, so a long job
    # can be judged before the screen that shows it has been deployed.
    if running:
        r = docs.get(running) or {}
        pf = r.get('perf') or {}
        print()
        print(f"  RUNNING {running}: {r.get('progress') or '(no progress line yet)'}")
        done = pf.get('unitsDone'); total = pf.get('unitsTotal'); el = pf.get('elapsedMs')
        started = r.get('startedAt') or r.get('createdAt')
        print(f"    started {started}   workers {pf.get('workers')}")
        if el:
            print(f"    {round(el/60000)} min into the priced pass")
        if done and total and el:
            per = el/done
            left = per*(total-done)
            import datetime
            ends = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(milliseconds=left)
            print(f"    {done} of {total} units at {round(per/60000,1)} min each -> about {round(left/60000)} min left, lands ~{ends.strftime('%H:%M')} UTC")
        elif total:
            print(f"    0 of {total} units finished, so there is no rate to measure yet")
PY
