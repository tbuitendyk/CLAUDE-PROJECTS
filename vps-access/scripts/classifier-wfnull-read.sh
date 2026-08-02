#!/usr/bin/env bash
# classifier-wfnull-read.sh -- per-seed counts read for the newest
# REBUILT null run (-wfnull2-, register 66 deal construction) next to
# the real board (read-only). Prints the doc ids it read (QC 48).
# Computes the per-fold skill series for BOTH docs from the fold detail
# files on disk, so WF1 (engine 1.27, which did not record skillMedian
# in its aggregates) is judged by exactly the same arithmetic.
# NO VERDICT ALONE: single seeds carry counts only; the verdict comes
# from the four-arm paired read (classifier-wf4arm-read.sh) through the
# pre-declared line. Old rotation-built runs are SUPERSEDED and are not
# read here.
set -uo pipefail
B="http://127.0.0.1:8093"
WF=/opt/general-classifier/data/wf
curl -sS --max-time 30 "$B/api/batches" | python3 -c "
import sys, json, os, glob
bs = json.load(sys.stdin)['batches']
nul = next((b for b in bs if str(b['id']).startswith('walkforward-') and '-wfnull2-' in b['id']), None)
real = next((b for b in bs if str(b['id']).startswith('walkforward-') and '-wf1' in b['id']), None)
if not nul or not real:
    print('missing doc:', 'null' if not nul else '', 'real' if not real else ''); raise SystemExit(1)
print('docs read:', real['id'], '(real)  vs ', nul['id'], '(null)')
if nul['status'] == 'running':
    print('null arm still running:', f\"{nul['runsDone']}/{nul['runsTotal']} setups\"); raise SystemExit(0)

def med(xs):
    xs = sorted(xs)
    if not xs: return None
    x = 0.5 * (len(xs) - 1); lo, hi = int(x), -int(-x // 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (x - lo)

def unitstats(jobid):
    out = []
    for f in glob.glob(f'$WF/{jobid}/*.json'):
        d = json.load(open(f))
        folds = [x for x in d['folds'] if not x.get('skipped')]
        if not folds: continue
        pnls = [x['holdPnl'] for x in folds]
        skills = [x['holdPnl'] - (x.get('alwaysLong') or 0) for x in folds]
        out.append({
            'key': f\"{d['trade']} {d['geometry']} {d['decision']}\",
            'n': len(folds),
            'med': med(pnls), 'pos': sum(1 for v in pnls if v > 0),
            'tot': sum(pnls), 'vsl': sum(skills),
            'smed': med(skills), 'spos': sum(1 for v in skills if v > 0),
        })
    return out

def counts(us):
    r1 = [u for u in us if u['med'] > 0 and u['pos'] * 2 > u['n']]
    r12 = [u for u in r1 if u['vsl'] > 0]
    s1 = [u for u in us if u['smed'] > 0 and u['spos'] * 2 > u['n']]
    return r1, r12, s1

ru, nu = unitstats(real['id']), unitstats(nul['id'])
rr1, rr12, rs1 = counts(ru)
nr1, nr12, ns1 = counts(nu)
print()
print('TABLE: null-run counts next to the real board (per-seed read, counts only).')
print('NAME: count of setups (of', f'{len(ru)} real / {len(nu)} null scored) passing',
      'each declared rule set.')
print('KEY: R1 = positive median fold holdout money AND more winning folds than half.')
print('R1+R2 = R1 and total holdout money beats always-going-long. S1 = drift-adjusted:')
print('median per-fold (money minus always-long) positive AND more than half of folds')
print('beat always-long. real = WF1 (informative votes). null = same machinery, each')
print('member\'s real mix of votes dealt onto random days (register 66), so the votes')
print('carry no market information by construction.')
print(f'           R1     R1+R2   S1')
print(f'  real     {len(rr1):3d}     {len(rr12):3d}     {len(rs1):3d}')
print(f'  null     {len(nr1):3d}     {len(nr12):3d}     {len(ns1):3d}')
print()
print('NO VERDICT ALONE: one seed is one draw. The verdict comes only from the')
print('four-arm paired read (classifier-wf4arm-read.sh) through the pre-declared line.')
print()
print('TABLE: top 10 real setups under the drift-adjusted key S1 (the audit 9b rank).')
print('KEY: sk med = median per-fold holdout money minus always-long, dollars per \$100')
print('book; beat = folds beating always-long / scored; vsL = total vs always-long.')
for u in sorted(ru, key=lambda u: -(u['smed'] if u['smed'] is not None else -9e9))[:10]:
    print(f\"  {u['key']:34s} sk med \${u['smed']:8.2f}  beat {u['spos']:2d}/{u['n']:2d}  vsL \${u['vsl']:9.2f}\")
print()
print('Reminder: nothing in the null doc is a finding about any coin; a null run')
print('selects nothing and retires nothing.')
"
