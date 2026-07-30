set -euo pipefail
python3 <<'EOF'
import json, urllib.request
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
def real(j):
    d=get(f"{B}/api/batch/{j}")
    rows=[r for r in (d.get("edgeCensus") or []) if not r.get("shiftFrac")]
    return {(r["trade"],r["geometry"],r["decision"]): r for r in rows}
a=real("bracketlab-20260729-1300-l9-real-arm-with-money")
b=real("bracketlab-20260729-2054-l11-walkforward-redo")
keys=sorted(set(a)&set(b))
print("TABLE — DID L11 REALLY USE A DIFFERENT DATE RANGE?")
print("What it measures: the 'no move' band is fitted to the TRAINING stretch, and")
print("  the trade count comes from the HELD-BACK stretch. If L11 truly used a")
print("  shorter date range, both must differ from L9 for the same coin+shape.")
print()
print("  KEY  band  = the +/-% counting as 'no move', fitted on training data")
print("       trades = trades placed in the held-back stretch")
print()
print(f"{'coin':<9s} {'shape':<10s} {'dec':<12s} {'L9 band':>8s} {'L11 band':>9s} {'L9 trd':>7s} {'L11 trd':>8s}")
same_band=0; same_tr=0; n=0
for k in keys[:10]:
    ra,rb=a[k],b[k]
    print(f"{k[0]:<9s} {k[1]:<10s} {k[2]:<12s} {ra['bandPct']:>8.3f} {rb['bandPct']:>9.3f} "
          f"{(ra.get('holdTrades') or 0):>7d} {(rb.get('holdTrades') or 0):>8d}")
for k in keys:
    ra,rb=a[k],b[k]; n+=1
    if abs(ra['bandPct']-rb['bandPct'])<1e-9: same_band+=1
    if (ra.get('holdTrades') or 0)==(rb.get('holdTrades') or 0): same_tr+=1
print()
print(f"identical band  : {same_band}/{n}")
print(f"identical trades: {same_tr}/{n}")
print()
if same_band==n:
    print("*** L11 USED THE SAME DATA RANGE AS L9. endMonth was ignored. ***")
    print("    L11 was not a different period at all.")
else:
    print(f"L11 genuinely used a different range ({n-same_band}/{n} bands differ).")
EOF
