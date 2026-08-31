#!/usr/bin/env bash
# READ-ONLY. The stage 3 set document as it sits on disk: the parameters the run
# used and how long it took, so a backfill is sized from the real run.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts python3 - <<'PY'
import json, glob, os
for f in sorted(glob.glob('data/stagesets/s3-*.json')):
    d = json.load(open(f))
    print('==', os.path.basename(f))
    p = d.get('params') or {}
    print('  nullN        :', p.get('nullN'))
    print('  fee          :', p.get('fee'))
    print('  windowLayout :', p.get('windowLayout'))
    print('  plan         :', json.dumps(d.get('plan') or {}))
    perf = d.get('perf') or {}
    print('  perf keys    :', ', '.join(sorted(perf.keys())))
    for k in ('elapsedMs','unitsDone','unitsTotal','workers','cyclesDone','cyclesTotal','cyclesWord'):
        if k in perf: print(f'  {k:<13}:', perf[k])
    if perf.get('elapsedMs'):
        print('  THE RUN TOOK :', round(perf['elapsedMs']/3600000, 2), 'hours')
    print('  startedAt    :', d.get('startedAt'), ' finishedAt:', d.get('finishedAt'))
    print('  engineVersion:', d.get('engineVersion'), ' status:', d.get('status'))
    print('  top-level    :', ', '.join(sorted(d.keys())))
PY
