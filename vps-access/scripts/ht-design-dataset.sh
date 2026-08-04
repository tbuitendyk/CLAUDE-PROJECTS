#!/usr/bin/env bash
# ht-design-dataset.sh -- DESIGN-MODE read (curtain open, owner-ordered
# 2026-08-04): the full 35-arm record of the LTC tuning run, holds included,
# used to characterize the INSTRUMENT. This data is burned as candidate
# evidence; nothing read here may promote an arm.
set -uo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob, statistics as st
d = json.load(open(sorted(glob.glob('data/batches/historytuning-*.json'))[-1]))
rows = [r for r in (d.get('htRows') or []) if not r.get('refused') and not r.get('skipped')]
arms = {}
for r in rows:
    arms.setdefault(f"{r['ageKey']}|{r['retuneKey']}", {})[r['split']] = r
ref = arms['none|never']
splits = ('early','middle','late')
deltas = []   # per-arm: (key, [hold delta vs ref per split], test sum, test rank later)
for k, v in arms.items():
    if k == 'none|never' or len(v) != 3: continue
    dh = [v[s]['holdPnl'] - ref[s]['holdPnl'] for s in splits]
    ts = sum(v[s]['testPnl'] for s in splits)
    deltas.append((k, dh, ts))
# winner's-curse quantification: test rank vs hold-sum rank
byTest = sorted(deltas, key=lambda x: -x[2])
byHold = sorted(deltas, key=lambda x: -sum(x[1]))
holdRank = {k: i+1 for i, (k, _, _) in enumerate(byHold)}
print("ARMS BEATING REFERENCE ON HOLDS (delta = arm hold $ - reference hold $, per window):")
n3 = [x for x in deltas if all(dd > 0 for dd in x[1])]
n2 = [x for x in deltas if sum(1 for dd in x[1] if dd > 0) == 2]
print(f"  all 3 windows: {len(n3)}/34   exactly 2 of 3: {len(n2)}/34")
for k, dh, ts in sorted(n3, key=lambda x: -sum(x[1])):
    print(f"    {k:14s} deltas {dh[0]:+7.1f} {dh[1]:+7.1f} {dh[2]:+7.1f}  sum {sum(dh):+8.1f}  testSum {ts:+9.1f} (test rank {[i+1 for i,(kk,_,_) in enumerate(byTest) if kk==k][0]})")
print()
print("WINNER'S CURSE: top-5 by TEST money vs their rank by HOLD delta (34 arms):")
for i, (k, dh, ts) in enumerate(byTest[:5], 1):
    print(f"  test rank {i}: {k:14s} testSum {ts:+9.1f} -> hold-delta rank {holdRank[k]}/34 (sum {sum(dh):+8.1f})")
print()
allD = [dd for _, dh, _ in deltas for dd in dh]
print(f"NOISE SCALE of a per-window hold delta across all arms: mean {st.mean(allD):+.1f}, sd {st.pstdev(allD):.1f}, min {min(allD):+.1f}, max {max(allD):+.1f}")
ages = {}
for k, dh, ts in deltas:
    age = k.split('|')[0]; ages.setdefault(age, []).append(sum(dh))
print("BY AGE DIAL (hold-delta sums, retune arms pooled): " + '; '.join(f"{a}: median {st.median(v):+.1f} (n={len(v)})" for a, v in sorted(ages.items())))
rets = {}
for k, dh, ts in deltas:
    ret = k.split('|')[1]; rets.setdefault(ret, []).append(sum(dh))
print("BY RETUNE DIAL (hold-delta sums, age arms pooled): " + '; '.join(f"{r}: median {st.median(v):+.1f} (n={len(v)})" for r, v in sorted(rets.items())))
EOF
