#!/usr/bin/env bash
# mailvm-add-vcpu.sh -- fix HOMSMAIL03 CPU starvation by raising it from 1 to
# 2 vCPUs. The full iRedMail stack on a single core drives load to 5-9x and
# starves sshd + PostgreSQL (slow SSH prompt, Dovecot quota timeouts); the
# host has 8 cores at load ~1.3. Also masks the failed clamav-clamonacc unit
# (iRedMail scans on demand via amavis->clamd; on-access scanning is unused).
#
# DISRUPTIVE: briefly reboots the mail VM (~2-4 min; senders retry, queue is
# empty). SAFE METHOD: power off from INSIDE the guest (releases the .vbox
# lock so root's VBoxManage can edit it -- the live VM runs under the desktop
# VirtualBox session, invisible to the endpoint's context), then modifyvm and
# start headless. Idempotent: no-op if the guest already reports 2 vCPUs.
# Always attempts to bring the VM back; prints recovery steps if start fails.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
VM=HOMSMAIL03
IP=192.168.56.129
WANT=2
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root@$IP"

echo "=== before ==="
before=$($SSH 'echo "nproc=$(nproc) load=$(cut -d\  -f1-3 /proc/loadavg) uptime=$(cut -d. -f1 /proc/uptime)s"' 2>/dev/null || true)
echo "  guest: ${before:-UNREACHABLE}"
cur=$($SSH nproc 2>/dev/null || true)
if [ -z "$cur" ]; then echo "ABORT: guest unreachable over SSH -- not touching power." >&2; exit 1; fi
if [ "$cur" -ge "$WANT" ] 2>/dev/null; then echo "guest already has $cur vCPUs (>= $WANT) -- nothing to do."; exit 0; fi

echo "=== mask on-access scanner + power off guest from inside ==="
$SSH 'systemctl mask --now clamav-clamonacc.service >/dev/null 2>&1; echo "  clamonacc masked (rc=$?)"; systemctl --no-block poweroff' 2>/dev/null || true
echo "  poweroff issued; waiting for the VM process to exit (<=120s)..."
gone=0
for i in $(seq 1 60); do
  pgrep -f "VirtualBoxVM.*--comment $VM" >/dev/null 2>&1 || { gone=1; break; }
  sleep 2
done
[ "$gone" = 1 ] || { echo "ABORT: VM process still alive after ~120s; left running, no change." >&2; exit 1; }
echo "  VM powered off (process gone); pausing for lock release..."; sleep 4

echo "=== apply cpus=$WANT (ioapic on, required for SMP) ==="
if VBoxManage modifyvm "$VM" --cpus "$WANT" --ioapic on 2>&1 | sed 's/^/  /'; then
  echo "  modifyvm OK"
else
  echo "  WARNING: modifyvm failed -- will still restart the VM with its original config." >&2
fi

echo "=== start headless ==="
start_out="$(VBoxManage startvm "$VM" --type headless 2>&1)"; echo "$start_out" | sed 's/^/  /'
if ! echo "$start_out" | grep -qiE 'successfully started|VM ".*" has been successfully started'; then
  echo "  !!! START FAILED. The mail VM is currently OFF. Recover from the host desktop session:" >&2
  echo "      VBoxManage startvm $VM --type headless    (in the desktop/root X session)" >&2
  echo "      or start '$VM' from the VirtualBox GUI." >&2
  exit 1
fi

echo "=== wait for guest SSH to return (<=180s) ==="
back=0
for i in $(seq 1 60); do sleep 3; $SSH true 2>/dev/null && { back=1; break; }; done
[ "$back" = 1 ] || { echo "WARNING: guest not back on SSH after ~180s -- check the console." >&2; exit 1; }

echo "=== after ==="
$SSH 'echo "  nproc=$(nproc)  load=$(cut -d\  -f1-3 /proc/loadavg)"; echo "  services:"; for s in postfix dovecot postgresql amavis clamav-daemon iredapd nginx; do printf "    %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"; done' 2>/dev/null
echo "=== done: HOMSMAIL03 now has $WANT vCPUs ==="
