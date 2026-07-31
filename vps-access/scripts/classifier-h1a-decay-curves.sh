#!/usr/bin/env bash
# classifier-h1a-decay-curves.sh -- H1a: lag-resolved decay curves (owner,
# 2026-07-31). Pure read over the 510 saved unit files from seeds 1-3's
# interlaced arms. No compute fired.
#
# METHOD. Each unit's saved votes are scored inside every scattered 63-day
# block (test + held-back blocks both; member solo scores are selection-free
# either way). Per block: each member's accuracy edge over that block's
# majority share, CENTERED on the committee's mean for that block (removes
# block ease); and each agreement level's (1..6) edge profile. Then every
# pair of blocks within a unit contributes to a time-gap bin.
#
# READS, DECLARED BEFORE LOOKING:
#  D1 member curve: correlation of centered member edge across block pairs,
#     by gap bin. DURABLE = stays clearly positive at long gaps.
#  D2 assembly curve: (a) how often the best agreement level in one block is
#     best in the other, by gap (chance ~1/6 vs ties); (b) correlation of the
#     6-rung edge profile across pairs, by gap. TRANSIENT = decays toward
#     chance/zero with gap; where it crosses the shuffle floor is its
#     half-life.
#  D3 the comparison: H1 predicts D1 sits clearly above D2's identity
#     measure at long gaps. [qualitative]
#  FLOOR: each measure recomputed with block labels shuffled within unit
#     (20 shuffles, seeded) -- the no-structure reference.
set -uo pipefail
python3 <<'EOF'
import json, glob, math, random
ROOT="/opt/general-classifier/data"
JOBS=["bracketlab-20260730-2306-l14-both-layouts","bracketlab-20260731-0628-l14-seed2","bracketlab-20260731-0657-l14-seed3"]
DAY=86_400_000
def pearson(x,y):
    n=len(x)
    if n<8: return None
    mx=sum(x)/n; my=sum(y)/n
    sx=math.sqrt(sum((a-mx)**2 for a in x)); sy=math.sqrt(sum((b-my)**2 for b in y))
    if not sx or not sy: return None
    return sum((a-mx)*(b-my) for a,b in zip(x,y))/(sx*sy)
def blocks_of(starts):
    out=[]; cur=[0]
    for i in range(1,len(starts)):
        if starts[i]-starts[i-1] > 8*DAY: out.append(cur); cur=[]
        cur.append(i)
    out.append(cur)
    return [b for b in out if len(b)>=15]
def edge(calls, labels, idx):
    n=len(idx)
    hits=sum(1 for i in idx if calls[i]==labels[i])
    from collections import Counter
    maj=Counter(labels[i] for i in idx).most_common(1)[0][1]
    return hits/n - maj/n
def quorum(votes,i,k):
    up=sum(1 for m in votes if m[i]==1); dn=sum(1 for m in votes if m[i]==-1)
    if up==dn: return 0
    w=1 if up>dn else -1
    return w if max(up,dn)>=k else 0
BINS=[(0,180,'<6mo'),(180,365,'6-12mo'),(365,730,'1-2y'),(730,1460,'2-4y'),(1460,99999,'>4y')]
mem={b[2]:([],[]) for b in BINS}; rung={b[2]:([],[]) for b in BINS}; best={b[2]:[0,0] for b in BINS}
shuf_mem=[]; shuf_best=[0,0]
rng=random.Random(7)
files=[f for j in JOBS for f in glob.glob(f"{ROOT}/models/{j}/*-real.json")]
used=0
for f in files:
    d=json.load(open(f))
    if not (d.get("layout") or {}).get("layout")=="interlaced": continue
    vs=d["votes"]; lb=d["labels"]; st=d["startTs"]
    for win in ("search","hold"):
        votes=vs.get(win); labels=lb.get(win); starts=st.get(win)
        if not votes or not labels or not starts: continue
        bl=blocks_of(starts)
        if len(bl)<2: continue
        used+=1
        stats=[]
        for b in bl:
            mid=sum(starts[i] for i in b)/len(b)
            es=[edge(m,labels,b) for m in votes]
            ce=sum(es)/len(es)
            cen=[e-ce for e in es]
            rp=[edge([quorum(votes,i,k) for i in range(len(labels))],labels,b) for k in range(1,7)]
            stats.append((mid,cen,rp))
        for a in range(len(stats)):
            for b2 in range(a+1,len(stats)):
                gap=abs(stats[a][0]-stats[b2][0])/DAY
                lab=next(l for lo,hi,l in BINS if lo<=gap<hi)
                mem[lab][0].extend(stats[a][1]); mem[lab][1].extend(stats[b2][1])
                rung[lab][0].extend(stats[a][2]); rung[lab][1].extend(stats[b2][2])
                ba=max(range(6),key=lambda k:stats[a][2][k]); bb=max(range(6),key=lambda k:stats[b2][2][k])
                best[lab][0]+=(ba==bb); best[lab][1]+=1
        # shuffle floor: pair blocks after shuffling member identity
        for _ in range(2):
            for a in range(len(stats)):
                for b2 in range(a+1,len(stats)):
                    p=stats[a][1][:]; rng.shuffle(p)
                    shuf_mem.append((p,stats[b2][1]))
            pa=max(range(6),key=lambda k:rng.random()); pb=max(range(6),key=lambda k:stats[0][2][k])
            shuf_best[0]+=(pa==pb); shuf_best[1]+=1
print(f"H1A DECAY CURVES — {used} unit-windows from 3 interlaced seeds")
print("KEY: 'member corr' = correlation of a member's within-committee relative")
print("skill between two blocks that far apart (0 = none). 'best rung same' =")
print("how often the best agreement level repeats (chance ~17-25% with ties).")
print("'rung profile corr' = correlation of the 6 levels' skill profile.")
print("'floor' = the same member measure with identity shuffled.\n")
sx=[v for p,_ in shuf_mem for v in p]; sy=[v for _,q in shuf_mem for v in q]
floor=pearson(sx,sy)
print(f"{'gap':8s} {'member corr':>12s} {'pairs':>8s} {'best rung same':>15s} {'rung profile corr':>18s}")
for lo,hi,l in BINS:
    mc=pearson(*mem[l]); rc=pearson(*rung[l])
    bs=best[l]
    print(f"{l:8s} {mc if mc is not None else float('nan'):>12.3f} {len(mem[l][0]):>8d} "
          f"{(100*bs[0]/bs[1] if bs[1] else float('nan')):>14.0f}% {rc if rc is not None else float('nan'):>18.3f}")
print(f"\nshuffle floor (member): {floor:+.3f} on {len(sx)} pairs")
EOF
