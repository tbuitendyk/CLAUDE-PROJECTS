#!/usr/bin/env bash
# pilot-mirror-read.sh -- READ-ONLY: the mirror's current verdict and the
# recorded decisions it is comparing. Writes nothing, clears nothing.
set -uo pipefail
APPDIR=/opt/general-classifier
echo "== mirror.json =="
cat "$APPDIR/data/pilot/mirror.json" 2>/dev/null | head -c 1500 || echo "  (none)"
echo
echo "== recorded decisions =="
python3 - "$APPDIR/data/pilot/decisions" <<'PYEOF'
import json, os, sys
d = sys.argv[1]
try: files = sorted(os.listdir(d))
except Exception as e: print("  cannot list:", e); raise SystemExit
print("  " + str(len(files)) + " file(s)")
for f in files:
    if not f.endswith(".json"): continue
    try: r = json.load(open(os.path.join(d, f)))
    except Exception as e: print("  " + f + ": unreadable " + str(e)); continue
    print("")
    print("  " + f)
    for k in ("chunk_start","side","quorum","band_pct","decision_price","input_hash","config_version","train_through","produced_utc"):
        if k in r: print("    " + k + " = " + str(r[k]))
    if "per_member" in r: print("    per_member = " + str(r["per_member"]))
    print("    has a rule stamp? " + ("yes" if r.get("rule") else "no"))
PYEOF
echo "(read-only)"
