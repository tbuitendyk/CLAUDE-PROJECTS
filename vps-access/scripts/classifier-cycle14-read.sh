#!/usr/bin/env bash
# classifier-cycle14-read.sh -- read L14 through the reading rule COMMITTED
# in classifier-cycle14-both-layouts.sh before the run fired:
#   * paired per-setup holdout money per trade between the arms
#   * survivor overlap between the two arms' top-10s
#   * the L15 selection board = the INTERLACED arm sorted by holdout money
#   * no candidate retired here; cross-arm totals are cross-population
# Plus the instrument checks: the count invariant on every pair, purge and
# band bookkeeping, per-asset concentration (QC 47).
set -uo pipefail
JOB="bracketlab-20260730-2306-l14-both-layouts"
B="http://127.0.0.1:8093"
JOB="$JOB" python3 <<'EOF'
import json, os, urllib.request
B="http://127.0.0.1:8093"; JOB=os.environ["JOB"]
def get(u):
    with urllib.request.urlopen(u, timeout=60) as r: return json.load(r)
def post(u, body):
    req=urllib.request.Request(u, json.dumps(body).encode(), {"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
d=get(f"{B}/api/batch/{JOB}")
print(f"doc {d['id']}  status={d['status']}  units={d['perf']['unitsDone']}/{d['perf']['unitsTotal']}  fails={len(d.get('failures') or [])}")
rows=[r for r in (d.get("edgeCensus") or []) if not r.get("shiftFrac")]
inter=[r for r in rows if r.get("windowLayout")=="interlaced"]
chrono=[r for r in rows if r.get("windowLayout")=="chronological"]
key=lambda r:(r["trade"],r["geometry"],r["decision"])
bc={key(r):r for r in chrono}
pairs=[(bc[key(r)],r) for r in inter if key(r) in bc]
print(f"census: {len(chrono)} chronological + {len(inter)} interlaced real rows, {len(pairs)} paired")
bad=[ (a['trade'],a['geometry']) for a,b in pairs if a.get('holdPeriods')!=b.get('holdPeriods') or a.get('searchPeriods')!=b.get('searchPeriods')]
print(f"INVARIANT: {'OK — every pair has identical search+holdout period counts' if not bad else 'VIOLATED: '+str(bad[:6])}")
shared=sum(1 for r in rows if r.get('layoutBandFrom')=='common-train')
print(f"band: {shared}/{len(rows)} rows common-train (shared-band); purged train chunks per row: min {min(r['layoutPurged'] for r in rows)}, max {max(r['layoutPurged'] for r in rows)}")
def money(rs): return sum(r['holdPnl'] for r in rs if r['holdPnl'] is not None)
def trades(rs): return sum(r['holdTrades'] or 0 for r in rs)
print(f"\n== ARM TOTALS (cross-population — different calendar windows; context only, never one number) ==")
for nm,rs in (("chronological",chrono),("interlaced",inter)):
    pos=sum(1 for r in rs if (r['holdPnl'] or 0)>0)
    print(f"  {nm:14s} holdout ${money(rs):+10.2f} over {trades(rs):6d} trades, {pos}/{len(rs)} setups positive")
print(f"\n== L15 SELECTION BOARD — interlaced arm, holdout money, top 15 of {len(inter)} ==")
print("   (holdout $ per $100 book | trades | $/trade | prediction edge pts | quorum | cell)")
for r in sorted(inter, key=lambda r:-(r['holdPnl'] or -9e9))[:15]:
    gt=(r['holdPnl']/r['holdTrades']) if r['holdTrades'] else 0
    print(f"  {r['trade']:9s} {r['geometry']:9s} {r['decision']:11s} ${r['holdPnl']:+9.2f} {r['holdTrades']:4d}t ${gt:+6.2f}/t edge {r['holdEdge'] if r['holdEdge'] is not None else '—'} q{r['cellQuorum']} {r['cellEntry']}/{r['cellGate']}/d{r['cellDMult']}/t{r['cellTHours']}h")
cmp=post(f"{B}/api/bracketlab/compare", {"a": JOB})
ov=cmp["survivorOverlap"]
print(f"\n== SURVIVOR OVERLAP: {ov['sharedCount']}/10 setups shared between the arms' top-10s ==")
print("  shared:", ", ".join(s.replace('|',' ').strip() or '-' for s in ov['shared']) or '(none)')
print(f"\n== LARGEST ARM DISAGREEMENTS (paired setups, by |delta holdout $|, top 10 of {cmp['pairedCount']}) ==")
for p in cmp["paired"][:10]:
    print(f"  {p['key'].replace('|',' '):40s} chrono ${p['a']['holdPnl']:+9.2f} ({p['a']['holdTrades']}t)  inter ${p['b']['holdPnl']:+9.2f} ({p['b']['holdTrades']}t)  d ${p['dHoldPnl']:+9.2f}")
tot={}
for r in inter: tot[r['trade']]=tot.get(r['trade'],0)+(r['holdPnl'] or 0)
top_assets=sorted(tot.items(), key=lambda kv:-abs(kv[1]))[:5]
whole=money(inter) or 1
print(f"\n== CONCENTRATION (QC 47) — share of interlaced-arm total by asset ==")
for a,v in top_assets: print(f"  {a:10s} ${v:+9.2f}  ({100*v/whole:+.0f}% of total)")
mf=sum(1 for r in rows if r.get('modelFile'))
print(f"\nmodel dumps: {mf}/{len(rows)} rows carry a file; doc counter {d.get('modelFiles')}")
EOF
