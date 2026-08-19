#!/usr/bin/env bash
# classifier-greenlights-read.sh -- READ-ONLY: every greenlight the box holds,
# with the config it froze and the run it came from. Writes nothing.
set -uo pipefail
curl -sS -m 20 http://127.0.0.1:8093/api/live/greenlights | python3 -c '
import json,sys
d=json.load(sys.stdin); gs=d.get("greenlights") or []
print(f"{len(gs)} greenlight(s)")
for g in gs:
    c=g.get("configSnapshot") or {}; combo=c.get("combo") or {}; cell=c.get("cell") or {}; br=c.get("branch") or {}
    print()
    print(f"  id        : {g.get(\"id\")}")
    print(f"  created   : {(g.get(\"createdUtc\") or \"\")[:19]}  by {g.get(\"by\")}  anchor={g.get(\"target\")}")
    print(f"  why       : {(g.get(\"why\") or \"\")[:100]}")
    print(f"  from run  : {((g.get(\"sourceRun\") or {}).get(\"id\"))}")
    print(f"  campaign  : {g.get(\"campaign\")}")
    print(f"  engine    : {g.get(\"engineVersion\")}")
    print(f"  trades    : {combo.get(\"trade\")} vs {combo.get(\"ctx1\")}/{combo.get(\"ctx2\")}")
    print(f"  branch    : {br.get(\"geometry\")} {br.get(\"decision\")} band={br.get(\"band\")}")
    print(f"  cell      : q{cell.get(\"quorum\")} {cell.get(\"entry\")}/{cell.get(\"gate\")} dMult={cell.get(\"dMult\")} t{cell.get(\"tHours\")}h")
    print(f"  stage     : {c.get(\"stage\")}  members={len(c.get(\"members\") or [])}")
    print(f"  trainThrough present? {\"YES (legacy)\" if c.get(\"trainThrough\") else \"no — good\"}")
    print(f"  revoked   : {bool(g.get(\"revoked\"))}")
'
echo "(read-only)"
