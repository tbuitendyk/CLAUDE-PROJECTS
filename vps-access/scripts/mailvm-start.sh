#!/usr/bin/env bash
# mailvm-start.sh -- RECOVERY: bring HOMSMAIL03 back up after a poweroff.
# Forces the SUPPORTED single-vCPU config (multi-core guests are not available
# on this IONOS host) so the guest boots cleanly even if a --cpus change had
# landed, then starts it headless. Verifies with a LIGHT touch (ping + single
# TCP port probes), NOT repeated SSH sessions -- those saturate sshd on one core.
set -uo pipefail
VM=HOMSMAIL03
IP=192.168.56.129

echo "== is the VM already running? =="
if pgrep -af "VirtualBoxVM.*--comment $VM|VBoxHeadless.*--comment $VM" >/dev/null 2>&1; then
  echo "  a VM process for $VM is already present -- NOT starting a second instance."
else
  echo "  not running -- recovering."
  echo "== force supported single-vCPU config =="
  VBoxManage modifyvm "$VM" --cpus 1 2>&1 | sed 's/^/  /' && echo "  cpus=1 set" || echo "  (modifyvm reported an issue; continuing to start)"
  echo "== start $VM headless =="
  VBoxManage startvm "$VM" --type headless 2>&1 | sed 's/^/  /'
fi

echo "== waiting for the guest to answer (ping + ssh port), light touch =="
up=0
for i in $(seq 1 50); do
  sleep 3
  if ping -c1 -W2 "$IP" >/dev/null 2>&1 && timeout 3 bash -c "echo > /dev/tcp/$IP/22" 2>/dev/null; then
    up=1; echo "  guest answering ping + port 22 after ~$((i*3))s"; break
  fi
done
if [ "$up" = 1 ]; then
  echo "== light service-port check (single connects, no bursts) =="
  for p in 25 587 993 143 465; do
    timeout 3 bash -c "echo > /dev/tcp/$IP/$p" 2>/dev/null && echo "  $p OPEN" || echo "  $p not yet"
  done
  echo "DONE: $VM is back up -- your ssh should connect now."
else
  echo "WARNING: guest not answering after ~150s. It may still be booting; if not,"
  echo "start '$VM' from the VirtualBox GUI on the host desktop session."
fi
