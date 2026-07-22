#!/usr/bin/env bash
# mailvm-instances.sh -- READ-ONLY: how many instances of the mail VM are
# running right now and of what type (VBoxHeadless = endpoint-started phantom;
# VirtualBoxVM = desktop GUI). Detects a dangerous double-run. No changes.
set -uo pipefail
echo "== mail VM processes on host =="
ps -eo pid,user,etimes,comm 2>/dev/null | awk 'NR==1 || /VBoxHeadless|VirtualBoxVM/' | sed 's/^/  /'
echo "-- with --comment HOMSMAIL03 --"
pgrep -af -- '--comment HOMSMAIL03' 2>/dev/null | sed -E 's/--sup[a-z-]+ [^ ]+//g' | cut -c1-120 | sed 's/^/  /' || echo "  (none)"
echo "== VBoxManage runningvms (endpoint context) =="
VBoxManage list runningvms 2>&1 | sed 's/^/  /'
echo "== HOMSMAIL03 VMState (endpoint view) =="
VBoxManage showvminfo HOMSMAIL03 --machinereadable 2>/dev/null | grep -iE '^VMState=' | sed 's/^/  /'
