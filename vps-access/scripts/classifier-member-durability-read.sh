#!/usr/bin/env bash
# classifier-member-durability-read.sh -- owner's hypothesis (2026-07-31):
# individual members learn DURABLE coin signals; the committee level (which
# settings, which agreement) captures TRANSIENT era effects. Read-only over
# the 340 saved L14 member files + the stored census. No compute fired.
#
# MEASURES, DECLARED BEFORE LOOKING (direction reads, not pass/fail gates):
#  M1 member skill transfer: correlation of each member's test-window edge
#     with its held-back edge, across all units, per arm. Durable members
#     => clearly positive.
#  M2 member ranking stability: within each 6-member committee, how well the
#     test-window ranking predicts the held-back ranking (median rank
#     correlation), and how often the test-window best member stays top-3.
#  M3 the CONTRAST -- committee-level transfer: correlation of each unit's
#     test-window money with its held-back money, and sign agreement.
#     HYPOTHESIS SUPPORTED if member-level transfer (M1/M2) is clearly
#     stronger than committee-level transfer (M3) in both arms. [qualitative]
#  M4 view rotation: does WHICH data view leads flip between windows?
#     Fraction of units whose leading view on test stays leading on hold.
set -uo pipefail
python3 <<'EOF'
import json, glob, math
ROOT="/opt/general-classifier/data"; JOB="bracketlab-20260730-2306-l14-both-layouts"
doc=json.load(open(f"{ROOT}/batches/{JOB}.json"))
rows=[r for r in doc["edgeCensus"] if not r.get("shiftFrac") and r.get("modelFile")]
def pearson(xs,ys):
    n=len(xs)
    if n<3: return None
    mx=sum(xs)/n; my=sum(ys)/n
    sx=math.sqrt(sum((x-mx)**2 for x in xs)); sy=math.sqrt(sum((y-my)**2 for y in ys))
    if sx==0 or sy==0: return None
    return sum((x-mx)*(y-my) for x,y in zip(xs,ys))/(sx*sy)
def ranks(v):
    order=sorted(range(len(v)), key=lambda i:v[i])
    r=[0]*len(v)
    for pos,i in enumerate(order): r[i]=pos
    return r
arms={"chronological":{}, "interlaced":{}}
for arm in arms:
    units=[r for r in rows if r.get("windowLayout")==arm]
    m1x=[]; m1y=[]; rankcs=[]; besttop3=0; bestn=0
    viewstay=0; viewn=0
    for r in units:
        try: d=json.load(open(f"{ROOT}/{r['modelFile']}"))
        except Exception: continue
        pm=d.get("perMember") or []
        se=[(m["search"] or {}).get("edge") for m in pm]
        he=[(m["hold"] or {}).get("edge") for m in pm]
        if any(v is None for v in se+he) or len(pm)!=6: continue
        m1x+=se; m1y+=he
        rc=pearson(ranks(se),ranks(he))
        if rc is not None: rankcs.append(rc)
        b=max(range(6), key=lambda i:se[i]); bestn+=1
        if ranks(he)[b]>=3: besttop3+=1
        vs={}; vh={}
        for m,s,h in zip(pm,se,he):
            v=m["spec"]["view"]; vs[v]=vs.get(v,0)+s; vh[v]=vh.get(v,0)+h
        lv=max(vs,key=vs.get); viewn+=1
        if max(vh,key=vh.get)==lv: viewstay+=1
    money=pearson([r["searchPnl"] for r in units],[r["holdPnl"] for r in units])
    signagree=sum(1 for r in units if (r["searchPnl"]>0)==(r["holdPnl"]>0))/len(units)
    rankcs.sort()
    arms[arm]=dict(n=len(units), pairs=len(m1x),
        m1=pearson(m1x,m1y),
        m2=rankcs[len(rankcs)//2] if rankcs else None,
        top3=besttop3/bestn if bestn else None,
        m3=money, m3sign=signagree,
        m4=viewstay/viewn if viewn else None)
print("MEMBER DURABILITY vs COMMITTEE TRANSIENCE — L14, both arms")
print("KEY: correlations run -1..+1 (0 = no relationship). 'member edge transfer' = does a member's")
print("test-window prediction skill persist to the held-back window. 'rank stability' = does the")
print("committee's internal pecking order persist (median per unit). 'best stays top-3' = share of")
print("units where the test window's best member is still top-3 held-back. 'money transfer' = does a")
print("SETUP's test-window money predict its held-back money (the committee+settings level).")
print("'view stays' = share of units whose leading data view is the same in both windows.\n")
for arm,a in arms.items():
    print(f"{arm} ({a['n']} setups, {a['pairs']} member pairs)")
    print(f"  member edge transfer (M1):  {a['m1']:+.3f}")
    print(f"  member rank stability (M2): {a['m2']:+.3f}   best stays top-3: {a['top3']*100:.0f}%  (chance 50%)")
    print(f"  money transfer (M3):        {a['m3']:+.3f}   sign agreement: {a['m3sign']*100:.0f}%  (chance ~50%)")
    print(f"  leading view stays (M4):    {a['m4']*100:.0f}%  (chance ~39% across 3 views)")
EOF
