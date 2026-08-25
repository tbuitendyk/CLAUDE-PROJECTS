#!/usr/bin/env bash
# uts-what-is-it-stuck-on.sh -- READ-ONLY. The run is not writing and the pages
# are not answering. This says whether that is because a thread is BURNING
# processor (stuck in the code), WAITING on the disk, or being held back by the
# machine being busy elsewhere. Three different faults with three different
# fixes, and "it is stuck" does not tell them apart. Changes nothing.
set -uo pipefail
P=$(systemctl show ultimate-trading-system -p MainPID --value)
[ -n "$P" ] && [ "$P" != 0 ] || { echo "the trading service has no process"; exit 1; }
echo "trading service is pid $P"

echo
echo "== the whole machine =="
uptime | sed 's/^/  /'
nproc | sed 's/^/  processors: /'
df -h / | tail -1 | sed 's/^/  disk  /'
echo "  busiest:"
ps -eo pcpu,etime,comm --sort=-pcpu 2>/dev/null | head -6 | sed 's/^/    /'

echo
echo "== each of its threads, over ten seconds =="
# utime+stime out of /proc, sampled twice. A thread burning processor is stuck in
# the code; one in D is waiting on the disk; one flat and sleeping is idle.
python3 - "$P" <<'PY'
import os, time, sys
pid = sys.argv[1]
def snap():
    out = {}
    base = f'/proc/{pid}/task'
    try:
        tids = os.listdir(base)
    except FileNotFoundError:
        return None
    for t in tids:
        try:
            st = open(f'{base}/{t}/stat').read()
            after = st[st.rindex(')') + 2:].split()
            state = after[0]
            utime, stime = int(after[11]), int(after[12])
            name = st[st.index('(') + 1:st.rindex(')')]
            try:
                wchan = open(f'{base}/{t}/wchan').read().strip() or '-'
            except Exception:
                wchan = '-'
            out[t] = (name, state, utime + stime, wchan)
        except Exception:
            pass
    return out

a = snap()
time.sleep(10)
b = snap()
if not a or not b:
    print('  the process went away while it was being looked at')
    raise SystemExit
hz = os.sysconf('SC_CLK_TCK')
rows = []
for t, (name, state, ticks, wchan) in b.items():
    if t in a:
        pct = 100.0 * (ticks - a[t][2]) / hz / 10
        rows.append((pct, t, name, state, wchan))
rows.sort(reverse=True)
print(f"  {'thread':>8}  {'name':<16} {'state':<6} {'% of a processor':>17}  waiting on")
for pct, t, name, state, wchan in rows[:16]:
    print(f"  {t:>8}  {name:<16} {state:<6} {pct:>16.1f}%  {wchan}")
busy = sum(1 for r in rows if r[0] > 5)
disk = sum(1 for r in rows if r[3] == 'D')
print()
if disk:
    print(f"  {disk} thread(s) are WAITING ON THE DISK — it is not stuck in the code, it is stuck on storage")
elif busy:
    print(f"  {busy} thread(s) are burning processor — it is working, or stuck in a loop")
else:
    print("  NOTHING is burning processor and nothing is waiting on the disk.")
    print("  It is idle: it is not working on anything at all, whatever it says.")
PY

echo
echo "== what its main thread is doing, from the kernel's side =="
cat "/proc/$P/wchan" 2>/dev/null | sed 's/^/  waiting on: /'; echo
grep -E '^(State|Threads|VmRSS|voluntary|nonvoluntary)' "/proc/$P/status" 2>/dev/null | sed 's/^/  /'

echo
echo "== is it being held back by its own ceiling =="
for f in cpu.stat memory.current memory.max memory.events; do
  C=/sys/fs/cgroup/system.slice/ultimate-trading-system.service/$f
  [ -r "$C" ] && { echo "  $f:"; sed 's/^/    /' "$C" | head -6; }
done
