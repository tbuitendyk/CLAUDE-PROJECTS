#!/usr/bin/env bash
# uts-cpu-ceiling.sh -- READ-ONLY. Where can the trading service read its own
# processor ceiling (the `allowed` on the Compute tab) from inside itself? Prints
# the cgroup the service's main process sits in, and that cgroup's ceiling files
# as the kernel holds them, beside what systemd says. Writes nothing, asks the
# service nothing, loads none of its code.
set -uo pipefail
U=ultimate-trading-system.service
PID=$(systemctl show "$U" -p MainPID --value)
echo "systemd: CPUQuotaPerSecUSec=$(systemctl show "$U" -p CPUQuotaPerSecUSec --value) MainPID=$PID"
echo "cgroup filesystem: $(stat -fc %T /sys/fs/cgroup 2>/dev/null)"
echo "/proc/$PID/cgroup:"; sed 's/^/  /' "/proc/$PID/cgroup"
REL=$(awk -F: '$1=="0"{print $3}' "/proc/$PID/cgroup")
if [ -n "$REL" ] && [ -f "/sys/fs/cgroup$REL/cpu.max" ]; then
  echo "v2 cpu.max at /sys/fs/cgroup$REL/cpu.max: $(cat "/sys/fs/cgroup$REL/cpu.max")"
  echo "v2 cpu.stat throttling: $(grep -E 'nr_periods|nr_throttled|throttled_usec' "/sys/fs/cgroup$REL/cpu.stat" | tr '\n' ' ')"
fi
for f in cpu.cfs_quota_us cpu.cfs_period_us; do
  p=$(grep -E ':cpu(,|:)' "/proc/$PID/cgroup" | head -1 | cut -d: -f3)
  [ -n "$p" ] && [ -f "/sys/fs/cgroup/cpu,cpuacct$p/$f" ] && echo "v1 $f: $(cat "/sys/fs/cgroup/cpu,cpuacct$p/$f")"
done
echo "processors: $(nproc)"
