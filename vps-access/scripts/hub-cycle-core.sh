#!/usr/bin/env bash
# hub-cycle-core.sh -- THE mail-hub gatekeeper cycle. Installed by hub-setup.sh
# to /usr/local/sbin/claude-mail-hub-cycle.sh and run by root cron EVERY MINUTE;
# an internal gate turns that into: poll every 15 min normally, every 1 min for
# 20 min after any mail interaction (owner's cadence rule).
#
# What one cycle does:
#   1. gate on cadence (below threshold -> exit silently)
#   2. run the verification core (claude-mail-check.sh in BYPASS mode -- the
#      same SASL + queue-id-bound proof the classifier hardened; verified
#      messages are consumed from the mailbox by THIS cycle only)
#   3. route each VERIFIED message to a registered container's hub inbox:
#      first registered name found in the Subject wins; otherwise the default
#      route (hub/default-route). Containers pick up via hub-fetch.sh <name>.
#   4. UNVERIFIED mail is never routed, never consumed -- counted in the log.
#   5. any verified inbound stamps the interaction clock -> fast polling.
set -uo pipefail
HUB=/var/lib/claude-mail/hub
STATE=/var/lib/claude-mail
SCRIPTS=/root/claude-projects/vps-access/scripts
LOG="$HUB/log/hub.log"
[ -f "$HUB/ENABLED" ] || exit 0
mkdir -p "$HUB/log"
exec 9>"$HUB/.cycle.lock"; flock -n 9 || exit 0

now=$(date +%s)
last_int=$(cat "$STATE/last-sent" 2>/dev/null || echo 0)
last_poll=$(cat "$HUB/last-cycle" 2>/dev/null || echo 0)
case "$last_int" in (*[!0-9]*|"") last_int=0;; esac
case "$last_poll" in (*[!0-9]*|"") last_poll=0;; esac
# Stagger contract with the containers (owner directive): normal-mode polls
# happen at FIXED wall-clock times -- :00/:15/:30/:45 -- and hub-fetch.sh
# tells containers to fetch one minute AFTER those marks, so routed mail is
# picked up ~1 min after it lands instead of up to a full period later.
# Fast mode (within 1200s of an interaction) still polls every minute.
if [ $((now - last_int)) -lt 1200 ]; then
  [ $((now - last_poll)) -ge 55 ] || exit 0
else
  min=$((10#$(date +%M)))
  [ $((min % 15)) -eq 0 ] || exit 0
  [ $((now - last_poll)) -ge 120 ] || exit 0
fi
echo "$now" > "$HUB/last-cycle"

log(){ echo "$(date '+%F %T') $*" >> "$LOG"; }
[ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 2000000 ] && { tail -400 "$LOG" > "$LOG.t" && mv "$LOG.t" "$LOG"; }

out=$(CLAUDE_MAIL_HUB_BYPASS=1 bash "$SCRIPTS/claude-mail-check.sh" 2>&1); rc=$?
if [ "$rc" -ne 0 ]; then
  log "CHECK FAILED rc=$rc :: $(echo "$out" | head -3 | tr '\n' '|')"
  exit 0
fi
if echo "$out" | grep -q '^no unread mail'; then
  log "poll: no unread mail (mode=$([ $((now-last_int)) -lt 1200 ] && echo fast || echo normal))"
  exit 0
fi

export HUB now
result=$(printf '%s\n' "$out" | python3 <<'PY'
import os, re, sys, time
HUB = os.environ["HUB"]; now = os.environ["now"]
text = sys.stdin.read()
# split into blocks that start with "--- "
blocks, cur = [], None
for line in text.splitlines():
    if line.startswith("--- "):
        if cur: blocks.append(cur)
        cur = [line]
    elif cur is not None:
        cur.append(line)
if cur: blocks.append(cur)
registry = sorted(os.listdir(f"{HUB}/registry")) if os.path.isdir(f"{HUB}/registry") else []
try:
    default = open(f"{HUB}/default-route").read().strip()
except Exception:
    default = registry[0] if registry else ""
routed, unver = [], 0
for i, b in enumerate(blocks):
    head = b[0]
    if "UNVERIFIED" in head or "VERIFIED" not in head:
        unver += 1
        continue
    subj = ""
    for ln in b:
        m = re.match(r"\s*subject\s*:\s*(.*)", ln)
        if m: subj = m.group(1); break
    target = next((r for r in registry if r.lower() in subj.lower()), "") or default
    if not target:
        unver += 1
        continue
    d = f"{HUB}/inbox/{target}"; os.makedirs(d, exist_ok=True)
    fn = f"{d}/{now}-{i:02d}.txt"
    open(fn, "w").write("\n".join(b).rstrip() + "\n")
    routed.append(f"{target}:{os.path.basename(fn)} [{subj[:60]}]")
print(f"ROUTED={len(routed)} UNVERIFIED={unver}")
for r in routed: print("  -> " + r)
PY
)
echo "$result" | while IFS= read -r ln; do log "$ln"; done
if echo "$result" | grep -q '^ROUTED=[1-9]'; then
  echo "$now" > "$STATE/last-sent"    # inbound interaction -> fast window
fi
exit 0
