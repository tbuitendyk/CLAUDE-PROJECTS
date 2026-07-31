#!/usr/bin/env bash
# classifier-seedcheck-read.sh -- the combined seed-check read, against the
# reads R1-R4 DECLARED in classifier-l14-seed2.sh / seed3.sh before either
# run fired. Read-only over three stored runs.
set -uo pipefail
python3 <<'EOF'
import json
ROOT="/opt/general-classifier/data"
JOBS={1:"bracketlab-20260730-2306-l14-both-layouts",
      2:"bracketlab-20260731-0628-l14-seed2",
      3:"bracketlab-20260731-0657-l14-seed3"}
key=lambda r:(r["trade"],r["geometry"],r["decision"])
def rows(job,layout):
    d=json.load(open(f"{ROOT}/batches/{job}.json"))
    return [r for r in d["edgeCensus"] if not r.get("shiftFrac")
            and r.get("windowLayout")==layout and r.get("holdPnl") is not None]
chrono=rows(JOBS[1],"chronological")
inter={s:rows(JOBS[s],"interlaced") for s in (1,2,3)}
top=lambda rs:[key(r) for r in sorted(rs,key=lambda r:-r["holdPnl"])[:10]]
tc=top(chrono); ti={s:top(inter[s]) for s in inter}
ov=lambda a,b:len(set(a)&set(b))
print("SEED CHECK — declared reads R1-R4. KEY: 'overlap m/10' = shared setups")
print("between two top-10 boards; money is $ per $100 book summed over 170")
print("setups (comparison aggregate, not tradeable, QC 36).\n")
fails=[]
def read(id,ok,msg):
    print(f"  {'ok  ' if ok else 'FAIL'} {id}: {msg}")
    if not ok: fails.append(id)
print("R1 — each interlaced seed's top-10 vs the chronological board (seed1 gave 1/10; declared <=3/10):")
for s in (2,3):
    o=ov(ti[s],tc); read("R1", o<=3, f"seed {s} overlap {o}/10")
print("R2 — aggregate held-back money keeps its sign (seed1 clearly negative):")
for s in (1,2,3):
    t=sum(r["holdPnl"] for r in inter[s])
    read("R2", (t<0)==(s!=0) if s==1 else t<0, f"seed {s} total ${t:+,.2f} over {sum(r['holdTrades'] or 0 for r in inter[s])} trades")
print("R3 — ATOM daily-1d argmax under every seed (positive AND beats always-long):")
for s in (1,2,3):
    a=next((r for r in inter[s] if key(r)==("ATOMUSDT","daily-1d","argmax")),None)
    if a is None: read("R3", False, f"seed {s}: row missing"); continue
    vsl=a["holdPnl"]-(a.get("holdAlwaysLong") or 0)
    rank=1+sum(1 for r in inter[s] if r["holdPnl"]>a["holdPnl"])
    read("R3", a["holdPnl"]>0 and vsl>0,
        f"seed {s}: ${a['holdPnl']:+.2f} ({a['holdTrades']}t), vs always-long ${vsl:+.2f}, edge {100*(a.get('holdEdge') or 0):+.1f}pt, rank {rank}/170")
print("R4 — do the interlaced seeds agree with EACH OTHER? (<=3/10 => single-seed boards are placement noise):")
prs=[(1,2),(1,3),(2,3)]
ovs=[ov(ti[a],ti[b]) for a,b in prs]
for (a,b),o in zip(prs,ovs): print(f"       seed {a} vs seed {b}: {o}/10 shared")
print(f"  READ: {'single-seed boards are mostly WINDOW-PLACEMENT NOISE — L15 must not select from one seed' if max(ovs)<=3 else 'seeds broadly agree — a single-seed board carries real ranking information' if min(ovs)>=5 else 'partial agreement — rankings carry signal but one seed is not enough for selection'}")
print("\ntop-10s for the record (asset shape decision):")
for name,t in [("chronological",tc)]+[(f"interlaced s{s}",ti[s]) for s in (1,2,3)]:
    print(f"  {name:15s} " + "; ".join(f"{a} {g.replace('daily-','d')} {dc[:3]}" for a,g,dc in t))
print("\nSEED CHECK VERDICT:", "declared reads all hold" if not fails else f"{len(fails)} declared read(s) FAILED: {fails}")
EOF
