#!/usr/bin/env bash
# READ-ONLY consolidated pilot status: VPS units, box timer, data freshness, switch.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
echo "== VPS units =="
# The generalized rail's units were absent from this list and from the grep
# below, so live-tick/live-alert could be dead for days and this screen would
# look perfectly healthy. A status script that can only see one rail reports the
# other rail's silence as success.
for u in pilot-tunnel.service pilot-tick.timer pilot-tick-entry.timer pilot-sync.timer \
         pilot-alert.timer live-tick.timer live-alert.timer; do
  printf '  %-24s %s / %s\n' "$u" "$(systemctl is-enabled $u 2>/dev/null)" "$(systemctl is-active $u 2>/dev/null)"
done
echo "== next scheduled =="
systemctl list-timers pilot-tick.timer pilot-tick-entry.timer pilot-sync.timer \
  pilot-alert.timer live-tick.timer live-alert.timer --all 2>/dev/null \
  | grep -E 'pilot|live' | sed 's/^/  /'
echo "== F1 data freshness (newest cached day-file) =="
for s in LTCUSDT XRPUSDT BCHUSDT; do
  echo "  $s: $(basename $(ls -1 /opt/general-classifier/data/cache/${s}-1h-2026-08-*.json 2>/dev/null | sort | tail -1) 2>/dev/null || echo none)"
done
echo "== box: timer, LIVE, master switch =="
$SSH "$BOX" 'echo "  pilot-exec.timer: $(systemctl is-enabled pilot-exec.timer 2>/dev/null) / $(systemctl is-active pilot-exec.timer 2>/dev/null)"; echo "  LIVE: $(grep -E ^LIVE= ~/.executor-env)"; echo "  master switch (ARM): $([ -f ~/pilot/ARM ] && echo RUNNING || echo STOPPED)"; echo "  last exec run: $(tail -1 ~/pilot/journal.jsonl 2>/dev/null | cut -c1-90)"'
