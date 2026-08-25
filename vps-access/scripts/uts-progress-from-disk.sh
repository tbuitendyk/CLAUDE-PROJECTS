#!/usr/bin/env bash
# uts-progress-from-disk.sh -- READ-ONLY. How far the run has actually got, read
# straight off the row files, so it works when the service is not answering --
# which is exactly when you want to know. Two readings two minutes apart, so the
# answer is a rate and not a snapshot. Changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data/batches
R=$(ls -1d "$D"/*.rows 2>/dev/null | head -1)
[ -n "$R" ] || { echo "no row store"; exit 1; }
echo "run $(basename "$R" .rows)"

read_counts() {
  python3 - "$R" <<'PY'
import json, os, sys
d = sys.argv[1]
out = {}
for name in ('slim', 'census', 'replication'):
    for f in (f'{name}.jsonl.gz.meta.json', f'{name}.jsonl.meta.json'):
        p = os.path.join(d, f)
        if os.path.exists(p):
            try:
                out[name] = json.load(open(p)).get('rows', 0)
            except Exception:
                out[name] = -1
            break
print(json.dumps(out))
PY
}

A=$(read_counts)
TA=$(date -u +%s)
echo "  now:  $A"
echo "  waiting two minutes..."
sleep 120
B=$(read_counts)
TB=$(date -u +%s)
echo "  then: $B"

python3 - "$A" "$B" "$((TB - TA))" <<'PY'
import json, sys
a, b, secs = json.loads(sys.argv[1]), json.loads(sys.argv[2]), int(sys.argv[3])
PLANNED = 25704
done = b.get('census', 0)
moved = False
for k in ('slim', 'census', 'replication'):
    d = b.get(k, 0) - a.get(k, 0)
    print(f"  {k:12} {a.get(k)} -> {b.get(k)}  ({d:+})")
    if d:
        moved = True
units = b.get('census', 0) - a.get('census', 0)
if not moved:
    print("\n  NOTHING WAS WRITTEN IN TWO MINUTES. It is not getting anywhere.")
else:
    left = PLANNED - done
    print(f"\n  IT IS MOVING: {done} of {PLANNED} scored in full, {left} to go")
    if units:
        rate = units / secs
        print(f"  {rate*3600:.0f} an hour at this moment -> roughly {left/rate/3600:.1f} hours left")
    else:
        print("  rows are being written but no unit finished inside the window -- it is mid-unit")
PY

echo
echo "== and what the service is doing while that happens =="
P=$(systemctl show ultimate-trading-system -p MainPID --value)
ps -o pcpu=,rss=,nlwp= -p "$P" 2>/dev/null | awk '{printf "  %s%% of a processor, %.0f MB, %s threads\n", $1, $2/1024, $3}'
printf '  does a page come back: '
curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 60 http://127.0.0.1:8094/construct.html || echo 'still nothing after 60s'
