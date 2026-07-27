#!/usr/bin/env bash
# classifier-bracketlab-read.sh -- compact reader for a Bracket lab sweep:
# params/plan/perf, failures, the full leaderboard, selection and null
# readings. Optional $1 = doc id (default: newest bracketlab doc).
# Read-only; 8k-stdout safe.
set -euo pipefail
ID="${1:-}"
if [ -z "$ID" ]; then
  ID=$(curl -s http://127.0.0.1:8093/api/batches | python3 -c '
import json, sys
b = json.load(sys.stdin)["batches"]
ids = [x["id"] for x in b if x["id"].startswith("bracketlab-")]
print(ids[0] if ids else "")')
fi
if [ -z "$ID" ]; then echo "no bracketlab docs"; exit 0; fi
curl -s "http://127.0.0.1:8093/api/batch/$ID" > /tmp/bl-doc.json
python3 <<'EOF'
import json
d = json.load(open("/tmp/bl-doc.json"))
p = d["params"]
perf = d.get("perf") or {}
perm = [k for k, v in (p.get("permute") or {}).items() if v]
sizes = [k for k, v in (p.get("sizes") or {}).items() if v]
print(f"=== {d['id']} status={d['status']}")
print(f"universe({len(p['universe'])}): {','.join(p['universe'])}")
print(f"sizes={sizes} permuted={perm or 'none'} set={p['set']} allLoaded={p['allLoaded']} months={p['startMonth']}..{p['endMonth']}")
print(f"promoteK={p['promoteK']} minTrades={p['minTrades']} fee/trip=${2*p['feePerLeg']:.2f}")
pl = d.get("plan") or {}
print(f"plan: {pl.get('combos')} combos x {pl.get('branches')} branches = {pl.get('units')} units | slimRuns={pl.get('slimRuns')} promoteRuns={pl.get('promoteRuns')}")
el = (perf.get("elapsedMs") or 0) / 3600000
print(f"perf: phase={perf.get('phase')} units {perf.get('unitsDone')}/{perf.get('unitsTotal')} runs {perf.get('runsDone')}/{perf.get('runsTotal')} "
      f"rate={round(perf.get('ratePerMin') or 0,1)}/min elapsed={el:.1f}h")
fails = d.get("failures") or []
print(f"failures: {len(fails)}" + (f" (first: {fails[0]['key']}: {fails[0]['error'][:60]})" if fails else ""))
sel = d.get("selection")
if sel:
    print(f"selection: {sel['key']} [{sel['stage']}] pnl {sel['pnl']:+.2f}")
nt = d.get("nullTest")
if nt:
    print(f"null: status={nt['status']} rotations={nt.get('shifts')}/{nt.get('requestedShifts')} "
          f"exceedSearch={nt.get('exceedSearch')} exceedSame={nt.get('exceedSame')} "
          f"medBest={nt.get('medianBestPnl')} medSame={nt.get('medianSamePnl')}")
print("leaderboard:")
for i, l in enumerate(d.get("leaders") or [], 1):
    combo = l["trade"] + ("+" + l["ctx1"] if l.get("ctx1") else "") + ("+" + l["ctx2"] if l.get("ctx2") else "")
    print(f" {i:2d}. [{l['stage'][:4]}] {combo:<30s} {l['geometry']:<9s} {str(l['bandMode']):<4s}±{l['bandPct']:.2f}% "
          f"{l['decision'][:3]} {'24/5' if l.get('weekdaysOnly') else '24/7'} q{l['quorum']}/{l['members']} "
          f"{l['gate'][:4]:<4s} d{l['dMult']}x t{l['tHours']}h | {l['pnl']:+8.2f} "
          f"vsCtl {('%+.2f' % (l['pnl'] - l['controlPnl'])) if l.get('controlPnl') is not None and l['gate'] != 'always' else '—':>8s} ({l['wins']}/{l['trades']}t "
          f"g/t {('%.2f' % l['grossPerTrade']) if l.get('grossPerTrade') is not None else '—'}) stops={l['stops']} amb={l['ambiguous']} "
          f"periods={l.get('testPeriods')}")
EOF
