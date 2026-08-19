#!/usr/bin/env bash
# pilot-install.sh -- install (or refresh) the PERSISTENT, REBOOT-CLEAN pilot
# infrastructure. Idempotent: safe to re-run after every deploy; it rewrites the
# units and installed scripts from this branch, so the schedule is version-
# controlled rather than living in someone's memory.
#
# Owner requirements (2026-08-11):
#   * continuous + current data for whatever pairs the live profiles trade
#     (pilot-refresh.js derives that list from the registry; it is NOT a
#     hardcoded set of symbols any more)
#   * timing on ACTUAL wall-clock (systemd OnCalendar), not elapsed-time timers
#   * a host bounce must come up clean and keep running with NO manual
#     STOP/START — so every unit is `enable`d with Persistent=true, the tunnel
#     auto-reconnects, and the master switch (ARM) lives in a file that survives
#     reboots on both machines.
#
# WHAT RUNS WHERE
#   VPS host (systemd, root):
#     pilot-tunnel.service  persistent SOCKS5 tunnel to the Mexico box
#                           (Restart=always) so the VPS can fetch live klines
#     live-tick.timer       hourly at :08 UTC -> refresh the data each live
#                           profile needs (via tunnel), recompute its recent
#                           decisions, produce and push its intents
#     live-alert.timer      every 15 min -> per-profile incident pages
#     pilot-sync.timer      every 5 min -> carry the owner's START/STOP, the
#                           protective stop and the margin floor to the box, and
#                           pull the journal back for the screen. BOX-LEVEL only:
#                           it carries machine state, never a profile's rule.
#   Mexico box (cron, admin):
#     */10 * * * *          mx_executor.py run -> reconcile, close due trades,
#                           open new ones when ARMED. LIVE=1 set here; ARM is
#                           the owner's switch and gates all entries.
set -euo pipefail

BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY=/root/.ssh/aws-mex-deb13-new.pem
APP=/opt/general-classifier
SOCKS=127.0.0.1:1080
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new"

[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
[ -d "$APP" ] || { echo "classifier not deployed at $APP"; exit 1; }

echo "== installing orchestrator scripts to /usr/local/sbin =="

# the intent producer + pusher (installed copy of the branch script)
install -m 755 "$REPO/scripts/pilot-produce-and-push.sh" /usr/local/sbin/pilot-produce-and-push.sh
# its sibling helpers — pilot-produce-and-push.sh resolves these via its own dir
# ($HERE), which is /usr/local/sbin once installed, so they MUST be installed
# alongside it. Without pilot-arm-fields.sh the arm reconcile fail-closes to a
# permanent DISARM (box never arms); without pilot-stop-state.sh the stop carry
# breaks. (2026-08-11 re-review: these new helpers were added without this install.)
install -m 755 "$REPO/scripts/pilot-arm-fields.sh" /usr/local/sbin/pilot-arm-fields.sh
install -m 755 "$REPO/scripts/pilot-stop-state.sh" /usr/local/sbin/pilot-stop-state.sh
# ...and the unhalt helper. Without it the Trading tab's "Clear the halt" button
# writes a request nothing ever carries, so a halt stays a dead end from the
# screen. (2026-08-18: added in the same shape as the two above — which were
# themselves added WITHOUT their install line, per the note above. Repeating a
# documented mistake one line below its own warning is why the carry block now
# prints a loud diagnostic when this file is absent, instead of failing silent.)
install -m 755 "$REPO/scripts/pilot-unhalt-fields.sh" /usr/local/sbin/pilot-unhalt-fields.sh
# the journal-sync + arm-reconcile (installed copy)
install -m 755 "$REPO/scripts/pilot-sync-journal.sh" /usr/local/sbin/pilot-sync-journal.sh
# push alerting — email the owner on halt/dead-heartbeat/stale-sync/new-incident
# (review finding 27: observability was pull-only; the owner sleeps while it runs)
install -m 755 "$REPO/scripts/pilot-alert.sh" /usr/local/sbin/pilot-alert.sh

install -m 755 /dev/stdin /usr/local/sbin/pilot-sync.sh <<SYNC
#!/usr/bin/env bash
# every 5 min: carry the owner's START/STOP to the box, pull the journal back.
set -uo pipefail
/usr/local/sbin/pilot-produce-and-push.sh --arm-only 2>/dev/null || true
/usr/local/sbin/pilot-sync-journal.sh
SYNC

echo "== systemd unit: persistent SOCKS tunnel =="
cat > /etc/systemd/system/pilot-tunnel.service <<UNIT
[Unit]
Description=Pilot SOCKS tunnel to the Mexico trading box (live Binance data)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/bin/ssh -i $KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -N -D $SOCKS $BOX_USER@$BOX_HOST
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT

echo "== systemd unit: sync (5 min), wall-clock =="
cat > /etc/systemd/system/pilot-sync.service <<UNIT
[Unit]
Description=Pilot sync — carry START/STOP to the box, pull the journal
After=pilot-tunnel.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pilot-sync.sh
UNIT
cat > /etc/systemd/system/pilot-sync.timer <<UNIT
[Unit]
Description=Pilot sync every 5 minutes
[Timer]
OnCalendar=*-*-* *:00/5:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/pilot-alert.service <<UNIT
[Unit]
Description=Pilot alert — email owner on halt/dead-heartbeat/stale-sync/incident
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pilot-alert.sh
UNIT
cat > /etc/systemd/system/pilot-alert.timer <<UNIT
[Unit]
Description=Pilot alert every 15 minutes
[Timer]
OnCalendar=*-*-* *:00/15:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

echo "== time sync: keep the VPS OS clock NTP-disciplined (finding 3) =="
# The VPS stamps intent timestamps; if its OS clock drifts from the box's, every
# intent reads as stale and entries silently stop. Prefer whatever NTP daemon is
# present; install chrony only if NEITHER chrony nor systemd-timesyncd is active.
if ! systemctl is-active --quiet chrony 2>/dev/null \
   && ! systemctl is-active --quiet chronyd 2>/dev/null \
   && ! systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then
  (apt-get update -qq && apt-get install -y -qq chrony) 2>&1 | tail -1 || echo "  (chrony install failed — check NTP manually)"
  systemctl enable --now chrony 2>/dev/null || systemctl enable --now chronyd 2>/dev/null || true
fi
if [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ]; then
  echo "  VPS NTP: synced"
else
  echo "  VPS NTP: NOT synced yet — 'chronyc tracking' / 'timedatectl' to inspect"
fi

# ---- THE TRADING RAIL: every profile runs on these two timers --------------
# live-tick at :08 refreshes the candles the profiles need, recomputes their
# recent decisions, and produces + pushes their intents; live-alert pages
# per-profile incidents every 15 min, offset from the box-level alerter. While
# no profile is in paper or live state both are no-ops that ship nothing —
# drafts never produce, and an empty allowlist keeps the box fail-closed.
install -m 755 /dev/stdin /usr/local/sbin/live-tick.sh <<LIVETICK
#!/usr/bin/env bash
set -uo pipefail
export PILOT_SOCKS=$SOCKS
# REFRESH ITS OWN DATA. This tick used to be scheduled after another tick's
# refresh and relied on it — so retiring that tick would have left every profile
# computing its committee from a cache nothing was topping up. A stale cache does
# not fail loudly; it produces a confident call from old candles. The refresh now
# belongs to whoever needs it, and it follows the profiles that are actually
# trading rather than a hardcoded set of symbols.
cd $APP && node pilot-refresh.js || true
# mirror BEFORE produce, same order and same reason as the other rail: a tick
# that reveals the instrument has drifted must ship nothing, not ship first and
# discover second.
cd $APP && node live-mirror.js || true
/usr/local/sbin/live-produce-and-push.sh || true
LIVETICK
install -m 755 "$REPO/scripts/live-produce-and-push.sh" /usr/local/sbin/live-produce-and-push.sh
install -m 755 "$REPO/scripts/live-alert.sh" /usr/local/sbin/live-alert.sh

cat > /etc/systemd/system/live-tick.service <<UNIT
[Unit]
Description=Generalized-rail tick — multi-setup produce+push, per-setup mirror
After=pilot-tunnel.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/live-tick.sh
UNIT
cat > /etc/systemd/system/live-tick.timer <<UNIT
[Unit]
Description=Generalized-rail tick hourly at :08 UTC (refreshes its own data)
[Timer]
OnCalendar=*-*-* *:08:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/live-alert.service <<UNIT
[Unit]
Description=Generalized-rail alerting — per-setup incident pages
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/live-alert.sh
UNIT
cat > /etc/systemd/system/live-alert.timer <<UNIT
[Unit]
Description=Generalized-rail alert every 15 minutes (offset from pilot-alert)
[Timer]
OnCalendar=*-*-* *:07/15:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

echo "== enable + start (enable = survives reboot) =="
systemctl daemon-reload
systemctl enable --now pilot-tunnel.service
# THE HARDCODED CONFIG'S PRODUCERS ARE GONE (2026-08-19). The book moved to the
# owner's profile, which produces on live-tick.timer. These two used to be
# enabled unconditionally here, so running this installer resurrected the retired
# producer and put TWO producers on the same book — the box would have opened two
# positions where the owner asked for one. A timer you disabled that an installer
# re-enables is not disabled, it is on a delay; so this installer no longer
# defines them at all, and REMOVES them from any host that still carries them.
# Left as an explicit purge rather than a silent omission: a unit file already on
# disk keeps firing whether or not the installer still knows about it.
for u in pilot-tick.timer pilot-tick.service pilot-tick-entry.timer pilot-tick-entry.service; do
  if [ -f "/etc/systemd/system/$u" ] || systemctl list-unit-files "$u" >/dev/null 2>&1; then
    systemctl disable --now "$u" 2>/dev/null || true
    rm -f "/etc/systemd/system/$u"
  fi
done
rm -f /usr/local/sbin/pilot-tick.sh /usr/local/sbin/pilot-tick-entry.sh /usr/local/sbin/pilot-mirror.sh
systemctl daemon-reload
# pilot-sync stays: it carries START/STOP, the protective stop and the margin
# floor to the box and refreshes the ARM keepalive. Box-level, not the config's.
systemctl enable --now pilot-sync.timer
systemctl enable --now pilot-alert.timer
systemctl enable --now live-tick.timer
systemctl enable --now live-alert.timer

echo "== configure the Mexico box: LIVE=1 (ARM still gates all entries) + systemd timer =="
# The box has no cron but has systemd + passwordless sudo, so a SYSTEM timer is
# the cleanest reboot-safe, wall-clock scheduler (auto-starts on boot, no login
# needed). It runs the executor as admin so it reads ~/.executor-env and writes
# ~/pilot.
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
mkdir -p ~/pilot
if grep -qE '^LIVE=' ~/.executor-env 2>/dev/null; then
  sed -i 's/^LIVE=.*/LIVE=1/' ~/.executor-env
else
  echo 'LIVE=1' >> ~/.executor-env
fi
echo "  LIVE now: $(grep -E '^LIVE=' ~/.executor-env)"
sudo tee /etc/systemd/system/pilot-exec.service >/dev/null <<UNIT
[Unit]
Description=Pilot executor run (reconcile, close due trades, open when armed)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=admin
ExecStart=/usr/bin/python3 /home/admin/mx_executor.py run
UNIT
sudo tee /etc/systemd/system/pilot-exec.timer >/dev/null <<UNIT
[Unit]
Description=Pilot executor every 10 minutes (wall-clock UTC)
[Timer]
OnCalendar=*-*-* *:00/10:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
sudo tee /etc/systemd/system/pilot-exec-entry.service >/dev/null <<UNIT
[Unit]
Description=Pilot executor entry run — fill the 01:00 entry right after the intent lands
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=admin
ExecStart=/usr/bin/python3 /home/admin/mx_executor.py run
UNIT
sudo tee /etc/systemd/system/pilot-exec-entry.timer >/dev/null <<UNIT
[Unit]
Description=Pilot executor entry at 01:01:00 UTC (right after the 01:00 intent lands)
[Timer]
OnCalendar=*-*-* 01:01:00 UTC
# Persistent=false ON PURPOSE: fills only AT the 01:01 boundary, never a
# retro-fire after downtime — the Persistent :00/10 exec timer is the recovery
# path. A retro-fire hours past the trained open would fill at a price the rule
# never saw, and because the retro intent is stamped at boot it reads FRESH, so
# the staleness gate would not stop it. The executor's chunk_start dedup makes
# this extra fire idempotent against the regular timer regardless.
#
# The 01:01 hour is a LATENCY hint, not a rule: it exists only so a fill lands
# a minute after the intent rather than up to ten. Nothing here decides WHEN a
# profile enters — that comes from the profile's own entry offset. A profile
# whose entry falls elsewhere still fills on the :00/10 timer, just later.
Persistent=false
[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now pilot-exec.timer
sudo systemctl enable --now pilot-exec-entry.timer
echo "  box timer: $(systemctl is-enabled pilot-exec.timer 2>/dev/null) / $(systemctl is-active pilot-exec.timer 2>/dev/null)"
echo "  box entry timer: $(systemctl is-enabled pilot-exec-entry.timer 2>/dev/null) / $(systemctl is-active pilot-exec-entry.timer 2>/dev/null)"
# time sync on the box (finding 3): the box checks intent age, so its OS clock
# must stay disciplined. Prefer whatever NTP daemon is present; the executor also
# re-bases the age check on exchange time and emits CLOCK_DRIFT if the OS clock is
# far off, so this is defence in depth.
if ! systemctl is-active --quiet chrony 2>/dev/null \
   && ! systemctl is-active --quiet chronyd 2>/dev/null \
   && ! systemctl is-active --quiet systemd-timesyncd 2>/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq chrony 2>&1 | tail -1 || true
  sudo systemctl enable --now chrony 2>/dev/null || sudo systemctl enable --now chronyd 2>/dev/null || true
fi
echo "  box NTP synced: $(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"
systemctl list-timers 'pilot-exec*.timer' --all 2>/dev/null | grep pilot-exec | sed 's/^/    /' || true
echo "  master switch (ARM) present? $([ -f ~/pilot/ARM ] && echo YES || echo 'NO — engine STOPPED until owner presses START')"
BOX

echo
echo "== status =="
systemctl --no-pager status pilot-tunnel.service | sed -n '1,4p'
systemctl list-timers --all 2>/dev/null | grep -Ei 'pilot|live-' | sed 's/^/  /' || true
echo "install complete."
