#!/usr/bin/env bash
# classifier-wfpaired-read.sh -- the PAIRED instrument (read-only): for
# every setup, fold by fold, real votes' holdout money minus the luck
# arms' money ON THE SAME SLICE. Both arms scored identical folds, so
# this is a matched comparison that keeps magnitudes — the information
# the count rules threw away (audit-...-wfnull-s102.md §9).
#
# READING RULES PR1-PR5 — committed BEFORE this script's first run:
#   PR1 statistic, per setup: for each fold scored by ALL THREE runs
#       (real WF1, luck seeds 101 and 102), d = real fold money minus the
#       MEAN of the two luck draws' fold money. Report the median of d
#       and the count of folds with d > 0. Folds not scored by all three
#       are dropped and the drop count printed (honesty about pairing).
#   PR2 paired support: median d > 0 AND more than half of paired folds
#       have d > 0 [both no-skill points, DERIVED].
#   PR3 the luck reference for PR2's COUNT: the same formula applied
#       luck-vs-luck (seed 101 as "real" against seed 102, and the
#       reverse); the larger of the two counts is the floor. The real
#       count must exceed TWICE that floor [GUESSED factor, consistent
#       with NR2] to be called distinguishable.
#   PR4 magnitudes are reported (top setups by median d) but nothing is
#       selected off this read: a distinguishable count opens the door to
#       REPLICATION rules (declared separately), never straight to picks.
#   PR5 concentration (QC 36/47): per-coin evidence units printed; a
#       coin's setups are re-cuts, one evidence unit each.
set -uo pipefail
WF=/opt/general-classifier/data/wf
B="http://127.0.0.1:8093"
curl -sS --max-time 30 "$B/api/batches" | python3 -c "
import sys, json, glob
from collections import defaultdict
bs = json.load(sys.stdin)['batches']
def pick(tag):
    return next((b['id'] for b in bs if str(b['id']).startswith('walkforward-') and tag in b['id'] and b['status'] == 'done'), None)
real_id, n1_id, n2_id = pick('-wf1'), pick('-wfnull-s101'), pick('-wfnull-s102')
if not (real_id and n1_id and n2_id):
    print('missing docs:', real_id, n1_id, n2_id); raise SystemExit(1)
print('docs read:', real_id, '|', n1_id, '|', n2_id)

def folds_by_unit(jobid):
    out = {}
    for fn in glob.glob(f'$WF/{jobid}/*.json'):
        d = json.load(open(fn))
        key = f\"{d['trade']} {d['geometry']} {d['decision']}\"
        out[key] = {f['testStart']: f['holdPnl'] for f in d['folds'] if not f.get('skipped')}
    return out

R, N1, N2 = folds_by_unit(real_id), folds_by_unit(n1_id), folds_by_unit(n2_id)

def med(xs):
    xs = sorted(xs)
    if not xs: return None
    x = 0.5 * (len(xs) - 1); lo, hi = int(x), -int(-x // 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (x - lo)

def paired(A, Bs):
    # A vs the mean of the runs in Bs, folds common to A and every B
    rows, dropped = [], 0
    for key in sorted(A):
        common = set(A[key])
        for Bn in Bs: common &= set(Bn.get(key, {}))
        allf = set(A[key]);
        for Bn in Bs: allf |= set(Bn.get(key, {}))
        dropped += len(allf) - len(common)
        ds = [A[key][t] - sum(Bn[key][t] for Bn in Bs) / len(Bs) for t in sorted(common)]
        if not ds: continue
        rows.append({'key': key, 'n': len(ds), 'med': med(ds), 'pos': sum(1 for v in ds if v > 0)})
    return rows, dropped

def support(rows):
    return [r for r in rows if r['med'] > 0 and r['pos'] * 2 > r['n']]

real_rows, real_drop = paired(R, [N1, N2])
l12, _ = paired(N1, [N2])
l21, _ = paired(N2, [N1])
rs, l12s, l21s = support(real_rows), support(l12), support(l21)
floor = max(len(l12s), len(l21s))
print()
print('TABLE: paired verdict (PR2/PR3). NAME: setups whose fold-by-fold money beats')
print('the luck arms on the SAME slices. KEY: real = WF1 minus the mean of both luck')
print(f'draws, per fold. luck floor = the larger of the two luck-vs-luck counts.')
print(f'Folds dropped for incomplete pairing: {real_drop} (of ~{sum(r[\"n\"] for r in real_rows) + real_drop}).')
print(f'  paired-supported: real {len(rs):3d} of {len(real_rows)}   luck floor {floor:3d} (s101-vs-s102 {len(l12s)}, s102-vs-s101 {len(l21s)})')
bar = 2 * floor
print('  PR3 verdict:', f'DISTINGUISHABLE (real {len(rs)} > {bar})' if len(rs) > bar else f'NOT distinguishable (real {len(rs)} <= {bar}) — no selection; instrument or hypothesis work next')
print()
print('TABLE: top 15 real setups by paired median (PR4 — reported, not selected).')
print('KEY: pair med = median per-fold (real money minus mean luck money), dollars')
print('per \$100 book; pos = paired folds where real beat luck / paired folds.')
for r in sorted(real_rows, key=lambda r: -(r['med'] if r['med'] is not None else -9e9))[:15]:
    print(f\"  {r['key']:34s} pair med \${r['med']:8.2f}  pos {r['pos']:2d}/{r['n']:2d}\")
print()
print('TABLE: per-coin evidence units (PR5). KEY: sup = paired-supported setups of 8.')
bycoin = defaultdict(list)
for r in real_rows: bycoin[r['key'].split()[0]].append(r)
sup = {c: sum(1 for r in v if r['med'] > 0 and r['pos'] * 2 > r['n']) for c, v in bycoin.items()}
for c in sorted(sup, key=lambda c: -sup[c]):
    print(f'  {c:9s} sup {sup[c]}/8')
print()
print('PR4 reminder: nothing on this read is selected; a distinguishable count opens')
print('replication rules (declared separately), never straight picks.')
"
