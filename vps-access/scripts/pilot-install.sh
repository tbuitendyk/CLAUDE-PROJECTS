#!/usr/bin/env bash
# pilot-install.sh -- install (or refresh) the PERSISTENT, REBOOT-CLEAN pilot
# infrastructure. Idempotent: safe to re-run after every deploy; it rewrites the
# units and installed scripts from this branch, so the schedule is version-
# controlled rather than living in someone's memory.
#
# Owner requirements (2026-08-11):
#   * continuous + current data for LTCUSDT/XRPUSDT/BCHUSDT
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
#     pilot-tick.timer      hourly at :05 UTC -> refresh F1 data (via tunnel),
#                           compute the signal, push the intent to the box
#     pilot-sync.timer      every 5 min -> carry the owner's START/STOP to the
#                           box and pull the journal back for the live screen
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

install -m 755 /dev/stdin /usr/local/sbin/pilot-tick.sh <<TICK
#!/usr/bin/env bash
# hourly: keep F1 data current, compute the signal, push the intent to the box.
set -uo pipefail
export PILOT_SOCKS=$SOCKS
# wait for the tunnel to answer (systemd starts it, but order isn't guaranteed)
for i in \$(seq 1 20); do
  timeout 8 curl -s -m 6 --socks5-hostname $SOCKS https://api.binance.com/api/v3/ping >/dev/null 2>&1 && break
  sleep 3
done
cd $APP && PILOT_SOCKS=$SOCKS node pilot-refresh.js
# mirror check FIRST (re-review tick-order): recompute recent live decisions
# against the fresh data and halt the box on any divergence, BEFORE producing a
# new intent. A tick that reveals the instrument has drifted then ships NOTHING —
# pilot-produce-and-push reads the break in mirror.json and forces a DISARM
# instead of shipping a fresh intent. Running produce first could ship an intent
# on data the very next step proves unreliable.
/usr/local/sbin/pilot-mirror.sh || true
/usr/local/sbin/pilot-produce-and-push.sh
TICK

# entry-aligned tick (owner 2026-08-12: prime at 01:00, don't fire 5 min late).
# Fires right after F1's frozen 01:00 UTC entry so the intent carries the LIVE
# 01:00 open and the box fills ~01:01 instead of ~01:10. It runs the SAME
# produce-and-push as the :05 tick (master-switch reconcile + mirror-break dead-man
# + stop carry + produce + push) but SKIPS the data refresh and mirror recompute:
# the feature window closed at 00:00 and the :05 tick already refreshed that data
# and ran the mirror on it, and the entry OPEN is fetched LIVE by pilot-produce.js
# (not from cache). The next :05 tick re-runs refresh+mirror as the backstop.
# Worst case this step no-ops (e.g. tunnel down, or a prior :05 refresh failed so
# the feature window is incomplete -> produce ships nothing) and the ordinary :05
# tick ships the intent ~4 min later. Stale cache can only WITHHOLD an intent, never
# fabricate one (an incomplete window is simply not actionable), so the fallback is
# always a later fill, never a wrong trade — and the executor's 30-min staleness
# window covers the gap.
install -m 755 /dev/stdin /usr/local/sbin/pilot-tick-entry.sh <<TICKENTRY
#!/usr/bin/env bash
set -uo pipefail
export PILOT_SOCKS=$SOCKS
# wait briefly for the persistent tunnel (Restart=always keeps it up; breaks on
# first success, ~instant when healthy) so the live-open fetch can reach Binance.
for i in \$(seq 1 20); do
  timeout 8 curl -s -m 6 --socks5-hostname $SOCKS https://api.binance.com/api/v3/ping >/dev/null 2>&1 && break
  sleep 3
done
cd $APP && /usr/local/sbin/pilot-produce-and-push.sh
TICKENTRY

# the intent producer + pusher (installed copy of the branch script)
install -m 755 "$REPO/scripts/pilot-produce-and-push.sh" /usr/local/sbin/pilot-produce-and-push.sh
# its sibling helpers — pilot-produce-and-push.sh resolves these via its own dir
# ($HERE), which is /usr/local/sbin once installed, so they MUST be installed
# alongside it. Without pilot-arm-fields.sh the arm reconcile fail-closes to a
# permanent DISARM (box never arms); without pilot-stop-state.sh the stop carry
# breaks. (2026-08-11 re-review: these new helpers were added without this install.)
install -m 755 "$REPO/scripts/pilot-arm-fields.sh" /usr/local/sbin/pilot-arm-fields.sh
install -m 755 "$REPO/scripts/pilot-stop-state.sh" /usr/local/sbin/pilot-stop-state.sh
# the journal-sync + arm-reconcile (installed copy)
install -m 755 "$REPO/scripts/pilot-sync-journal.sh" /usr/local/sbin/pilot-sync-journal.sh
# push alerting — email the owner on halt/dead-heartbeat/stale-sync/new-incident
# (review finding 27: observability was pull-only; the owner sleeps while it runs)
install -m 755 "$REPO/scripts/pilot-alert.sh" /usr/local/sbin/pilot-alert.sh
# mirror check — recompute recent live decisions vs fresh data, halt on drift
install -m 755 "$REPO/scripts/pilot-mirror.sh" /usr/local/sbin/pilot-mirror.sh

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

echo "== systemd units: tick (hourly) and sync (5 min), wall-clock =="
cat > /etc/systemd/system/pilot-tick.service <<UNIT
[Unit]
Description=Pilot tick — refresh F1 data, compute signal, push intent
After=pilot-tunnel.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pilot-tick.sh
UNIT
cat > /etc/systemd/system/pilot-tick.timer <<UNIT
[Unit]
Description=Pilot tick hourly at :05 UTC
[Timer]
OnCalendar=*-*-* *:05:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

# entry-aligned produce (owner 2026-08-12): ship the intent right after F1's frozen
# 01:00 UTC entry so the box can fill ~01:01 with the live 01:00 open, instead of
# waiting for the :05 tick (~01:06 produce, ~01:10 fill). Hardcoded to the frozen
# entry hour; the ordinary :05 tick stays as the backstop.
cat > /etc/systemd/system/pilot-tick-entry.service <<UNIT
[Unit]
Description=Pilot entry tick — produce+push the 01:00 intent with the live open
After=pilot-tunnel.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/pilot-tick-entry.sh
UNIT
cat > /etc/systemd/system/pilot-tick-entry.timer <<UNIT
[Unit]
Description=Pilot entry tick at 01:00:15 UTC (F1 frozen entry hour)
[Timer]
OnCalendar=*-*-* 01:00:15 UTC
# Persistent=false ON PURPOSE: this timer only tightens fill latency AT the 01:00
# boundary. A retro-fire after downtime (e.g. boot at 03:00) would produce ~2h past
# the trained open with no benefit; the Persistent :05 tick is the recovery path.
Persistent=false
[Install]
WantedBy=timers.target
UNIT

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

# ---- GENERALIZED RAIL (IMPLEMENTATION-PLAN 10.3+): its own timers, fully ----
# separate from the F1 pilot's. live-tick at :08 (after the :05 F1 tick has
# refreshed the shared candle cache) runs the multi-setup produce+push and the
# per-setup mirror; live-alert pages per-setup incidents every 15 min offset
# from pilot-alert. While no setup is in paper/live state these are no-ops
# that ship nothing (drafts never produce; empty allowlist keeps the box
# fail-closed for schema-2).
install -m 755 /dev/stdin /usr/local/sbin/live-tick.sh <<LIVETICK
#!/usr/bin/env bash
set -uo pipefail
export PILOT_SOCKS=$SOCKS
/usr/local/sbin/live-produce-and-push.sh || true
cd $APP && node live-mirror.js || true
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
Description=Generalized-rail tick hourly at :08 UTC (after the F1 tick's refresh)
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
systemctl enable --now pilot-tick.timer
systemctl enable --now pilot-tick-entry.timer
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
# Persistent=false ON PURPOSE (matches pilot-tick-entry.timer): fills only AT the
# 01:01 boundary, never a retro-fire after downtime — the Persistent :00/10 exec
# timer is the recovery path. The executor's chunk_start dedup makes this extra
# entry fire idempotent against the regular timer regardless.
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
systemctl list-timers --all 2>/dev/null | grep -i pilot | sed 's/^/  /' || true
echo "install complete."
