#!/usr/bin/env bash
# mailvm-disable-netdata-and-tune.sh -- ONE SSH session on HOMSMAIL03:
#   0) show the real security daemons (fail2ban/iRedAPD/postfix) -- untouched
#   1) DISABLE netdata (+ its updater timer): the biggest single-core CPU hog,
#      pure monitoring, no security role. Reversible: systemctl enable --now netdata
#   2) amavis $max_servers 4->2 via a 99- conf.d drop-in; restart amavis with
#      auto-rollback if it doesn't come active within ~12s
#   3) mask the failed clamav-clamonacc on-access scanner
#   4) freshclam -> 2 checks/day (config only)
# Aborts before changes only if a core mail service is DOWN or the queue is huge.
# Backs up edited files; prints exact revert commands.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
set -uo pipefail
TS=$(date +%Y%m%d-%H%M%S); BK=/root/mail-tune-backup-$TS; mkdir -p "$BK"

echo "### security stack (NOT touched) ###"
for s in fail2ban iredapd postfix; do printf "  %-12s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"; done
fail2ban-client status 2>/dev/null | grep -i 'jail list' | sed 's/^/  /' || true

echo "### pre-check ###"
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)"
allok=1
for s in postfix dovecot postgresql amavis clamav-daemon; do
  [ "$(systemctl is-active "$s" 2>/dev/null)" = active ] || { echo "  DOWN: $s"; allok=0; }
done
qn=$(mailq 2>/dev/null | grep -cE '^[0-9A-F]{8,}' || true); qn=${qn:-0}
echo "  queue: $qn"
[ "$allok" = 1 ] || { echo "ABORT: a core mail service is down."; exit 3; }
[ "$qn" -le 500 ] || { echo "ABORT: queue too large ($qn)."; exit 3; }

echo "### 1) DISABLE netdata ###"
systemctl disable --now netdata 2>&1 | sed 's/^/  /' || true
for u in netdata-updater.timer netdata-updater.service; do
  systemctl disable --now "$u" >/dev/null 2>&1 && echo "  disabled $u" || true
done
sleep 4
echo "  netdata active=$(systemctl is-active netdata 2>/dev/null) enabled=$(systemctl is-enabled netdata 2>/dev/null)"
echo "  residual netdata/plugin procs: $(pgrep -fc 'netdata|ebpf.plugin|apps.plugin|go.d.plugin' 2>/dev/null || echo 0)"
echo "  idle now: $(vmstat 1 2 2>/dev/null | tail -1 | awk '{print $15"%"}')"

echo "### 2) amavis \$max_servers -> 2 ###"
CONFDIR=/etc/amavis/conf.d
if [ -d "$CONFDIR" ]; then
  DROP="$CONFDIR/99-single-core-tune"
  printf '# single-core tuning: cap amavis preforked workers (revert: rm this file, restart amavis)\n$max_servers = 2;\n1;\n' > "$DROP"
  echo "  wrote $DROP; restarting amavis..."
  systemctl restart amavis
  ok=0; for i in 1 2 3 4; do sleep 3; [ "$(systemctl is-active amavis 2>/dev/null)" = active ] && { ok=1; break; }; done
  if [ "$ok" != 1 ]; then
    echo "  !! amavis not active after ~12s -- ROLLING BACK drop-in"; rm -f "$DROP"
    systemctl restart amavis; sleep 3; echo "  amavis after rollback: $(systemctl is-active amavis 2>/dev/null)"
  else
    echo "  amavis active; amavisd procs: $(ps -ef | grep -c '[a]mavisd')"
  fi
else
  echo "  /etc/amavis/conf.d missing -- skipped"
fi

echo "### 3) mask clamav-clamonacc ###"
systemctl mask --now clamav-clamonacc.service 2>&1 | sed 's/^/  /' || true
echo "  clamonacc active=$(systemctl is-active clamav-clamonacc 2>/dev/null)"

echo "### 4) freshclam Checks -> 2/day (config only) ###"
fc=/etc/clamav/freshclam.conf
if [ -f "$fc" ]; then
  cp -a "$fc" "$BK/freshclam.conf.bak"
  if grep -qiE '^[[:space:]]*Checks[[:space:]]+' "$fc"; then
    sed -i -E 's/^([[:space:]]*[Cc]hecks[[:space:]]+)[0-9]+/\12/' "$fc"
  else echo "Checks 2" >> "$fc"; fi
  echo "  $(grep -iE '^[[:space:]]*Checks' "$fc" | head -1)"
fi

echo "### POST-STATE ###"
for s in postfix dovecot postgresql amavis clamav-daemon iredapd nginx fail2ban; do
  printf "  %-16s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
done
echo "  load: $(cut -d' ' -f1-3 /proc/loadavg)   idle: $(vmstat 1 2 2>/dev/null | tail -1 | awk '{print $15"%"}')"
echo "  amavisd procs: $(ps -ef | grep -c '[a]mavisd')   queue: $(postqueue -p 2>/dev/null | tail -1)"
echo "### REVERT: systemctl enable --now netdata ; rm $CONFDIR/99-single-core-tune && systemctl restart amavis ;"
echo "###         systemctl unmask clamav-clamonacc ; cp $BK/freshclam.conf.bak /etc/clamav/freshclam.conf ###"
R
