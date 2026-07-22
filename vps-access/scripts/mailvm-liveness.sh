#!/usr/bin/env bash
# mailvm-liveness.sh -- READ-ONLY: is the mail VM (HOMSMAIL03) alive, and which
# service ports answer from the host? Distinguishes "whole guest down" from
# "just sshd down, mail still serving". Makes no changes.
set -uo pipefail
IP=192.168.56.129
echo "== VirtualBoxVM process on host =="
pgrep -af 'VirtualBoxVM.*--comment HOMSMAIL03' || echo "  NOT RUNNING -- no VirtualBoxVM process for HOMSMAIL03"
echo "== host-only interface =="
ip -brief addr show vboxnet0 2>/dev/null | sed 's/^/  /' || echo "  vboxnet0 not found"
echo "== ping guest =="
ping -c2 -W2 "$IP" 2>&1 | tail -3 | sed 's/^/  /'
echo "== port reachability from host (22=ssh, 25/587/465=smtp, 143/993=imap, 5432=pg) =="
for p in 22 25 587 465 143 993 5432; do
  if timeout 3 bash -c "echo > /dev/tcp/$IP/$p" 2>/dev/null; then
    echo "  $p OPEN"
  else
    echo "  $p closed/refused"
  fi
done
echo "(read-only; no changes made)"
