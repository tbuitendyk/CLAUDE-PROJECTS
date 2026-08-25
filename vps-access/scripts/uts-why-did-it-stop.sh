#!/usr/bin/env bash
# uts-why-did-it-stop.sh -- READ-ONLY. Why the trading service keeps going away:
# every stop in the last day with the reason systemd recorded, anything the
# kernel killed, what the memory ceiling is and how close it is now. Changes
# nothing.
set -uo pipefail

echo "== is it up, and answering =="
systemctl is-active ultimate-trading-system
printf '  a page: '; curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 30 http://127.0.0.1:8094/construct.html || echo 'no answer in 30s'
printf '  the runs: '; curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 30 http://127.0.0.1:8094/api/batches || echo 'no answer in 30s'

echo
echo "== what it is allowed, and what it is using =="
systemctl show ultimate-trading-system -p MemoryMax -p MemoryHigh -p MemoryCurrent -p CPUQuotaPerSecUSec -p NRestarts -p Result -p ExecMainStatus | sed 's/^/  /'
python3 - <<'PY'
import subprocess
g = lambda k: subprocess.run(['systemctl','show','ultimate-trading-system','-p',k,'--value'],
                             capture_output=True, text=True).stdout.strip()
cur, hi, mx = g('MemoryCurrent'), g('MemoryHigh'), g('MemoryMax')
def gb(v):
    try: return f"{int(v)/(1<<30):.2f} GB"
    except Exception: return v
print(f"  using {gb(cur)} of a {gb(mx)} ceiling (it is slowed down past {gb(hi)})")
PY

echo
echo "== every stop in the last day, with what systemd made of it =="
journalctl -u ultimate-trading-system --since '-26 hours' --no-pager -o short-iso 2>/dev/null \
  | grep -E 'Stopping|Stopped|Failed|Killed|signal|Main process exited|Consumed|Scheduled restart|oom|OOM' \
  | tail -40 | cut -c1-160

echo
echo "== anything the kernel killed for memory =="
journalctl -k --since '-26 hours' --no-pager 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -12 | cut -c1-160
echo "  (nothing above means the kernel killed nothing)"

echo
echo "== and what the service itself said before it went =="
journalctl -u ultimate-trading-system --since '-26 hours' --no-pager -o short-iso 2>/dev/null \
  | grep -viE 'systemd\[1\]|listening on' | tail -20 | cut -c1-160
echo "  (nothing above means it never complained — it was stopped from outside)"
