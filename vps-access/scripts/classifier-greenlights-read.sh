#!/usr/bin/env bash
# classifier-greenlights-read.sh -- READ-ONLY: every greenlight the box holds,
# with the config it froze and the run it came from. Writes nothing.
set -uo pipefail
curl -sS -m 20 http://127.0.0.1:8093/api/live/greenlights > /tmp/gls.json || { echo "fetch failed"; exit 1; }
python3 - /tmp/gls.json <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
gs = d.get("greenlights") or []
print(str(len(gs)) + " greenlight(s)")
for g in gs:
    c = g.get("configSnapshot") or {}
    combo = c.get("combo") or {}
    cell = c.get("cell") or {}
    br = c.get("branch") or {}
    src = g.get("sourceRun") or {}
    print("")
    print("  id        : " + str(g.get("id")))
    print("  created   : " + str(g.get("createdUtc"))[:19] + "  by " + str(g.get("by")) + "  anchor=" + str(g.get("target")))
    print("  why       : " + str(g.get("why"))[:100])
    print("  from run  : " + str(src.get("id")))
    print("  campaign  : " + str(g.get("campaign")))
    print("  engine    : " + str(g.get("engineVersion")))
    print("  trades    : " + str(combo.get("trade")) + " vs " + str(combo.get("ctx1")) + "/" + str(combo.get("ctx2")))
    print("  branch    : " + str(br.get("geometry")) + " " + str(br.get("decision")) + " band=" + str(br.get("band")))
    print("  cell      : q" + str(cell.get("quorum")) + " " + str(cell.get("entry")) + "/" + str(cell.get("gate"))
          + " dMult=" + str(cell.get("dMult")) + " t" + str(cell.get("tHours")) + "h")
    print("  stage     : " + str(c.get("stage")) + "  members=" + str(len(c.get("members") or [])))
    print("  trainThrough present? " + ("YES (legacy shape)" if c.get("trainThrough") else "no - good"))
    print("  revoked   : " + str(bool(g.get("revoked"))))
PYEOF
echo "(read-only)"
