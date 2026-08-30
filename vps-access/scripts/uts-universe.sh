#!/usr/bin/env bash
set -uo pipefail
python3 -c "
import json,glob
for f in sorted(glob.glob('/opt/ultimate-trading-system/data/stagesets/s3-*.json')):
    d=json.load(open(f)); p=d.get('params') or {}
    u=p.get('universe') or []
    print(' ', d.get('id'), 'universe', len(u), u[:8])
    print('    plan.units', (d.get('plan') or {}).get('units'), '| engineVersion', d.get('engineVersion'))
"
