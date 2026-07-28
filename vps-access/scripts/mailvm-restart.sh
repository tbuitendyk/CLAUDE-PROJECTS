#!/usr/bin/env bash
# mailvm-restart.sh -- graceful daily restart of the HOMSMAIL03 guest, with a
# diagnostic snapshot taken BEFORE the reboot so the restarts also tell us what
# is degrading rather than just papering over it.
#
# Owner asked for a daily 09:00 UTC restart (see mailvm-schedule-restart.sh,
# which installs the timer that calls this).
#
# Deliberate limitation: if the guest's SSH is unreachable, this LOGS LOUDLY
# AND FAILS rather than power-cycling the VM. Two reasons. A hard cycle on a
# mail server can drop a message mid-delivery, and `VBoxManage showvminfo`
# run as root reports both guests as "poweroff" while their processes are
# plainly running and serving — the registry this box's VMs were started from
# is not the one root sees, so an unattended VM-level power action would be
# operating on state we cannot currently read. Fix that ownership question
# first, then a fallback can be added safely.
#
# Everything is appended to /var/log/mailvm-restart.log with timestamps.
set -uo pipefail

GUEST=192.168.56.129
LOG=/var/log/mailvm-restart.log
WAIT_SECS=300
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@${GUEST}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG"; }

log "=== restart requested ==="

# ---- host side, before anything ------------------------------------------
log "host load: $(cut -d' ' -f1-3 /proc/loadavg)  cpus: $(nproc)"

# ---- ONE session: snapshot then ask for the reboot ------------------------
# One connection, not several: this guest has a single vCPU and repeated SSH
# handshakes saturate its sshd all by themselves.
snap=$($SSH 'bash -s' <<'R' 2>&1
echo "uptime_s: $(cut -d. -f1 /proc/uptime)   load: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "mem:"; free -m | sed -n '1,3p' | sed 's/^/  /'
echo "services:"
for s in postgresql postfix dovecot amavis clamav-daemon iredapd nginx; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
echo "mail queue: $(mailq 2>/dev/null | tail -1)"
echo "top 5 by RSS:"; ps -eo comm,pmem,rss --sort=-rss 2>/dev/null | head -6 | sed 's/^/  /'
echo "oom kills since boot: $(dmesg 2>/dev/null | grep -ci 'out of memory' || echo 0)"
echo "SNAPSHOT-OK"
R
)
rc=$?
printf '%s\n' "$snap" | sed 's/^/    /' | tee -a "$LOG" >/dev/null
log "pre-restart snapshot (rc=$rc):"
printf '%s\n' "$snap" | sed 's/^/    /'

if [ $rc -ne 0 ] || ! printf '%s' "$snap" | grep -q SNAPSHOT-OK; then
  log "FAILED: guest SSH unreachable — NOT power-cycling the VM (see header). Manual attention needed."
  exit 2
fi

# ---- reboot --------------------------------------------------------------
# --no-block so sshd is not killed out from under a command still waiting to
# return; a dropped connection here is expected either way.
log "issuing guest reboot"
$SSH 'systemctl reboot --no-block' >/dev/null 2>&1 || true

# ---- wait for it to come back -------------------------------------------
log "waiting up to ${WAIT_SECS}s for port 25 to answer"
start=$(date +%s)
back=0
while [ $(( $(date +%s) - start )) -lt "$WAIT_SECS" ]; do
  sleep 5
  if timeout 5 bash -c "echo > /dev/tcp/${GUEST}/25" 2>/dev/null; then back=1; break; fi
done
elapsed=$(( $(date +%s) - start ))

if [ "$back" -ne 1 ]; then
  log "FAILED: port 25 still not answering after ${elapsed}s"
  exit 3
fi
log "port 25 answering after ${elapsed}s"

# ---- verify, and start postfix if the boot left it down ------------------
post=$($SSH 'bash -s' <<'R' 2>&1
for s in postgresql postfix dovecot amavis clamav-daemon iredapd nginx; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
if [ "$(systemctl is-active postfix 2>/dev/null)" != active ]; then
  echo "  postfix NOT active after boot -> starting"
  systemctl start postfix 2>&1 | sed 's/^/    /'
  sleep 3
  echo "  postfix now: $(systemctl is-active postfix 2>/dev/null)"
fi
echo "  listening on 25/587: $(ss -ltn 2>/dev/null | grep -cE ':25 |:587 ') socket(s)"
R
)
log "post-restart state:"
printf '%s\n' "$post"
printf '%s\n' "$post" >> "$LOG"
log "=== restart complete ==="
