#!/usr/bin/env bash
# classifier-h1a-show-one.sh -- owner-requested transparency demo
# (2026-08-05): unpack ONE number from the H1a decay table (<6mo member
# corr 0.352) down to day-by-day counting a person can check by eye.
# Read-only; identical definitions to classifier-h1a-decay-curves.sh.
set -uo pipefail
python3 <<'EOF'
import json, glob, math, datetime
ROOT="/opt/general-classifier/data"
JOBS=["bracketlab-20260730-2306-l14-both-layouts","bracketlab-20260731-0628-l14-seed2","bracketlab-20260731-0657-l14-seed3"]
DAY=86_400_000
def blocks_of(starts):
    out=[]; cur=[0]
    for i in range(1,len(starts)):
        if starts[i]-starts[i-1] > 8*DAY: out.append(cur); cur=[]
        cur.append(i)
    out.append(cur)
    return [b for b in out if len(b)>=15]
def word(v): return {1:'UP',-1:'DOWN'}.get(v,'no call')
def dstr(ms): return datetime.datetime.utcfromtimestamp(ms/1000).strftime('%Y-%m-%d')
files=sorted(f for j in JOBS for f in glob.glob(f"{ROOT}/models/{j}/*-real.json"))
pick=None
for f in files:
    d=json.load(open(f))
    if not (d.get("layout") or {}).get("layout")=="interlaced": continue
    for win in ("search","hold"):
        votes=d["votes"].get(win); labels=d["labels"].get(win); starts=d["startTs"].get(win)
        if not votes or not labels or not starts: continue
        bl=blocks_of(starts)
        for a in range(len(bl)):
            for b in range(a+1,len(bl)):
                mida=sum(starts[i] for i in bl[a])/len(bl[a]); midb=sum(starts[i] for i in bl[b])/len(bl[b])
                gap=abs(mida-midb)/DAY
                if gap<180:
                    pick=(f,win,votes,labels,starts,bl[a],bl[b],gap); break
            if pick: break
        if pick: break
    if pick: break
f,win,votes,labels,starts,A,B,gap=pick
unit=f.split('/')[-1].replace('-real.json','')
print("ONE NUMBER, COMPUTED IN THE OPEN")
print("Target: the table's '<6mo member corr = 0.352'.\n")
print(f"Ingredient file (saved 31 Jul, untouched since): {unit}")
print(f"It stores each committee member's daily UP/DOWN call and what the")
print(f"market actually did the day after. Members: {len(votes)}.")
print(f"Block A: {dstr(starts[A[0]])} .. {dstr(starts[A[-1]])} ({len(A)} days)")
print(f"Block B: {dstr(starts[B[0]])} .. {dstr(starts[B[-1]])} ({len(B)} days)")
print(f"Time between block centers: {gap:.0f} days (under 6 months)\n")
print("STEP 1 - was member 1 right, day by day? First 10 days of block A:")
print(f"  {'date':12s} {'member 1 said':14s} {'market did':11s} right?")
for i in A[:10]:
    print(f"  {dstr(starts[i]):12s} {word(votes[0][i]):14s} {word(labels[i]):11s} {'yes' if votes[0][i]==labels[i] else 'no'}")
from collections import Counter
def score(m, idx):
    hits=sum(1 for i in idx if votes[m][i]==labels[i])
    maj=Counter(labels[i] for i in idx).most_common(1)
    return hits, maj[0][1], maj[0][0]
h,mj,mw=score(0,A)
print(f"  ...counting ALL {len(A)} days: member 1 right on {h} of {len(A)} = {100*h/len(A):.1f}%")
print(f"  always guessing '{word(mw)}' (the block's commonest move) scores {mj} of {len(A)} = {100*mj/len(A):.1f}%")
print(f"  member 1's skill in block A = {100*h/len(A):.1f} - {100*mj/len(A):.1f} = {100*(h-mj)/len(A):+.1f} points\n")
print("STEP 2 - that same count for every member, in both blocks (points):")
eA=[]; eB=[]
for m in range(len(votes)):
    ha,mja,_=score(m,A); hb,mjb,_=score(m,B)
    eA.append(100*(ha-mja)/len(A)); eB.append(100*(hb-mjb)/len(B))
    print(f"  member {m+1}:  A {eA[-1]:+6.1f}   B {eB[-1]:+6.1f}")
ca=sum(eA)/len(eA); cb=sum(eB)/len(eB)
print(f"  committee average: A {ca:+.1f}, B {cb:+.1f}  -> subtract it, so a number")
print(f"  means 'better/worse than own teammates that block':")
xA=[e-ca for e in eA]; xB=[e-cb for e in eB]
for m in range(len(xA)):
    print(f"  member {m+1}:  A {xA[m]:+6.1f}   B {xB[m]:+6.1f}")
sxy=sum(a*b for a,b in zip(xA,xB)); sxx=sum(a*a for a in xA); syy=sum(b*b for b in xB)
r=sxy/math.sqrt(sxx*syy)
print(f"\nSTEP 3 - do the A column and B column line up?")
print(f"  sum of A*B products = {sxy:+.1f}")
print(f"  sum of A squared = {sxx:.1f}, sum of B squared = {syy:.1f}")
print(f"  correlation = {sxy:+.1f} / sqrt({sxx:.1f} * {syy:.1f}) = {r:+.2f}")
print(f"  (+1 = rankings identical, 0 = no relation, -1 = reversed)\n")
print("STEP 4 - the table's number is ONLY this, repeated: pool every")
print("under-6-month block pair in all saved files and correlate once:")
def edge(calls, labels, idx):
    n=len(idx)
    hits=sum(1 for i in idx if calls[i]==labels[i])
    maj=Counter(labels[i] for i in idx).most_common(1)[0][1]
    return hits/n - maj/n
X=[]; Y=[]; npairs=0
for f2 in files:
    d2=json.load(open(f2))
    if not (d2.get("layout") or {}).get("layout")=="interlaced": continue
    for win2 in ("search","hold"):
        v2=d2["votes"].get(win2); l2=d2["labels"].get(win2); s2=d2["startTs"].get(win2)
        if not v2 or not l2 or not s2: continue
        bl2=blocks_of(s2)
        if len(bl2)<2: continue
        stats=[]
        for blk in bl2:
            mid=sum(s2[i] for i in blk)/len(blk)
            es=[edge(m,l2,blk) for m in v2]
            ce=sum(es)/len(es)
            stats.append((mid,[e-ce for e in es]))
        for a in range(len(stats)):
            for b2 in range(a+1,len(stats)):
                if abs(stats[a][0]-stats[b2][0])/DAY < 180:
                    X.extend(stats[a][1]); Y.extend(stats[b2][1]); npairs+=1
mx=sum(X)/len(X); my=sum(Y)/len(Y)
sxy=sum((a-mx)*(b-my) for a,b in zip(X,Y))
sxx=sum((a-mx)**2 for a in X); syy=sum((b-my)**2 for b in Y)
print(f"  block pairs pooled: {npairs} ({len(X)} member points)")
print(f"  correlation = {sxy/math.sqrt(sxx*syy):.3f}   <- the table says 0.352")
EOF
