#!/usr/bin/env bash
# classifier-wf1-read.sh -- read WF1 (read-only). Prints the doc id it
# read (QC 48), progress if running, and — when done — the board through
# the declared reading rules R1-R5 (classifier-wf1-launch.sh), which were
# committed before the run fired.
set -uo pipefail
B="http://127.0.0.1:8093"
curl -sS --max-time 30 "$B/api/batches" | python3 -c "
import sys, json, urllib.request
bs = json.load(sys.stdin)['batches']
doc_row = next((b for b in bs if str(b['id']).startswith('walkforward-') and '-wf1' in b['id']), None)
if not doc_row:
    print('no WF1 doc found'); raise SystemExit(1)
print('doc read:', doc_row['id'])
doc = json.load(urllib.request.urlopen(f\"$B/api/batch/{doc_row['id']}\"))
print('status:', doc['status'], '—', doc.get('progress') or '')
perf = doc.get('perf') or {}
if doc['status'] == 'running':
    eta = perf.get('etaMs')
    print(f\"units {perf.get('unitsDone')}/{perf.get('unitsTotal')}\" + (f', ~{round(eta/60000)} min left' if eta else ''))
    raise SystemExit(0)
rows = doc.get('wfRows', [])
fails = doc.get('failures', [])
print(f\"units scored: {len(rows)}; failures: {len(fails)} (failed setups are MISSING, not zero)\")
for f in fails[:10]: print('  FAILURE:', f['key'], '—', str(f['error'])[:120])

thin = [r for r in rows if r['foldsScored'] < 10]
ranked = sorted((r for r in rows if r['foldsScored'] >= 10),
                key=lambda r: -(r['holdMedian'] if r['holdMedian'] is not None else float('-inf')))
print()
print('TABLE: WF1 board through the declared rules (R1/R2/R4). One row per setup;')
print('KEY: setup=coin shape decision | folds=holdout slices scored/planned | med=median')
print('fold holdout dollars per \$100 book | pos=folds that made money / scored | tot=all')
print('folds holdout dollars summed | vsL=tot minus always-going-long the same slices')
print('(skill vs drift, R2) | R1=supported means med>0 AND pos>half — retires nothing.')
for r in ranked[:25]:
    med = r['holdMedian']; pos = r['foldsPositive']; n = r['foldsScored']
    vsl = r['holdTotal'] - (r.get('alwaysLongTotal') or 0)
    r1 = 'supported' if (med is not None and med > 0 and pos * 2 > n) else '—'
    print(f\"  {r['trade']:9s} {r['geometry']:8s} {r['decision']:11s} {n:3d}/{r['foldsPlanned']:3d}\"
          f\"  med \${med:8.2f}  pos {pos:2d}/{n:2d}  tot \${r['holdTotal']:9.2f}  vsL \${vsl:9.2f}  {r1}\")
print(f'  ... plus {max(0, len(ranked)-25)} more ranked rows; {len(thin)} thin setups (<10 folds, R4, unranked)')

print()
print('TABLE: per-coin evidence units (R3). A coin\\'s setups are re-cuts of the same')
print('days — one evidence unit each. KEY: sup=setups meeting R1 (of scored) | medSpread=')
print('lowest..highest median fold dollars across that coin\\'s setups.')
from collections import defaultdict
bycoin = defaultdict(list)
for r in ranked: bycoin[r['trade']].append(r)
for coin in sorted(bycoin, key=lambda c: -max((x['holdMedian'] or -9e9) for x in bycoin[c])):
    rs = bycoin[coin]
    sup = sum(1 for r in rs if r['holdMedian'] is not None and r['holdMedian'] > 0 and r['foldsPositive']*2 > r['foldsScored'])
    meds = [r['holdMedian'] for r in rs if r['holdMedian'] is not None]
    print(f\"  {coin:9s} sup {sup}/{len(rs)}  medSpread \${min(meds):8.2f} .. \${max(meds):8.2f}\")
print()
print('R5 directions (adjacent geometries AND both decisions positive-median on one coin)')
print('nominate the next one-variable drill; nothing here is a candidate until it')
print('replicates outside this instrument. Full fold detail: data/wf/<id>/<unit>.json.')
"
