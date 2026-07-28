#!/usr/bin/env bash
# host-runaway-probe.sh -- READ-ONLY: what are the long-running processes on
# this host actually doing, and who started them?
#
# Written because the box went I/O-bound with several greps alive for half an
# hour and "%CPU + COMMAND" is not enough to say why. Prints full command
# lines, parents, elapsed time and open files for anything older than five
# minutes that is not a normal service.
set -uo pipefail
echo "===== processes older than 5 min, sorted by elapsed (non-service) ====="
ps -eo pid,ppid,etimes,pcpu,pmem,stat,user,args --sort=-etimes \
  | awk 'NR==1 || ($3+0)>300' \
  | grep -vE "systemd|VBox|VirtualBox|dbus|cron|agetty|sshd:|rsyslog|postgres|nginx|uvicorn|Xtightvnc|xfce|xfdesktop|xfwm|panel|polkit|udisks|ModemManager|NetworkManager|accounts-daemon|node /opt|node server" \
  | head -25
echo
echo "===== anything in D state (blocked on I/O) ====="
ps -eo pid,ppid,stat,etimes,args | awk '$3 ~ /D/' | head -15
echo
echo "===== what the oldest grep is reading ====="
for pid in $(ps -eo pid,args | awk '/[g]rep/ {print $1}' | head -3); do
  echo "  --- pid $pid ---"
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-220; echo
  echo "    parent: $(ps -o args= -p "$(ps -o ppid= -p "$pid" | tr -d ' ')" 2>/dev/null | cut -c1-160)"
  ls -l /proc/$pid/fd 2>/dev/null | awk '{print "    fd: "$NF}' | head -5
  echo "    io: $(awk '/read_bytes/{printf "read %.1fGB ", $2/1073741824} /write_bytes/{printf "written %.1fMB", $2/1048576}' /proc/$pid/io 2>/dev/null)"
done
echo
echo "===== deploy-control children ====="
pgrep -af "claude-deploy|run-script" | head -10 || echo "  none"
echo "(read-only; nothing killed)"
