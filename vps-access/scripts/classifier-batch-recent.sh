#!/usr/bin/env bash
# classifier-batch-recent.sh -- one line per recent batch doc: id, kind,
# status, worker count, wall clock, units and failures. Arg-free (the
# installed claude-deploy helper does not forward one anyway).
#
# Exists so wall-clock can be compared ACROSS runs -- single-threaded versus
# pooled, one universe versus another -- without opening each doc by hand.
set -euo pipefail
# Runner config first: the pool size the service WOULD use for the next job.
# Worker threads only exist while a job runs, so a thread listing on an idle
# box cannot answer this — the service has to be asked.
echo "runner: $(curl -s http://127.0.0.1:8093/api/cpu)   (pct = per-worker duty cycle)"
echo
curl -s http://127.0.0.1:8093/api/batches > /tmp/bl-batches.json
python3 <<'EOF'
import json, urllib.request

ids = [b["id"] for b in json.load(open("/tmp/bl-batches.json"))["batches"]][:10]
for i in ids:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:8093/api/batch/{i}", timeout=20) as r:
            d = json.load(r)
    except Exception as e:
        print(f"{i:<28s} unreadable: {e}")
        continue
    perf = d.get("perf") or {}
    mins = (perf.get("elapsedMs") or 0) / 60000
    w = perf.get("workers") or "-"
    units = f"{perf.get('unitsDone')}/{perf.get('unitsTotal')}" if perf.get("unitsTotal") else "-"
    tag = "REPLICATION" if (d.get("params") or {}).get("declared") else "discovery"
    nt = d.get("nullTest")
    ntx = f" null={nt['status']}:{nt.get('shifts')}/{nt.get('requestedShifts')}" if nt else ""
    print(f"{i:<28s} {d.get('kind','-'):<11s} {d['status']:<9s} "
          f"workers={str(w):<3s} {mins:>7.1f}min units={units:<9s} "
          f"fails={len(d.get('failures') or [])} {tag}{ntx}")
EOF
