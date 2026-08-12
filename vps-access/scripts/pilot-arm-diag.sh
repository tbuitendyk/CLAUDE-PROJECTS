#!/usr/bin/env bash
# pilot-arm-diag.sh -- READ-ONLY diagnosis of why a START press is not arming the
# box. Prints (never mutating anything): the VPS arm-request the UI last wrote,
# whether the classifier UI and the box each hold the shared arm secret (presence
# only, never the value), and the box's recent ARM / RUN_STATUS / INTENT journal
# so a rejection (bad HMAC, replay, stale, no-secret) is visible on sight.
set -uo pipefail
BOX_HOST=ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
BOX_USER=admin
KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13-new.pem}"
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
APP=/opt/general-classifier
ENVF=/etc/general-classifier/env

echo "== VPS: classifier service =="
echo "  general-classifier.service: $(systemctl is-active general-classifier.service 2>/dev/null)"
echo "  UI holds PILOT_ARM_SECRET (env file): $(grep -q '^PILOT_ARM_SECRET=' "$ENVF" 2>/dev/null && echo YES || echo NO)"
# does the RUNNING process actually have it in its environment? (env file present
# but service not restarted since = process without the secret -> unsigned writes)
PID=$(systemctl show -p MainPID --value general-classifier.service 2>/dev/null)
if [ -n "$PID" ] && [ "$PID" != 0 ] && [ -r "/proc/$PID/environ" ]; then
  echo "  UI PROCESS env has PILOT_ARM_SECRET: $(tr '\0' '\n' < /proc/$PID/environ | grep -q '^PILOT_ARM_SECRET=' && echo YES || echo NO)"
else
  echo "  UI PROCESS env: (pid $PID not readable)"
fi

echo "== VPS: last arm-request the UI wrote (data/pilot/arm-request.json) =="
REQ="$APP/data/pilot/arm-request.json"
if [ -f "$REQ" ]; then
  python3 - "$REQ" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
d=dict(d)
if d.get("hmac"): d["hmac"]=d["hmac"][:8]+"...(present)"
print("  ", json.dumps(d))
print("   signed:", "YES (hmac present)" if "hmac" in json.load(open(sys.argv[1])) else "NO (unsigned)")
PY
  echo "   mtime: $(date -u -r "$REQ" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
else
  echo "   NO arm-request.json — the UI has never written one (POST not reaching the server)"
fi

echo "== box: arm secret presence + recent ARM/RUN_STATUS/INTENT journal =="
$SSH "$BOX_USER@$BOX_HOST" 'bash -s' <<'BOX'
set -uo pipefail
echo "  box holds PILOT_ARM_SECRET: $(grep -q '^PILOT_ARM_SECRET=' ~/.executor-env 2>/dev/null && echo YES || echo NO)"
echo "  ARM file present: $([ -f ~/pilot/ARM ] && echo YES || echo NO)"
echo "  --- last 12 ARM_* / RUN_STATUS / ENTRIES_SKIPPED events ---"
grep -aE '"event":"(ARM_SET|ARM_CLEAR|ARM_STALE|ARM_HMAC_INVALID|ARM_REPLAY_REJECTED|ARM_NO_SECRET|ARM_STALE_REQUEST|RUN_STATUS|ENTRIES_SKIPPED)"' ~/pilot/journal.jsonl 2>/dev/null | tail -12 | sed 's/^/    /'
BOX
echo "(read-only)"
