#!/usr/bin/env bash
# setup-natnet-watchdog.sh -- install a host-side cron watchdog that detects the
# VBoxNetNAT TCP wedge (public path accepts but forwards nothing; ICMP still ok)
# and auto-restarts the NatNetwork. The watchdog runs under CRON in root's
# normal namespace -- the SAME VirtualBox IPC context as the desktop session --
# NOT under deploy-control (whose PrivateTmp gives it a parallel VBoxSVC; that
# mismatch is what created the phantom-VM incident). Re-run to update. Files:
#   /usr/local/sbin/natnet-watchdog.sh   (the watchdog)
#   /etc/cron.d/natnet-watchdog          (every 15 min, as root)
#   /var/log/natnet-watchdog.log         (actions only; healthy runs are silent)
set -euo pipefail

cat > /usr/local/sbin/natnet-watchdog.sh <<'WD'
#!/usr/bin/env bash
# natnet-watchdog.sh -- detect + auto-fix a wedged VBoxNetNAT (public-IP mail
# path dead while guest is fine). Runs from root cron every 15 min. Restart
# fires ONLY on the exact wedge signature, at most once per hour.
set -u
LOG=/var/log/natnet-watchdog.log
LOCK=/run/natnet-watchdog.lock
STAMP=/run/natnet-last-restart
PUB=74.208.226.14
GUEST=192.168.56.129
VBM=/usr/bin/VBoxManage
exec 9>"$LOCK"; flock -n 9 || exit 0
log(){ echo "$(date '+%F %T') $*" >>"$LOG"; }
# keep the log small
[ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 1000000 ] && { tail -200 "$LOG" >"$LOG.t" && mv "$LOG.t" "$LOG"; }
probe(){ timeout 12 bash -c "exec 3<>/dev/tcp/$1/143 && head -c 16 <&3" 2>/dev/null | grep -q '\* OK'; }

probe "$PUB" && exit 0                    # healthy -- silent
sleep 8
probe "$PUB" && exit 0                    # transient blip -- silent

# public path is down; classify before touching anything
if ! pgrep -f -- '--comment HOMSMAIL03' >/dev/null 2>&1; then
  log "public:143 down but mail VM process not running -- no action (start the VM first)"; exit 0
fi
if ! probe "$GUEST"; then
  log "public:143 AND direct:143 both down -- guest-side problem (booting? dovecot down?), NOT the NAT; no action"; exit 0
fi
# wedge signature confirmed: public dead, direct fine, VM running
if [ -f "$STAMP" ] && [ $(( $(date +%s) - $(stat -c %Y "$STAMP") )) -lt 3600 ]; then
  log "NAT wedge detected but last restart <1h ago -- holding. MANUAL FIX (desktop root terminal): VBoxManage natnetwork stop --netname NatNetwork; VBoxManage natnetwork start --netname NatNetwork"
  exit 0
fi

oldpid=$(pgrep -x VBoxNetNAT | head -1 || true)
log "NAT wedge detected (public:143 dead, direct:143 ok, VM running) -- restarting NatNetwork (old daemon pid=${oldpid:-none})"
"$VBM" natnetwork stop --netname NatNetwork >>"$LOG" 2>&1
sleep 3
if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
  log "old VBoxNetNAT (pid $oldpid) survived stop -- killing it directly (prevents a duplicate daemon)"
  kill "$oldpid" 2>/dev/null; sleep 2
  kill -0 "$oldpid" 2>/dev/null && kill -9 "$oldpid" 2>/dev/null
  sleep 1
fi
"$VBM" natnetwork start --netname NatNetwork >>"$LOG" 2>&1
if ! pgrep -x VBoxNetNAT >/dev/null 2>&1; then
  log "no VBoxNetNAT after start -- one more stop/start cycle"
  "$VBM" natnetwork stop --netname NatNetwork >>"$LOG" 2>&1; sleep 2
  "$VBM" natnetwork start --netname NatNetwork >>"$LOG" 2>&1
fi
touch "$STAMP"; sleep 6
if probe "$PUB"; then
  log "RECOVERED -- public:143 answering again after NatNetwork restart"
else
  log "STILL DOWN after restart. MANUAL FIX (desktop root terminal): VBoxManage natnetwork stop --netname NatNetwork; VBoxManage natnetwork start --netname NatNetwork  (then re-test: mail client or port 143 banner)"
fi
WD
chmod 700 /usr/local/sbin/natnet-watchdog.sh

cat > /etc/cron.d/natnet-watchdog <<'CRON'
# watchdog for the VBoxNetNAT public->mail-VM path (see /usr/local/sbin/natnet-watchdog.sh)
*/15 * * * * root /usr/local/sbin/natnet-watchdog.sh >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/natnet-watchdog
touch /var/log/natnet-watchdog.log

echo "installed:"
ls -l /usr/local/sbin/natnet-watchdog.sh /etc/cron.d/natnet-watchdog
echo "cron service: $(systemctl is-active cron 2>/dev/null)"
echo "== immediate health probe (same test the watchdog uses) =="
if timeout 12 bash -c "exec 3<>/dev/tcp/74.208.226.14/143 && head -c 16 <&3" 2>/dev/null | grep -q '\* OK'; then
  echo "  public:143 -> HEALTHY (watchdog will stay silent)"
else
  echo "  public:143 -> NOT answering (watchdog will act on its next cron tick)"
fi
echo "log: /var/log/natnet-watchdog.log (healthy runs write nothing)"
