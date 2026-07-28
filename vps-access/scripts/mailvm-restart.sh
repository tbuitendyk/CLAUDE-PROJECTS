#!/usr/bin/env bash
# mailvm-restart.sh -- graceful daily restart of the HOMSMAIL03 guest, with a
# diagnostic snapshot taken BEFORE the reboot so the restarts also tell us what
# is degrading rather than just papering over it.
#
# Owner asked for a daily 09:00 UTC restart (see mailvm-schedule-restart.sh,
# which installs the timer that calls this).
#
# HOW WE KNOW IT ACTUALLY REBOOTED -- learned the hard way. The first version
# waited for port 25 to answer and declared success in five seconds, because
# the guest had not finished SHUTTING DOWN yet and the port it saw was the old
# postfix. It then failed its own post-check ("Connection refused") and still
# exited 0. So:
#   * the snapshot captures the guest's BOOT ID;
#   * we wait for SSH to go away, then come back;
#   * and we only accept the guest once its boot ID has CHANGED.
# A port that answers proves nothing on its own. Nor does a script that exits 0.
#
# Deliberate limitation: if the guest's SSH is unreachable to begin with, this
# LOGS LOUDLY AND FAILS rather than power-cycling the VM. A hard cycle on a
# mail server can drop a message mid-delivery, and `VBoxManage showvminfo` run
# as root reports both guests as "poweroff" while their processes are plainly
# serving -- the registry this box's VMs were started from is not the one root
# sees, so an unattended VM-level power action would be operating on state we
# cannot currently read. Fix that ownership question first.
#
# The guest has ONE vCPU (an IONOS constraint, not a setting) and boots the
# whole iRedMail stack on it, so it comes back slowly. Budget accordingly, and
# probe with plain TCP rather than a burst of SSH handshakes -- repeated
# handshakes alone can saturate its sshd.
#
# Everything is appended to /var/log/mailvm-restart.log with timestamps.
set -uo pipefail

GUEST=192.168.56.129
LOG=/var/log/mailvm-restart.log
DOWN_SECS=180      # how long to wait for the guest to actually go down
UP_SECS=900        # how long to wait for it to come back (1 vCPU, clamav)
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@${GUEST}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$LOG"; }
logblock() { printf '%s\n' "$1" | sed 's/^/    /' | tee -a "$LOG"; }
port_open() { timeout 5 bash -c "echo > /dev/tcp/${GUEST}/$1" 2>/dev/null; }

log "=== restart requested ==="
log "host load: $(cut -d' ' -f1-3 /proc/loadavg)  cpus: $(nproc)"

# ---- ONE session: snapshot (including boot id) ---------------------------
snap=$($SSH 'bash -s' <<'R' 2>&1
echo "BOOT_ID: $(cat /proc/sys/kernel/random/boot_id)"
echo "uptime_s: $(cut -d. -f1 /proc/uptime)   load: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "mem:"; free -m | sed -n '1,3p' | sed 's/^/  /'
echo "services:"
for s in postgresql postfix dovecot amavis clamav-daemon iredapd nginx; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
echo "mail queue: $(mailq 2>/dev/null | tail -1)"
echo "top 5 by RSS:"; ps -eo comm,pmem,rss --sort=-rss 2>/dev/null | head -6 | sed 's/^/  /'
echo "oom kills since boot: $(dmesg 2>/dev/null | grep -ci 'out of memory' || true)"
echo "SNAPSHOT-OK"
R
)
rc=$?
log "pre-restart snapshot (rc=$rc):"
logblock "$snap"

if [ $rc -ne 0 ] || ! printf '%s' "$snap" | grep -q SNAPSHOT-OK; then
  log "FAILED: guest SSH unreachable — NOT power-cycling the VM (see header). Manual attention needed."
  exit 2
fi

OLD_BOOT=$(printf '%s' "$snap" | sed -n 's/^BOOT_ID: //p' | tr -d ' \r')
if [ -z "$OLD_BOOT" ]; then
  log "FAILED: could not read the guest's boot id — refusing to reboot something I cannot verify"
  exit 2
fi
log "boot id before: $OLD_BOOT"

# ---- reboot --------------------------------------------------------------
# --no-block so sshd is not killed out from under a command still waiting to
# return; a dropped connection here is expected either way.
log "issuing guest reboot"
$SSH 'systemctl reboot --no-block' >/dev/null 2>&1 || true

# ---- phase 1: wait for it to actually go down ----------------------------
start=$(date +%s)
went_down=0
while [ $(( $(date +%s) - start )) -lt "$DOWN_SECS" ]; do
  sleep 5
  if ! port_open 22; then went_down=1; break; fi
done
if [ "$went_down" -eq 1 ]; then
  log "guest went down after $(( $(date +%s) - start ))s"
else
  # Not fatal by itself — a very fast reboot could be missed — but the boot-id
  # check below is what actually decides, and it will catch a no-op.
  log "WARNING: never observed the guest go down in ${DOWN_SECS}s; relying on the boot id check"
fi

# ---- phase 2: wait for SSH, then require a NEW boot id -------------------
log "waiting up to ${UP_SECS}s for a new boot id"
start=$(date +%s)
new_boot=""
said_stale=0
while [ $(( $(date +%s) - start )) -lt "$UP_SECS" ]; do
  sleep 10
  port_open 22 || continue          # cheap TCP probe; no SSH handshake yet
  cand=$($SSH 'cat /proc/sys/kernel/random/boot_id' 2>/dev/null | tr -d ' \r')
  [ -n "$cand" ] || continue
  if [ "$cand" != "$OLD_BOOT" ]; then new_boot="$cand"; break; fi
  # Say this once, not every ten seconds — the log is meant to be read.
  if [ "$said_stale" -eq 0 ]; then
    log "  SSH is up but the boot id is unchanged — still the pre-reboot system"
    said_stale=1
  fi
done
elapsed=$(( $(date +%s) - start ))

if [ -z "$new_boot" ]; then
  log "FAILED: no new boot id after ${elapsed}s — the guest did not come back cleanly. Manual attention needed."
  exit 3
fi
log "boot id after:  $new_boot  (back after ${elapsed}s)"

# ---- phase 3: verify, and start postfix if the boot left it down ---------
# clamav and amavis are slow to settle on one core, so they are reported but
# not required. Mail flow needs postfix, dovecot and the listening sockets.
post=$($SSH 'bash -s' <<'R' 2>&1
for s in postgresql postfix dovecot amavis clamav-daemon iredapd nginx; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
if [ "$(systemctl is-active postfix 2>/dev/null)" != active ]; then
  echo "  postfix NOT active after boot -> starting"
  systemctl start postfix 2>&1 | sed 's/^/    /'
  sleep 3
fi
echo "  postfix final : $(systemctl is-active postfix 2>/dev/null)"
echo "  dovecot final : $(systemctl is-active dovecot 2>/dev/null)"
echo "  listening 25/587: $(ss -ltn 2>/dev/null | grep -cE ':25 |:587 ') socket(s)"
echo "  uptime_s: $(cut -d. -f1 /proc/uptime)   load: $(cut -d' ' -f1-3 /proc/loadavg)"
echo "VERIFY-OK"
R
)
prc=$?
log "post-restart state (rc=$prc):"
logblock "$post"

if [ $prc -ne 0 ] || ! printf '%s' "$post" | grep -q VERIFY-OK; then
  log "FAILED: could not verify the guest after reboot"
  exit 4
fi
if ! printf '%s' "$post" | grep -q "postfix final : active"; then
  log "FAILED: postfix is not active after the restart"
  exit 5
fi
if ! printf '%s' "$post" | grep -q "dovecot final : active"; then
  log "FAILED: dovecot is not active after the restart"
  exit 6
fi

log "=== restart complete and verified ==="
