#!/usr/bin/env bash
# mailvm-outage-diag.sh -- READ-ONLY characterisation of a HOMSMAIL03 outage in
# which the guest ANSWERS PING but every service port is refused.
#
# Why this exists (2026-08-10): the mail watcher went silent because IMAP
# returned "No route to host". mailvm-liveness.sh then showed the guest pinging
# happily while 22/25/587/465/143/993/5432 were all refused -- i.e. the VM is
# running and its network stack is up, but nothing inside is serving.
#
# That is EXACTLY the state mailvm-restart.sh refuses to act on, by design:
# with SSH down we cannot snapshot the guest, and VBoxManage as root reports
# "poweroff" for a VM whose process is plainly alive, so any power action would
# be operating on state we cannot read. This script therefore takes NO action.
# It only gathers what the host can see from outside the guest, so whoever
# reads it next knows WHEN mail died and what the host was doing at the time.
#
# Read-only. No systemctl, no VBoxManage control verbs, no writes to the guest.
set -uo pipefail

GUEST=192.168.56.129
VM=HOMSMAIL03

echo "== when did the daily restart last succeed? (tail of restart log) =="
if [ -r /var/log/mailvm-restart.log ]; then
  tail -40 /var/log/mailvm-restart.log | sed 's/^/  /'
else
  echo "  (no /var/log/mailvm-restart.log readable)"
fi

echo
echo "== restart timer state =="
systemctl list-timers --all 2>/dev/null | grep -i mailvm | sed 's/^/  /' || echo "  (no mailvm timer listed)"
systemctl is-active mailvm-restart.timer 2>/dev/null | sed 's/^/  timer active: /'

echo
echo "== host resources (a full host disk starves the guest image) =="
df -h / /var 2>/dev/null | sed 's/^/  /'
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)   cpus: $(nproc)"
free -m 2>/dev/null | sed -n '1,3p' | sed 's/^/  /'

echo
echo "== VM process: alive, and for how long? =="
ps -o pid,etime,rss,stat,comm -p "$(pgrep -f "VirtualBoxVM.*--comment $VM" | head -1)" 2>/dev/null | sed 's/^/  /' \
  || echo "  (no VirtualBoxVM process matching $VM)"

echo
echo "== host kernel: OOM kills only (UFW/vboxnet chatter excluded -- it drowns"
echo "   everything else, and the deploy endpoint returns only the TAIL of stdout) =="
dmesg -T 2>/dev/null | grep -iE 'out of memory|killed process|oom-kill' | tail -10 | sed 's/^/  /' \
  || true
echo "  (end of OOM extract)"

echo
echo "== last UFW block from the guest (timing clue only, one line) =="
dmesg -T 2>/dev/null | grep 'UFW BLOCK' | grep 'SRC=192.168.56.129' | tail -1 | cut -c1-120 | sed 's/^/  /' \
  || echo "  (none)"

echo
echo "== guest reachability right now =="
ping -c2 -W2 "$GUEST" >/dev/null 2>&1 && echo "  ping: OK (guest kernel is up)" || echo "  ping: FAILS (guest is down or networkless)"
for p in 22 25 587 465 143 993 5432; do
  if timeout 3 bash -c "echo > /dev/tcp/$GUEST/$p" 2>/dev/null; then
    echo "  $p OPEN"
  else
    echo "  $p refused"
  fi
done

echo
echo "== interpretation guide =="
echo "  ping OK + ALL ports refused  -> guest booted but the service stack did not"
echo "                                  come up (disk full, OOM, or emergency mode)."
echo "                                  SSH is gone, so the only fix is at the VM"
echo "                                  level -- and that needs a human, per the"
echo "                                  refusal documented in mailvm-restart.sh."
echo "  ping OK + 22 OPEN            -> transient service fault; mailvm-restart.sh"
echo "                                  can handle it (it snapshots then reboots)."
echo "  ping FAILS                   -> guest is genuinely down; mailvm-start.sh."
echo
echo "(read-only; no changes made)"
