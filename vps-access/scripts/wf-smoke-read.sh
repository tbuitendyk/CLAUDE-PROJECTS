#!/usr/bin/env bash
# wf-smoke-read.sh -- read the newest walk-forward smoke doc (read-only).
# Prints the doc id it read (QC 48), the run state, the single board row,
# and the fold-by-fold detail through the API the interface itself uses —
# so this smoke also exercises the listRow and unit-detail plumbing the
# review found broken.
set -uo pipefail
B="http://127.0.0.1:8093"
curl -sS --max-time 30 "$B/api/batches" | python3 -c "
import sys, json, urllib.request
bs = json.load(sys.stdin)['batches']
smoke = next((b for b in bs if str(b['id']).startswith('walkforward-') and '-smoke' in b['id']), None)
if not smoke:
    print('no walk-forward smoke doc found — the picker fix did not surface it, or none was fired')
    raise SystemExit(1)
print('doc read:', smoke['id'], '(kind', smoke.get('kind'), ')')
print('picker row:', smoke['status'], f\"{smoke['runsDone']}/{smoke['runsTotal']} units\")
doc = json.load(urllib.request.urlopen(f\"$B/api/batch/{smoke['id']}\"))
print('status:', doc['status'], '—', doc.get('progress') or 'no progress line')
for f in doc.get('failures', []):
    print('FAILURE:', f)
for r in doc.get('wfRows', []):
    print()
    print('BOARD ROW (name: smoke unit aggregate; every money figure is holdout dollars per \$100 book)')
    print(f\"  {r['trade']} {r['geometry']}/{r['decision']}: {r['foldsScored']}/{r['foldsPlanned']} folds scored,\")
    print(f\"  median fold \${r['holdMedian']:.2f}  IQR \${r['iqrLo']:.2f}..\${r['iqrHi']:.2f}  total \${r['holdTotal']:.2f}\")
    print(f\"  positive folds {r['foldsPositive']}/{r['foldsScored']}  trades {r['holdTrades']} (wins {r['holdWins']})  vs-long \${r['holdTotal']-(r.get('alwaysLongTotal') or 0):.2f}\")
    if r.get('detailFile'):
        d = json.load(urllib.request.urlopen(f\"$B/api/walkforward/{smoke['id']}/unit?file={r['detailFile']}\"))
        folds = d['folds']
        skipped = [f for f in folds if f.get('skipped')]
        print(f\"  fold detail file OK: {len(folds)} folds, {len(skipped)} skipped\")
        from collections import Counter
        for reason, n in Counter(f['skipped'] for f in skipped).items():
            print(f\"    skipped {n}x: {reason}\")
    else:
        print('  NO DETAIL FILE — the fold dump failed; check failures above')
"
