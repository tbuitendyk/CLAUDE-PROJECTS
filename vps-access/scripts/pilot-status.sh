#!/usr/bin/env bash
# READ-ONLY consolidated pilot status: VPS units, box timer, data freshness, switch.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
echo "== VPS units =="
# The trading rail's units were absent from this list and from the grep below,
# so live-tick/live-alert could be dead for days and this screen would look
# perfectly healthy. A status script that can only see one rail reports the other
# rail's silence as success. The retired single-config tick timers are no longer
# listed because they no longer exist — pilot-install.sh removes them.
for u in pilot-tunnel.service pilot-sync.timer \
         pilot-alert.timer live-tick.timer live-alert.timer; do
  printf '  %-24s %s / %s\n' "$u" "$(systemctl is-enabled $u 2>/dev/null)" "$(systemctl is-active $u 2>/dev/null)"
done
echo "== next scheduled =="
systemctl list-timers pilot-sync.timer \
  pilot-alert.timer live-tick.timer live-alert.timer --all 2>/dev/null \
  | grep -E 'pilot|live' | sed 's/^/  /'
echo "== data freshness, newest cached day-file, for the pairs the profiles trade =="
# Named symbols used to be hardcoded here, so a profile on a fourth pair left its
# data unmonitored while this screen still said everything was fresh.
PAIRS=$(cd /opt/general-classifier && node -e '
try {
  const st = require("./lib/live/setups");
  const want = new Set();
  for (const s of st.listSetups()) {
    if (!["paper", "live", "stopped"].includes(s.state)) continue;
    const combo = (s.configSnapshot || {}).combo || {};
    for (const k of ["trade", "ctx1", "ctx2"]) if (combo[k]) want.add(combo[k]);
    if (s.tradedPair) want.add(s.tradedPair);
  }
  console.log([...want].join(" "));
} catch (e) { console.log(""); }
' 2>/dev/null)
if [ -z "${PAIRS// }" ]; then
  echo "  (no profile is in paper/live/stopped — nothing needs refreshing)"
else
  for s in $PAIRS; do
    echo "  $s: $(basename $(ls -1 /opt/general-classifier/data/cache/${s}-1h-*.json 2>/dev/null | sort | tail -1) 2>/dev/null || echo none)"
  done
fi
echo "== box: timer, LIVE, master switch =="
$SSH "$BOX" 'echo "  pilot-exec.timer: $(systemctl is-enabled pilot-exec.timer 2>/dev/null) / $(systemctl is-active pilot-exec.timer 2>/dev/null)"; echo "  LIVE: $(grep -E ^LIVE= ~/.executor-env)"; echo "  master switch (ARM): $([ -f ~/pilot/ARM ] && echo RUNNING || echo STOPPED)"; echo "  last exec run: $(tail -1 ~/pilot/journal.jsonl 2>/dev/null | cut -c1-90)"'
