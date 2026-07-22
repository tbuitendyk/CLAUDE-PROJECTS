#!/usr/bin/env bash
# vbox-vm-config.sh -- READ-ONLY: list VirtualBox guests with their vCPU count,
# RAM, exec-cap and run state, plus host core count/load. Makes no changes.
# Used to size a vCPU bump for the mail VM (HOMSMAIL03), which runs the full
# iRedMail stack on a single vCPU and is CPU-starved.
set -uo pipefail
echo "host: $(nproc) cores, load$(cut -d' ' -f1-3 /proc/loadavg | sed 's/^/ /')"
echo
VBoxManage list vms 2>/dev/null | sed -E 's/^"([^"]+)".*/\1/' | while read -r vm; do
  [ -z "$vm" ] && continue
  echo "=== $vm ==="
  VBoxManage showvminfo "$vm" --machinereadable 2>/dev/null \
    | grep -iE '^(cpus|memory|cpuexecutioncap|VMState|ostype)=' \
    | sed 's/^/   /'
  echo
done
echo "(read-only; no changes made)"
