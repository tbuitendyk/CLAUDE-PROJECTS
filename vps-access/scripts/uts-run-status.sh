#!/usr/bin/env bash
# uts-run-status.sh -- read-only. What runs exist on the box, what state each
# one is in, and whether any of them is still going. Written 2026-08-21 after a
# deploy restarted the service while a sweep may have been in flight: a restart
# kills the node process, and a run that was going is left recorded as running
# with nothing running it.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "== the campaign in use =="
cat "$D/campaign.json" 2>/dev/null || echo "  (none set)"
echo
echo "== saved runs =="
python3 - "$D" <<'PY'
import json,os,sys
d=sys.argv[1]; b=os.path.join(d,'batches')
if not os.path.isdir(b): print('  (no batches folder)'); raise SystemExit
files=[f for f in os.listdir(b) if f.endswith('.json')]
if not files: print('  (none)'); raise SystemExit
for f in sorted(files):
    try: doc=json.load(open(os.path.join(b,f)))
    except Exception as e: print(f'  {f}: UNREADABLE ({e})'); continue
    p=doc.get('params') or {}
    perf=doc.get('perf') or {}
    print(f"  {doc.get('id')}")
    print(f"    status   : {doc.get('status')}")
    print(f"    campaign : {p.get('campaign')!r}")
    print(f"    started  : {doc.get('startedAt')}   finished: {doc.get('finishedAt')}")
    print(f"    progress : phase={perf.get('phase')} unitsDone={perf.get('unitsDone')}/{perf.get('unitsTotal')} runsDone={perf.get('runsDone')}/{perf.get('runsTotal')}")
    print(f"    results  : {len(doc.get('runs') or [])} rows, {len(doc.get('leaders') or [])} on the board")
PY
echo
echo "== is anything actually running right now =="
systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value | sed 's/^/  service up since: /'
PID="$(systemctl show ultimate-trading-system -p MainPID --value)"
echo "  main pid: $PID"
ps -o pid,etime,pcpu,rss,cmd -p "$PID" 2>/dev/null | tail -n +2 | sed 's/^/  /'
echo "  worker threads / child node procs:"
pgrep -P "$PID" 2>/dev/null | sed 's/^/    child pid /' || echo "    (none)"
