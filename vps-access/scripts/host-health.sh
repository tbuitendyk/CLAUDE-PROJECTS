#!/usr/bin/env bash
# host-health.sh -- read-only snapshot of the VPS host: load, memory, swap,
# steal time, and the heaviest processes. Written while diagnosing whether a
# 3-worker classifier job was starving the mail VM; the question "is the host
# actually under pressure" had no cheap answer before this.
#
# Read-only. Changes nothing, starts nothing, stops nothing.
set -uo pipefail
echo "===== uptime / load ====="
uptime
echo
echo "===== memory (MB) ====="
free -m
echo
echo "===== swap activity + CPU steal (5 x 1s) ====="
vmstat 1 5 2>/dev/null | tail -6
echo
echo "===== top 8 by CPU ====="
ps -eo pid,comm,pcpu,pmem,rss,stat,etime --sort=-pcpu | head -9
echo
echo "===== top 8 by RSS ====="
ps -eo pid,comm,pcpu,pmem,rss,stat,etime --sort=-rss | head -9
echo
echo "===== classifier + VM processes ====="
ps -eo pid,comm,pcpu,pmem,rss,nice,stat,etime | grep -Ei "node|VirtualBox|vbox" | grep -v grep || echo "  none"
echo
echo "===== VirtualBox guest allocation ====="
if command -v VBoxManage >/dev/null 2>&1; then
  vm=$(VBoxManage list runningvms | head -1 | sed 's/^"\(.*\)".*/\1/')
  if [ -n "$vm" ]; then
    VBoxManage showvminfo "$vm" --machinereadable 2>/dev/null \
      | grep -E "^(name|cpus|memory|VMState)=" || echo "  no info"
  else
    echo "  no running VMs"
  fi
else
  echo "  VBoxManage not on PATH"
fi
echo
echo "===== done (read-only) ====="
