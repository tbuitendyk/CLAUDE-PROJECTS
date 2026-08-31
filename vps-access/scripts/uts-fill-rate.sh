#!/usr/bin/env bash
# READ-ONLY. How fast the kept-scramble fill is actually going, and how many
# workers it is actually using. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
echo "== the set document's own progress =="
sudo -u uts python3 - <<'PY'
import json, glob, os, datetime
for f in sorted(glob.glob('data/stagesets/s3-*.json')):
    d = json.load(open(f))
    print(' ', os.path.basename(f), 'status:', d.get('status'))
    print('  progress:', d.get('progress'))
    p = d.get('perf') or {}
    for k in ('workers','unitsDone','unitsTotal','cyclesDone','cyclesTotal','elapsedMs','etaMs'):
        if k in p: print(f'   {k:<11}:', p[k])
    if p.get('elapsedMs') and p.get('cyclesDone'):
        rate = p['cyclesDone'] / (p['elapsedMs']/1000)
        print(f'   rate       : {rate:,.0f} pricings/second')
        left = (p.get('cyclesTotal',0) - p['cyclesDone']) / rate if rate else 0
        print(f'   left       : {left/3600:.1f} hours at that rate')
    bn = d.get('boardNull'); print('  boardNull:', json.dumps(bn) if bn else None)
PY
echo
echo "== how much of the machine it is taking, right now =="
top -bn1 | head -12
echo
echo "== the service's own threads =="
ps -L -o pid,tid,pcpu,comm -p "$(systemctl show -p MainPID --value ultimate-trading-system)" 2>/dev/null | head -12
