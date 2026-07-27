#!/usr/bin/env bash
# classifier-permscreen-read.sh -- compact reader for a permutation screen:
# selection, chosen members (with test metrics), quorum menu, and the null
# test's per-rung exceed table. Optional $1 = doc id (default: newest
# permscreen doc). Read-only; 8k-stdout safe.
set -euo pipefail
ID="${1:-}"
if [ -z "$ID" ]; then
  ID=$(curl -s http://127.0.0.1:8093/api/batches | python3 -c '
import json, sys
b = json.load(sys.stdin)["batches"]
ids = [x["id"] for x in b if x["id"].startswith("permscreen-")]
print(ids[0] if ids else "")')
fi
if [ -z "$ID" ]; then echo "no permscreen docs found"; exit 0; fi
curl -s "http://127.0.0.1:8093/api/batch/$ID" > /tmp/perm-doc.json
python3 <<'EOF'
import json
d = json.load(open("/tmp/perm-doc.json"))
p = d["params"]
trip = 2 * p.get("feePerLeg", 0.125)
print(f"=== {d['id']} status={d['status']} band={p['dormantPct']} geometry={p['geometry']} decision={p['decision']} fee/trip=${trip:.2f}")
sel = d.get("selection") or {}
pair = sel.get("pair")
print(f"selection: pair={pair} members={len(sel.get('members', []))} rungs={sel.get('rungs')}")
if pair and d.get("perms", {}).get(pair):
    pp = d["perms"][pair]
    print(f"{pair}: band ±{pp.get('band'):.2f}%  test periods={len(pp.get('periods') or [])}")
    for key in sel.get("members", []):
        m = pp["members"].get(key)
        if not m: continue
        met = m["metrics"]
        gpt = (met["paperPnl"] + met["paperTrades"] * trip) / met["paperTrades"] if met.get("paperTrades") else None
        print(f"  member {key} [{m.get('label') or m.get('regime')}]: pnl {met['paperPnl']:+.2f} "
              f"({met.get('paperWins',0)}/{met.get('paperTrades',0)}t, g/t {('$%.2f' % gpt) if gpt else '—'}) "
              f"acc {met['testAcc']:.3f} bestConst {met['bestConstant']:.3f} trueEdge {met['hindsightEdge']:+.3f} "
              f"tau={met.get('tau')} {met.get('chosen','')}")
q = d.get("quorums")
if q:
    n = len(q["members"])
    print(f"quorum menu ({n} members):")
    for r in q["rows"]:
        print(f"  {r['k']}/{n}: net {r['pnl']:+.2f} ({r['wins']}/{r['trades']}t, g/t {('$%.2f' % r['grossPerTrade']) if r.get('grossPerTrade') is not None else '—'}) "
              f"acc {r['acc']:.3f} tradeHit {('%.3f' % r['tradeHit']) if r.get('tradeHit') is not None else '—'}")
nt = d.get("nullTest")
if nt:
    print(f"null test: status={nt['status']} rotations={nt.get('shifts')} of {nt.get('requestedShifts')} requested")
    for k, r in (nt.get("perRung") or {}).items():
        real = r["real"]
        print(f"  rung {k}: real {real['pnl']:+.2f} ({real['trades']}t, acc {real['acc']:.3f}) | "
              f"P&L exceed {100*r['exceedPnl']:.1f}% of {r['shifts']} | acc exceed {('%.1f%%' % (100*r['exceedAcc'])) if r.get('exceedAcc') is not None else '—'} | "
              f"null median {r['medianPnl']:+.2f} on {r['medianTrades']}t")
EOF
