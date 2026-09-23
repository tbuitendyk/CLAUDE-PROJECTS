#!/usr/bin/env bash
# uts-rebuild-now.sh -- READ-ONLY. What the box is doing about REBUILD REQUIRED
# right now, asked of the running service (a separate process cannot see its
# in-memory runs): the pass that works out the test history numbers on one
# stage 3 set -- which coin and shape it was aimed at, how far it is, when it
# started -- and the rebuild of every Stage 4 set the service flags. Changes
# nothing.   usage: uts-rebuild-now.sh [stage 3 set id]
set -uo pipefail
S3="${1:-s3-muc74wb6-25}"
echo "== now $(date -u +%FT%TZ); service active since $(systemctl show -p ActiveEnterTimestamp --value ultimate-trading-system)"
echo "== load: $(cut -d' ' -f1-3 /proc/loadavg); node CPU: $(ps -C node -o pcpu=,etime=,rss= | sort -rn | head -1)"
echo "== the test history numbers pass on $S3"
curl -sS -m 20 "http://127.0.0.1:8094/api/funnel/$S3/rebuild" | python3 -c '
import sys, json, datetime
try: d = json.load(sys.stdin)
except Exception as e: print("  no readable answer:", e); sys.exit(0)
tok = d.get("token") or ""
started = None
try:
    ms = int(str(tok).rsplit(":", 1)[1]); started = datetime.datetime.utcfromtimestamp(ms / 1000)
except Exception: pass
for k in ("running", "unit", "units", "onUnit", "done", "of", "stopping", "error"):
    print(f"  {k:9}: {d.get(k)!r}")
if started:
    el = (datetime.datetime.utcnow() - started).total_seconds()
    print(f"  started  : {started.isoformat()}Z ({el/60:.1f} min ago)")
    done, of = d.get("done") or 0, d.get("of") or 0
    if d.get("running") and done and of and el > 0:
        rate = done / el
        print(f"  pace     : {rate:.1f} settings a second; at that pace {((of - done) / rate) / 3600:.1f} hours left")
r = d.get("result")
if r: print("  result   :", json.dumps({k: r.get(k) for k in ("settings", "units", "of", "stopped", "nothingMissing", "waiting", "failed") if k in r}))
'
echo "== the rebuild of each Stage 4 set the service flags"
curl -sS -m 30 "http://127.0.0.1:8094/api/funnel/sets" | python3 -c '
import sys, json, urllib.request
try: d = json.load(sys.stdin)
except Exception as e: print("  no readable answer:", e); sys.exit(0)
rows = d.get("sets", d if isinstance(d, list) else [])
flagged = [x for x in rows if x.get("rebuild")]
print(f"  flagged in the list: {len(flagged)}")
for x in flagged:
    rb = x["rebuild"]
    keys = ",".join(r.get("key", "") for r in rb.get("reasons", []))
    st = {}
    if "stage4" in keys:
        try: st = json.load(urllib.request.urlopen(f"http://127.0.0.1:8094/api/funnel/set/{x[\"id\"]}/rebuild-required", timeout=10))
        except Exception as e: st = {"error": str(e)}
    now = rb.get("failed") and ("STOPPED: " + rb["failed"]) or rb.get("running") or (st.get("words") if st and not st.get("none") else "") or "not started"
    print(f"  - {x[\"id\"]} [{keys}] {str(x.get(\"name\", \"\"))[:55]} :: {now}")
'
