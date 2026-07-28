#!/usr/bin/env bash
# host-clear-probe-runaways.sh -- kill STACKED recursive greps left behind by
# aws-mex-probe.sh, which are I/O-starving the box and the mail guest with it.
#
# Narrow on purpose. It matches only greps whose command line contains the
# probe's own pattern, reports each one before killing it, and touches nothing
# else — no services, no jobs, no VMs. A read-only grep is about the safest
# thing on the box to terminate: nothing is half-written when it dies.
#
# This is a symptom fix. The defect is in aws-mex-probe.sh (see the bounded
# search added alongside this): a recursive walk of /root takes tens of
# minutes here, and anything firing the probe on a timer stacks a fresh walk
# before the last has finished.
set -uo pipefail
PAT='grep -rlsE aws-mex-deb13'
mapfile -t PIDS < <(pgrep -af "$PAT" | awk '{print $1}')
if [ "${#PIDS[@]}" -eq 0 ]; then
  echo "no stacked probe greps found"
else
  echo "found ${#PIDS[@]} stacked probe grep(s):"
  for p in "${PIDS[@]}"; do
    printf '  pid %-7s elapsed %-8s read %s\n' "$p" \
      "$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')s" \
      "$(awk '/read_bytes/{printf "%.1fGB", $2/1073741824}' /proc/$p/io 2>/dev/null)"
  done
  kill -TERM "${PIDS[@]}" 2>/dev/null || true
  sleep 3
  mapfile -t LEFT < <(pgrep -af "$PAT" | awk '{print $1}')
  [ "${#LEFT[@]}" -gt 0 ] && { echo "  ${#LEFT[@]} did not exit on TERM; sending KILL"; kill -KILL "${LEFT[@]}" 2>/dev/null || true; }
fi
sleep 2
echo
echo "== host after =="
uptime
echo "load/io:"; vmstat 1 3 | tail -2
echo
echo "== mail guest reachability =="
for port in 22 25 587; do
  timeout 5 bash -c "echo > /dev/tcp/192.168.56.129/$port" 2>/dev/null \
    && echo "  $port OPEN" || echo "  $port closed/refused"
done
