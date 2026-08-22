#!/usr/bin/env bash
# uts-memory-watch.sh -- READ-ONLY. Samples the service's memory against the
# work it has done, so "is the memory problem fixed" has a measurement behind
# it instead of an argument.
#
# Written 2026-08-22. A sweep died of a full JavaScript heap; two causes were
# found and fixed and the heap ceiling was raised. None of that is proof. The
# proof is whether memory stays flat while the unit count climbs — a leak shows
# up as megabytes per unit, and a fixed one shows up as roughly zero.
#
# Ten samples, thirty seconds apart: five minutes, well inside the endpoint's
# own timeout. Changes nothing.
set -uo pipefail
U=ultimate-trading-system
D=/opt/ultimate-trading-system/data

units_now() {
  python3 - "$D/batches" <<'PY' 2>/dev/null || echo "0 0 none"
import json, os, sys
b = sys.argv[1]
best = None
for f in os.listdir(b):
    if not f.endswith('.json'):
        continue
    try:
        d = json.load(open(os.path.join(b, f)))
    except Exception:
        continue
    if d.get('status') != 'running':
        continue
    best = d
if not best:
    print('0 0 none')
else:
    p = best.get('perf') or {}
    print(p.get('unitsDone') or 0, p.get('unitsTotal') or 0, (p.get('phase') or '?'))
PY
}

echo "sample  elapsed   cgroup-MB   rss-MB   unitsDone   phase"
PID="$(systemctl show "$U" -p MainPID --value)"
T0=$(date +%s)
FIRST_MB=""; FIRST_UNITS=""
LAST_MB=""; LAST_UNITS=""
for i in $(seq 1 10); do
  CUR="$(systemctl show "$U" -p MemoryCurrent --value)"
  CUR_MB=$(( CUR / 1048576 ))
  RSS_KB="$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ')"
  RSS_MB=$(( ${RSS_KB:-0} / 1024 ))
  read -r UD UT PH <<<"$(units_now)"
  EL=$(( $(date +%s) - T0 ))
  printf "  %2d   %5ds   %7d     %6d   %8s   %s\n" "$i" "$EL" "$CUR_MB" "$RSS_MB" "$UD/$UT" "$PH"
  if [ -z "$FIRST_MB" ]; then FIRST_MB=$CUR_MB; FIRST_UNITS=$UD; fi
  LAST_MB=$CUR_MB; LAST_UNITS=$UD
  [ "$i" -lt 10 ] && sleep 30
done

echo
echo "=============================== THE FACTS ==============================="
echo "  heap ceiling : $(grep -o '\-\-max-old-space-size=[0-9]*' /etc/systemd/system/$U.service 2>/dev/null || echo '(not set)')"
systemctl show "$U" -p MemoryHigh -p MemoryMax -p MemoryPeak -p NRestarts --no-pager \
  | sed 's/=\([0-9]\{7,\}\)$/=\1/' | sed 's/^/  /'
DMB=$(( LAST_MB - FIRST_MB ))
DU=$(( LAST_UNITS - FIRST_UNITS ))
echo "  over this window: ${DMB}MB across ${DU} unit(s)"
if [ "$DU" -gt 0 ]; then
  python3 -c "
d=$DMB; u=$DU
per = d/u
print('  that is %+.4f MB per unit.' % per)
print('  extrapolated over 50,000 more units: %+.0f MB' % (per*50000))
print('  READ THIS AS: a leak shows up as a positive number that does not settle;')
print('  steady-state noise wanders either side of zero.')
"
else
  echo "  no units finished in this window — cannot say anything about growth"
fi
