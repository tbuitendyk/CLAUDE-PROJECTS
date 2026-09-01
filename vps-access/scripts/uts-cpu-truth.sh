#!/usr/bin/env bash
# READ-ONLY. How much CPU is the service ACTUALLY using, and is the work spread
# across the worker threads or sitting on one?
#
# WHY THIS EXISTS: uts-fill-alive.sh reports CPU with `top -bn1`, and top's
# FIRST sample is CPU averaged over the process's whole life, not what it is
# doing now. On a service that has been up for hours that number means nothing,
# and it was read as "one core" when the same snapshot's CPU-time total implied
# about three. This samples /proc twice, twenty seconds apart, which is the
# real number, and it does it per THREAD so "four workers" can be checked
# rather than believed. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
PID=$(pgrep -u uts -f 'node .*server\.js' | head -1)
[ -n "$PID" ] || PID=$(pgrep -u uts node | head -1)
[ -n "$PID" ] || { echo "no uts node process found"; exit 1; }
HZ=$(getconf CLK_TCK); CORES=$(nproc)
echo "== pid $PID · $CORES logical cpus · $HZ ticks per second =="

# utime+stime, after stripping "pid (comm) " so a comm with spaces cannot shift
# every field one to the left
tot() { sed 's/.*) //' "/proc/$PID/stat" 2>/dev/null | awk '{print $12+$13}'; }
thr() { for t in /proc/$PID/task/*/stat; do
          sed 's/^\([0-9]*\) (\(.*\)) /\1 \2 /' "$t" 2>/dev/null \
            | awk '{print $1" "$2" "$14+$15}'; done; }

A=$(tot); AT=$(thr); SECS=20
sleep $SECS
B=$(tot); BT=$(thr)

echo "== whole process over ${SECS}s =="
awk -v a="$A" -v b="$B" -v hz="$HZ" -v s="$SECS" -v c="$CORES" \
  'BEGIN{p=(b-a)/hz/s*100; printf "  %.1f%% of one core  (%.2f cores busy of %d)\n", p, p/100, c}'

echo "== per thread over ${SECS}s (only threads that did work) =="
join -j 1 <(echo "$AT" | sort -k1,1) <(echo "$BT" | sort -k1,1) 2>/dev/null \
  | awk -v hz="$HZ" -v s="$SECS" '{d=($5-$3)/hz/s*100; if (d>1) printf "  tid %-8s %-16s %6.1f%%\n", $1, $2, d}' \
  | sort -k3 -rn
echo "  (a thread under 1% is not listed)"

echo "== the two settings that cap it =="
sudo -u uts python3 -c "
import json
try: s=json.load(open('data/settings.json'))
except Exception as e: print('  unreadable:', e); raise SystemExit
print('  service_cpu_pct:', s.get('service_cpu_pct'), '(each worker duty cycle; missing means 90)')
print('  worker_threads :', s.get('worker_threads'), '(missing means cores-4, capped at 4)')
"

echo "== saved unit figures on disk =="
ls -la --time-style=full-iso data/batches/s3-mte0oajo-1__keptfigs/ 2>/dev/null \
  || echo "  no __keptfigs directory yet"
