#!/usr/bin/env bash
# ht-postmortem.sh -- read-only: what happened to the History Tuning run.
# Prints the newest batch files on disk, the HT doc's own record (status,
# error, failures, pass counts), service restarts, and journal errors.
set -uo pipefail
cd /opt/general-classifier
echo "== newest batch files on disk =="
ls -t data/batches/*.json 2>/dev/null | head -5 | while read f; do echo "  $(basename $f)  $(stat -c '%y' "$f" | cut -c1-19)  $(stat -c %s "$f") bytes"; done
echo
echo "== the newest historytuning doc, decoded =="
python3 - <<'EOF'
import json, glob
files = sorted(glob.glob('data/batches/historytuning-*.json'))
if not files:
    print('  NO historytuning doc exists on disk at all')
else:
    f = files[-1]
    try:
        d = json.load(open(f))
        print(f"  id={d.get('id')} status={d.get('status')} started={d.get('startedAt')} finished={d.get('finishedAt')}")
        print(f"  error={d.get('error')}")
        print(f"  progress={d.get('progress')!r} phase={(d.get('perf') or {}).get('phase')}")
        print(f"  htRows={len(d.get('htRows') or [])} failures={len(d.get('failures') or [])} failuresDropped={d.get('failuresDropped')}")
        for x in (d.get('failures') or [])[:5]: print(f"    FAIL {x.get('key')}: {str(x.get('error'))[:160]}")
        p = d.get('params') or {}
        print(f"  params: pair={p.get('pair')} geometry={p.get('geometry')} arm={p.get('arm')} label={p.get('label')}")
    except Exception as e:
        print(f"  {f}: UNREADABLE ({e})")
EOF
echo
echo "== service restarts + errors, last 3h =="
journalctl -u general-classifier --since '-3 hours' --no-pager 2>/dev/null | grep -iE 'error|Started|Stopped|crash|FATAL|listening' | tail -20
