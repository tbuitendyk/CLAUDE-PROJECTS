#!/usr/bin/env bash
# classifier-wf4arm-read.sh -- THE DERIVED-THRESHOLD READ (read-only)
# on the REBUILT null runs (wfnull2, QC 66 deal construction); the old
# rotation-built runs are superseded and no longer read here.
# committed before seed 104's numbers exist. Implements exactly the line
# declared in classifier-wfnull-launch-s103.sh:
#
#   Paired-supported counts (formula PR1/PR2 of classifier-wfpaired-read.sh:
#   per setup, per common fold, arm money minus the mean of the reference
#   arms' money; supported = median > 0 AND more than half of folds > 0):
#     - real-vs-4-nulls: WF1 against the mean of all four luck arms;
#     - luck-vs-rest: each luck arm against the mean of the other three
#       (four values — the observed luck variation).
#   VERDICT LINE (derived structure, small-sample limit named): real must
#   exceed  max(luck counts) + (max(luck counts) - min(luck counts)).
#   Above it: the board's lead over luck sits outside observed luck
#   variation -> replication rules may be DESIGNED (declared separately;
#   still no selection). At or below: the honest conclusion is that this
#   committee design's edge, if any, is too small for this instrument to
#   certify -> hypothesis/design work proceeds on that basis.
set -uo pipefail
WF=/opt/general-classifier/data/wf
B="http://127.0.0.1:8093"
curl -sS --max-time 30 "$B/api/batches" | python3 -c "
import sys, json, glob
from collections import defaultdict
bs = json.load(sys.stdin)['batches']
def pick(tag):
    return next((b['id'] for b in bs if str(b['id']).startswith('walkforward-') and tag in b['id'] and b['status'] == 'done'), None)
ids = {t: pick(t) for t in ['-wf1', '-wfnull2-s101', '-wfnull2-s102', '-wfnull2-s103', '-wfnull2-s104']}
missing = [t for t, v in ids.items() if not v]
if missing:
    print('not ready — missing:', ', '.join(missing)); raise SystemExit(1)
print('docs read:', ' | '.join(ids[t] for t in sorted(ids)))

def folds_by_unit(jobid):
    out = {}
    for fn in glob.glob(f'$WF/{jobid}/*.json'):
        d = json.load(open(fn))
        out[f\"{d['trade']} {d['geometry']} {d['decision']}\"] = {f['testStart']: f['holdPnl'] for f in d['folds'] if not f.get('skipped')}
    return out

REAL = folds_by_unit(ids['-wf1'])
NULLS = [folds_by_unit(ids[f'-wfnull2-s10{i}']) for i in (1, 2, 3, 4)]

def med(xs):
    xs = sorted(xs)
    if not xs: return None
    x = 0.5 * (len(xs) - 1); lo, hi = int(x), -int(-x // 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (x - lo)

def paired_rows(A, refs):
    rows = []
    for key in sorted(A):
        common = set(A[key])
        for R in refs: common &= set(R.get(key, {}))
        ds = [A[key][t] - sum(R[key][t] for R in refs) / len(refs) for t in sorted(common)]
        if ds:
            rows.append({'key': key, 'n': len(ds), 'med': med(ds), 'pos': sum(1 for v in ds if v > 0)})
    return rows

def count(rows):
    return sum(1 for r in rows if r['med'] > 0 and r['pos'] * 2 > r['n'])

real_rows = paired_rows(REAL, NULLS)
real_count = count(real_rows)
luck_counts = []
for i in range(4):
    rest = [NULLS[j] for j in range(4) if j != i]
    luck_counts.append(count(paired_rows(NULLS[i], rest)))
mx, mn = max(luck_counts), min(luck_counts)
bar = mx + (mx - mn)
print()
print('TABLE: the derived-threshold verdict. NAME: paired-supported counts, real vs')
print('the four luck arms. KEY: each count = setups (of 136) whose fold-by-fold money')
print('beats the mean of the reference arms (median > 0 and more than half of folds).')
print('luck counts = each luck arm vs the other three — the observed luck variation.')
print(f'  real-vs-luck count : {real_count}')
print(f'  luck-vs-rest counts: {luck_counts}  (max {mx}, min {mn}, spread {mx-mn})')
print(f'  derived line       : max + spread = {bar}')
verdict = 'ABOVE the line — the lead over luck sits outside observed luck variation; replication rules may be designed (still no selection)' if real_count > bar else 'NOT above the line — this committee design\\'s edge, if any, is too small for this instrument to certify; design work proceeds on that honest basis'
print(f'  VERDICT            : {verdict}')
print()
print('TABLE: top 15 real setups by paired median over the four luck arms (reported,')
print('not selected). KEY: pair med = median per-fold (real minus mean-luck) dollars')
print('per \$100 book; pos = folds where real beat luck / paired folds.')
for r in sorted(real_rows, key=lambda r: -(r['med'] if r['med'] is not None else -9e9))[:15]:
    print(f\"  {r['key']:34s} pair med \${r['med']:8.2f}  pos {r['pos']:2d}/{r['n']:2d}\")
print()
print('TABLE: per-coin evidence units (QC 36/47). KEY: sup = paired-supported of 8.')
bycoin = defaultdict(list)
for r in real_rows: bycoin[r['key'].split()[0]].append(r)
sup = {c: sum(1 for r in v if r['med'] > 0 and r['pos'] * 2 > r['n']) for c, v in bycoin.items()}
for c in sorted(sup, key=lambda c: -sup[c]):
    if sup[c]: print(f'  {c:9s} sup {sup[c]}/8')
print()
print('Nothing on this read selects anything; an above-the-line verdict opens the')
print('DESIGN of replication rules, which are declared to the owner before use.')
"
