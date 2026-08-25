#!/usr/bin/env bash
# uts-planted-peek.sh -- READ-ONLY. What the planted check says and WHY.
# Prints the status strip's own answer (state + detail), then the latest
# gate readings with their rule-by-rule sentences, so a FAIL names the rule
# that failed. Changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 20 "$B/api/planted-gate/status" -o /tmp/uts-pg.json \
  || { echo "the status endpoint did not answer"; exit 1; }
python3 <<'PY'
import json
d = json.load(open('/tmp/uts-pg.json'))
print(f"state: {d.get('state')}  (engine {d.get('engineVersion')})")
print(f"detail: {d.get('detail')}")
if d.get('running'):
    print(f"a gate run is going right now: {d['running']}")
if d.get('unreadable'):
    print(f"unreadable gate records: {', '.join(d['unreadable'])}")
lg = d.get('lastGate')
if lg:
    print(f"\nlatest gate: {lg.get('id')}  engine {lg.get('engineVersion')}  "
          f"{'PASS' if lg.get('pass') else 'FAIL'}"
          f"{'  (run deleted; this is the kept record)' if lg.get('runDeleted') else ''}")
    print(f"finished: {lg.get('finishedAt')}")
    for s in (lg.get('sentences') or []):
        print(f"  {s}")
else:
    print("\nno finished gate reading exists")
PY
