#!/usr/bin/env bash
# host-health.sh -- read-only snapshot of the VPS host: load, memory, swap,
# steal time, and the heaviest processes. Written while diagnosing whether a
# 3-worker classifier job was starving the mail VM; the question "is the host
# actually under pressure" had no cheap answer before this.
#
# Read-only. Changes nothing, starts nothing, stops nothing.
set -uo pipefail
echo "===== CPU inventory ====="
echo "  nproc            : $(nproc 2>/dev/null || echo '?')"
echo "  /proc/cpuinfo    : $(grep -c ^processor /proc/cpuinfo 2>/dev/null || echo '?')"
lscpu 2>/dev/null | grep -E "^(Model name|CPU\(s\)|Thread\(s\) per core|Core\(s\) per socket|Socket\(s\)):" | sed 's/^/  /'
echo "  node os.cpus()   : $(node -e 'console.log(require("os").cpus().length)' 2>/dev/null || echo 'node not on PATH')"
echo
echo "===== VirtualBox VMs (owner, name, allocated cpus/RAM) ====="
for pid in $(pgrep -f VirtualBoxVM); do
  owner=$(ps -o user= -p "$pid" | tr -d ' ')
  name=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | sed -n 's/.*--comment \([^ ]*\).*/\1/p')
  echo "  pid=$pid owner=$owner name=${name:-?}"
  if command -v VBoxManage >/dev/null 2>&1 && [ -n "${name:-}" ]; then
    sudo -n -u "$owner" VBoxManage showvminfo "$name" --machinereadable 2>/dev/null \
      | grep -E "^(cpus|memory|VMState)=" | sed 's/^/      /' || echo "      (cannot query as $owner)"
  fi
done
echo
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
echo "===== classifier THREAD priorities (workers must sit at nice 19) ====="
# Per-process nice hides this: on Linux nice is per-thread, and the whole
# point of the fix is that the workers are niced while the thread serving the
# web UI is not. Only a per-thread listing can show that.
# The unit runs plain `node server.js`, so a command-line match finds nothing;
# ask systemd for the PID instead.
cpid=$(systemctl show -p MainPID --value general-classifier.service 2>/dev/null)
if [ -n "${cpid:-}" ] && [ "$cpid" != "0" ]; then
  ps -L -o pid,tid,ni,pcpu,comm -p "$cpid" | head -12
  echo "  (expect: several TIDs at 19 = workers, the rest at 0)"
else
  echo "  classifier process not found"
fi
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
