#!/usr/bin/env bash
# vbox-run-context.sh -- READ-ONLY: reveal exactly how the VirtualBox guests
# are launched, so a later stop/modify/start targets the REAL running
# instance (root's VBoxManage reports the running VMs as "poweroff", meaning
# they run under a different VBOX_USER_HOME/user). Makes no changes.
set -uo pipefail
echo "=== VM processes (owner, pid, key args) ==="
ps -eo user,pid,args 2>/dev/null | grep -iE 'VBoxHeadless|VirtualBoxVM|VBoxSVC' | grep -v grep \
  | sed -E 's/--sup[a-z-]+ [^ ]+//g; s#(/usr/lib/virtualbox/)##' | cut -c1-160
echo
echo "=== per-process owner + VBOX_USER_HOME + comment (which VM) ==="
for pid in $(pgrep -f 'VBoxHeadless|VirtualBoxVM' 2>/dev/null); do
  owner=$(stat -c '%U' "/proc/$pid" 2>/dev/null)
  vh=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^VBOX_USER_HOME=/  home=/p'); [ -z "$vh" ] && vh="  home=(default ~$owner/.config/VirtualBox)"
  cm=$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -iA1 -- '--comment' | tail -1)
  echo "  pid=$pid owner=$owner$vh  comment=${cm:-?}"
done
echo
echo "=== runningvms as seen by root (default context) ==="
VBoxManage list runningvms 2>&1 | head
echo
echo "=== VBoxAutostart / systemd / rc launch config ==="
systemctl list-units --all 2>/dev/null | grep -iE 'vbox|virtualbox' | grep -v grep || echo "  (no vbox systemd units)"
grep -rsiE 'VBOXAUTOSTART_(DB|CONFIG)|startvm|VBOX_USER_HOME' /etc/default/virtualbox /etc/vbox /etc/rc.local 2>/dev/null | cut -c1-140 | head -12
echo "  crontab @reboot entries:"; { crontab -l 2>/dev/null; for u in vbox virtualbox; do crontab -lu "$u" 2>/dev/null; done; } | grep -iE 'startvm|vboxmanage|@reboot' | head -6 || true
echo
echo "(read-only; no changes made)"
