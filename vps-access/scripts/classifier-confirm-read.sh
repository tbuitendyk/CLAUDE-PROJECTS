#!/usr/bin/env bash
# classifier-confirm-read.sh -- read the minute-confirmation result off the
# newest bracketlab doc that has one.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request

def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)

B = "http://127.0.0.1:8093"
doc = None
for i in [b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]:
    d = get(f"{B}/api/batch/{i}")
    if d.get("confirm"):
        doc = d
        break
if not doc:
    print("no confirmation on any bracketlab doc yet")
    raise SystemExit(0)

c = doc["confirm"]
print(f"=== {doc['id']}  confirm={c['status']}  progress={doc.get('progress','')}")
if c["status"] != "done":
    if c.get("error"):
        print(f"  error: {c['error']}")
    raise SystemExit(0)

cell = c["cell"]
print(f"cell: {cell['trade']} {cell['geometry']} q{c['quorum']}/{c['members']} "
      f"{cell.get('entry','breakout')}/{cell['gate']} d{cell.get('dMult')} t{cell['tHours']}h "
      f"trail={cell.get('trailMult')} arm={cell.get('armMult')}")
print(f"SELF-CHECK: {c['selfCheck']}")
d = c["data"]
print(f"minute data: {d['symbol']} {d['months']} month(s), {d['candles']:,} candles, "
      f"coverage {100*d['coverage']:.1f}% of {d['expected']:,}"
      + (f", MISSING {','.join(d['missingMonths'])}" if d["missingMonths"] else ""))
print(f"usable: {c['usable']}")
print()
h, m = c["hourly"], c["minute"]
print(f"{'':10s} {'net P&L':>10s} {'trades':>7s} {'wins':>6s} {'stops':>6s} {'trail-amb':>10s}")
print(f"{'hourly':10s} {h['pnl']:>10.2f} {h['trades']:>7d} {h['wins']:>6d} {h['stops']:>6d} {h.get('trailAmbiguous',0):>10d}")
print(f"{'minute':10s} {m['pnl']:>10.2f} {m['trades']:>7d} {m['wins']:>6d} {m['stops']:>6d} {m.get('trailAmbiguous',0):>10d}")
print(f"{'delta':10s} {c['delta']['pnl']:>+10.2f} {c['delta']['trades']:>+7d} {'':>6s} {c['delta']['stops']:>+6d}")
print()
amb = h.get("trailAmbiguous", 0)
print(f"reading: the hourly run guessed the intra-bar order on {amb} bar(s). "
      + ("The minute run settles those." if amb else "Nothing rested on that assumption here."))
print("a delta in EITHER direction is expected — hourly hides the ordering both ways;")
print("what matters is whether the edge survives the resolution, not which way it moved.")
EOF
