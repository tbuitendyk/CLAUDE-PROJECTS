#!/usr/bin/env bash
# mailvm-stop-headless.sh -- power off ONLY the endpoint-started HEADLESS
# instance of HOMSMAIL03 (the phantom), leaving the desktop GUI instance
# (VirtualBoxVM) untouched. The endpoint's VBoxManage only knows its own
# (headless) session, so controlvm cannot reach the GUI instance. Verifies
# before/after and hard-kills the exact headless PID if needed.
set -uo pipefail
UUID=f50c86e7-f8d9-419b-8229-ab7cf1e405f2
echo "== BEFORE =="
ps -eo pid,etimes,comm 2>/dev/null | awk 'NR==1 || /VBoxHeadless|VirtualBoxVM/' | sed 's/^/  /'
HL=$(pgrep -f 'VBoxHeadless.*--comment HOMSMAIL03' 2>/dev/null | head -1)
GUI=$(pgrep -f 'VirtualBoxVM.*--comment HOMSMAIL03' 2>/dev/null | head -1)
echo "  headless(phantom to stop)=$HL   gui(keep)=$GUI"
[ -n "$HL" ] || { echo "No headless HOMSMAIL03 running -- nothing to do."; exit 0; }

echo "== poweroff headless via endpoint VBoxManage (its context = the headless one) =="
VBoxManage controlvm "$UUID" poweroff 2>&1 | sed 's/^/  /' || true
sleep 4
if kill -0 "$HL" 2>/dev/null; then
  echo "  headless PID $HL still alive -> SIGKILL that exact PID (no disk flush)"
  kill -9 "$HL" 2>/dev/null || true; sleep 3
fi

echo "== AFTER =="
ps -eo pid,etimes,comm 2>/dev/null | awk 'NR==1 || /VBoxHeadless|VirtualBoxVM/' | sed 's/^/  /'
still_hl=$(pgrep -f 'VBoxHeadless.*--comment HOMSMAIL03' 2>/dev/null | head -1)
still_gui=$(pgrep -f 'VirtualBoxVM.*--comment HOMSMAIL03' 2>/dev/null | head -1)
echo "  headless now: ${still_hl:-GONE (good)}"
echo "  gui instance now: ${still_gui:-MISSING (!!)}"
if [ -z "$still_hl" ] && [ -n "$still_gui" ]; then
  echo "RESULT: OK -- only your GUI instance ($still_gui) remains."
elif [ -z "$still_hl" ] && [ -z "$still_gui" ]; then
  echo "RESULT: both are now down -- start your GUI instance when ready."
else
  echo "RESULT: headless still present -- do NOT start another; tell me."
fi
