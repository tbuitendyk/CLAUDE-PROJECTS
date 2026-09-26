#!/usr/bin/env bash
# uts-set-state.sh <setId> -- READ-ONLY. One record set's state, read off its own
# document and its record store's index on disk (no service code loaded, so it
# answers even when the service is slow), and what the stage-engine check's
# status says is busy. Nothing written, nothing started.
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: <setId>"; exit 0; }
case "$ID" in *[!A-Za-z0-9._-]*) echo "bad set id"; exit 1;; esac
D=/opt/ultimate-trading-system/data
echo "now $(date -u +%H:%M:%S) UTC · service up since $(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value) · release $(node -e 'console.log(require("/opt/ultimate-trading-system/package.json").version)' 2>/dev/null)"
nice -n 19 python3 - "$D" "$ID" <<'PY'
import json, os, sys
D, sid = sys.argv[1], sys.argv[2]
try: d = json.load(open(os.path.join(D, 'stagesets', sid + '.json')))
except Exception as e: print(f'no readable document for {sid}: {e}'); sys.exit(0)
p = d.get('perf') or {}
rows = 0
try:
    m = json.load(open(os.path.join(D, 'batches', sid + '.rows', 'records.meta.json')))
    rows = sum(b.get('rows', 0) for b in (m.get('blocks') or []))
except Exception: rows = None
h = d.get('hours')
hw = 'none' if not h else (f"LOST: {h['lost'][:120]}" if h.get('lost') else f"{len((h.get('coins') or {}))} coins, kept {h.get('at','')[:16]}")
print(f"{d.get('name')} ({sid}) · status {d.get('status')} · cancel asked {bool(d.get('cancelRequested'))}")
print(f"  progress: {str(d.get('progress') or '')[:160]}")
print(f"  units done {p.get('unitsDone')} of {p.get('unitsTotal')} · workers {p.get('workers')} · records on disk {rows}")
print(f"  hours kept: {hw} · old price record still on it: {bool(d.get('dataManifest'))}")
f = d.get('failures') or []
print(f"  units that failed: {len(f)}" + (f" -- last: {str(f[-1])[:200]}" if f else ''))
PY
curl -sS -m 20 http://127.0.0.1:8094/api/stage-gate/status | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("stage-engine check status: no answer"); sys.exit(0)
print("busy:", d.get("blockedBy") or "none", "· stage-engine check:", d.get("state"), "for", d.get("release"))'
