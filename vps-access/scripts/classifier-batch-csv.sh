#!/usr/bin/env bash
# classifier-batch-csv.sh -- compact CSV of every saved pair-screen batch
# (deploy-control truncates stdout at 8k, so this prints only the numbers
# that matter, tightly formatted).
set -euo pipefail
python3 - <<'EOF'
import json, glob, os
for f in sorted(glob.glob('/opt/general-classifier/data/batches/*.json')):
    d = json.load(open(f))
    p = d['params']
    print(f"#{d['id']} ±{p['dormantPct']}% {p['startMonth']}..{p['endMonth']}")
    for r in d['runs']:
        if r['status'] != 'done':
            print(f"{r['trade']},{r['model']},FAILED,{(r.get('error') or '')[:40]}")
            continue
        m = r['metrics']
        tc = m.get('testClassCounts') or {}
        print(','.join(str(x) for x in [
            r['trade'], r['model'],
            round(m['testAcc'], 3), round(m['majorityBaseline'], 3), m['majorityClass'],
            round(m['balancedAcc'], 3) if m['balancedAcc'] is not None else '',
            m['directionalHits'], m['directionalCalls'],
            round(m['trainAcc'], 3), m['trainWeeks'], m['testWeeks'],
            tc.get('-1', ''), tc.get('0', ''), tc.get('1', ''),
            m['chosen'].replace('lambda=', 'L').replace('rounds=', 'R'),
            round(m['valMajorityAcc'], 3) if m.get('valMajorityAcc') is not None else '',
        ]))
EOF
