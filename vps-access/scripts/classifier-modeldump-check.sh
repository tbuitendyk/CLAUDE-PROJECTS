#!/usr/bin/env bash
# Did the model-dump path actually write files? A dump everyone believes
# exists is worse than none — check the newest doc's pointers AND the disk.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request, os
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
ids=[b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]
d=get(f"{B}/api/batch/{ids[0]}")
rows=d.get("edgeCensus") or []
print(f"doc {d['id']}  modelFiles counter: {d.get('modelFiles')}")
withfile=[r for r in rows if r.get("modelFile")]
print(f"census rows with a modelFile pointer: {len(withfile)}/{len(rows)}")
dumperr=[f for f in (d.get("failures") or []) if "model dump" in (f.get("error") or "")]
print(f"dump write failures: {len(dumperr)}" + (f"  first: {dumperr[0]}" if dumperr else ""))
if withfile:
    p=os.path.join("/opt/general-classifier/data", withfile[0]["modelFile"])
    ok=os.path.exists(p)
    print(f"first file on disk: {ok}  ({p})")
    if ok:
        j=json.load(open(p))
        real = j.get("models") is not None
        nv = len((j.get("votes") or {}).get("search") or [])
        print(f"  models present: {real}   vote streams: {nv}   perMember rows: {len(j.get('perMember') or [])}")
        print(f"  size: {os.path.getsize(p):,} bytes")
import subprocess
out=subprocess.run(["du","-sh","/opt/general-classifier/data/models"],capture_output=True,text=True).stdout.strip()
print("models dir total:", out or "(missing)")
EOF
