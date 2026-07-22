#!/usr/bin/env bash
# mailvm-tune-apply.sh -- ONE SSH session: reduce single-core CPU load on
# HOMSMAIL03, guarded and reversible. Multi-core guests aren't available on
# this IONOS host, so the lever is making the one core do less:
#   1) cap amavis to $max_servers=2 via a 99- conf.d drop-in (overrides current;
#      revert = delete the file). Restart amavis, auto-rollback if it fails.
#   2) mask the failed clamav-clamonacc on-access scanner.
#   3) freshclam -> 2 checks/day (fewer ~1GB clamd DB-reload spikes); config
#      only, no restart -- applies on freshclam's next cycle.
# GUARD: aborts before any change unless all core services are active, the mail
# queue is small, and 1-min load is not pathological. Backs up edited files.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
set -uo pipefail
TS=$(date +%Y%m%d-%H%M%S); BK=/root/mail-tune-backup-$TS

echo "### STATE ###"
load1=$(cut -d' ' -f1 /proc/loadavg)
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)   up: $(cut -d. -f1 /proc/uptime)s"
allok=1
for s in postfix dovecot postgresql amavis clamav-daemon iredapd nginx; do
  st=$(systemctl is-active "$s" 2>/dev/null); printf "  %-16s %s\n" "$s" "$st"
  [ "$st" = active ] || allok=0
done
qn=$(mailq 2>/dev/null | grep -cE '^[0-9A-F]{8,}' || true); qn=${qn:-0}
echo "  mail queue entries: $qn"
cur_ms=$(grep -rhoE '\$max_servers[[:space:]]*=[[:space:]]*[0-9]+' /etc/amavis/conf.d/ 2>/dev/null | grep -oE '[0-9]+' | head -1)
echo "  current amavis \$max_servers: ${cur_ms:-<unset/default>}   amavisd procs: $(ps -ef | grep -c '[a]mavisd')"

# ---- GUARD ----
[ "$allok" = 1 ] || { echo "ABORT: not all core services active -- not a good time."; exit 3; }
[ "$qn" -le 200 ] || { echo "ABORT: mail queue backed up ($qn) -- not a good time."; exit 3; }
awk -v l="$load1" 'BEGIN{exit !(l>15)}' && { echo "ABORT: 1-min load $load1 too high -- not a good time."; exit 3; }
echo "GUARD PASSED (services healthy, queue $qn, load $load1). Applying."
mkdir -p "$BK"

echo "### 1) amavis \$max_servers -> 2 ###"
CONFDIR=/etc/amavis/conf.d
if [ -d "$CONFDIR" ]; then
  DROP="$CONFDIR/99-single-core-tune"
  printf '# single-core tuning: cap amavis preforked workers (revert: rm this file, restart amavis)\n$max_servers = 2;\n1;\n' > "$DROP"
  echo "  wrote $DROP"
  echo "  restarting amavis..."
  systemctl restart amavis; sleep 3
  if [ "$(systemctl is-active amavis 2>/dev/null)" != active ]; then
    echo "  !! amavis did NOT come active -- ROLLING BACK (removing drop-in)"; rm -f "$DROP"
    systemctl restart amavis; sleep 3
    echo "  amavis after rollback: $(systemctl is-active amavis 2>/dev/null)"
  else
    echo "  amavis active; amavisd procs now: $(ps -ef | grep -c '[a]mavisd')"
  fi
else
  echo "  /etc/amavis/conf.d not found -- skipping (unexpected layout; no change made)"
fi

echo "### 2) mask clamav-clamonacc ###"
systemctl mask --now clamav-clamonacc.service 2>&1 | sed 's/^/  /' || true
echo "  clamonacc: active=$(systemctl is-active clamav-clamonacc 2>/dev/null) enabled=$(systemctl is-enabled clamav-clamonacc 2>/dev/null)"

echo "### 3) freshclam Checks -> 2/day (config only, no restart) ###"
fc=/etc/clamav/freshclam.conf
if [ -f "$fc" ]; then
  cp -a "$fc" "$BK/freshclam.conf.bak"
  if grep -qiE '^[[:space:]]*Checks[[:space:]]+' "$fc"; then
    sed -i -E 's/^([[:space:]]*[Cc]hecks[[:space:]]+)[0-9]+/\12/' "$fc"
  else
    echo "Checks 2" >> "$fc"
  fi
  echo "  $(grep -iE '^[[:space:]]*Checks' "$fc" | head -1)  (takes effect on next clamav-freshclam restart/reboot)"
fi

echo "### POST-STATE ###"
for s in postfix dovecot postgresql amavis clamav-daemon iredapd nginx; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)   amavisd procs: $(ps -ef | grep -c '[a]mavisd')"
echo "  queue: $(postqueue -p 2>/dev/null | tail -1)"
echo "### REVERT: rm /etc/amavis/conf.d/99-single-core-tune && systemctl restart amavis ;"
echo "###         systemctl unmask clamav-clamonacc ; cp $BK/freshclam.conf.bak /etc/clamav/freshclam.conf ###"
R
