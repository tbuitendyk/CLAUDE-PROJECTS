#!/usr/bin/env bash
# mailvm-apply-amavis-freshclam.sh -- finish the single-core tuning now that
# netdata is disabled and the core has headroom. Applies ONLY the two changes
# that got rolled back under load: amavis $max_servers->2 (drop-in) and
# freshclam Checks->2. Generous 24s amavis restart grace to avoid a false
# rollback. Reversible; backs up freshclam.conf.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129"
$SSH 'bash -s' <<'R' 2>&1
set -uo pipefail
TS=$(date +%Y%m%d-%H%M%S); BK=/root/mail-tune-backup-$TS; mkdir -p "$BK"
echo "pre:  load $(cut -d' ' -f1-3 /proc/loadavg)   idle $(vmstat 1 2 2>/dev/null|tail -1|awk '{print $15}')%   amavisd_procs $(ps -ef|grep -c '[a]mavisd')"
[ "$(systemctl is-active amavis 2>/dev/null)" = active ] || { echo "ABORT: amavis not active"; exit 3; }
qn=$(mailq 2>/dev/null | grep -cE '^[0-9A-F]{8,}' || true); [ "${qn:-0}" -le 500 ] || { echo "ABORT: queue $qn too large"; exit 3; }

echo "### amavis \$max_servers -> 2 ###"
DROP=/etc/amavis/conf.d/99-single-core-tune
printf '# single-core tuning: cap amavis preforked workers (revert: rm this file, restart amavis)\n$max_servers = 2;\n1;\n' > "$DROP"
echo "  wrote $DROP; restarting amavis (up to ~24s grace)..."
systemctl restart amavis
ok=0; for i in $(seq 1 8); do sleep 3; [ "$(systemctl is-active amavis 2>/dev/null)" = active ] && { ok=1; break; }; done
if [ "$ok" != 1 ]; then
  echo "  !! amavis not active after ~24s -- ROLLING BACK"; rm -f "$DROP"; systemctl restart amavis; sleep 3
  echo "  amavis after rollback: $(systemctl is-active amavis 2>/dev/null)  max_servers stays 4"
else
  sleep 2
  echo "  amavis active; effective \$max_servers=$(grep -rhoE '\$max_servers[[:space:]]*=[[:space:]]*[0-9]+' /etc/amavis/conf.d/99-single-core-tune 2>/dev/null|grep -oE '[0-9]+')  amavisd_procs now $(ps -ef|grep -c '[a]mavisd')"
fi

echo "### freshclam Checks -> 2/day (config only) ###"
fc=/etc/clamav/freshclam.conf
if [ -f "$fc" ]; then
  cp -a "$fc" "$BK/freshclam.conf.bak"
  if grep -qiE '^[[:space:]]*Checks[[:space:]]+[0-9]' "$fc"; then
    sed -i -E 's/^([[:space:]]*[Cc]hecks[[:space:]]+)[0-9]+/\12/' "$fc"
  else
    echo "Checks 2" >> "$fc"
  fi
  echo "  now: $(grep -inE '^[[:space:]]*Checks' "$fc" | head -2 | tr '\n' ' ')"
fi

echo "post: load $(cut -d' ' -f1-3 /proc/loadavg)   idle $(vmstat 1 2 2>/dev/null|tail -1|awk '{print $15}')%   amavisd_procs $(ps -ef|grep -c '[a]mavisd')   queue: $(postqueue -p 2>/dev/null|tail -1)"
echo "REVERT: rm $DROP && systemctl restart amavis ; cp $BK/freshclam.conf.bak /etc/clamav/freshclam.conf"
R
