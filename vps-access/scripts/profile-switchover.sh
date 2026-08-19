#!/usr/bin/env bash
# profile-switchover.sh -- ONE-OFF, DELETE AFTER USE (owner, 2026-08-19).
#
# Hand the book from the hardcoded config to the owner's profile. The data moved
# already (profile-migrate.sh); this moves the PRODUCTION of new decisions.
#
# ORDER IS THE SAFETY. Two producers must never be live at once: they would both
# ship an intent for the same period and the box would open TWO positions where
# the owner asked for one. So the old producer is stopped FIRST and the profile
# started SECOND. The failure mode of that order is a MISSED entry; the failure
# mode of the other order is DOUBLE EXPOSURE with real money. There is no time
# pressure — the next entry window is 01:00 UTC — so the safe order costs
# nothing.
#
# What is deliberately NOT stopped: pilot-sync.timer. It carries the owner's
# START/STOP, the protective stop and the margin floor to the box, and refreshes
# the ARM keepalive that the dead-man watches. Those are box-level and outlive
# the config being retired. Killing it would disarm the box within minutes.
#
# Exits are untouched throughout. This opens nothing and closes nothing.
set -uo pipefail
APPDIR=/opt/general-classifier
SETUP_ID="${SETUP_ID:-setup-mszpzts4-3577f3}"

echo "=============================================================="
echo " STEP 1 -- stop the old producer (entry-aligned tick first)"
echo "=============================================================="
for t in pilot-tick-entry.timer pilot-tick.timer; do
  if systemctl is-enabled "$t" >/dev/null 2>&1; then
    systemctl disable --now "$t" >/dev/null 2>&1 \
      && echo "  $t stopped and disabled" \
      || echo "  WARNING: could not stop $t"
  else
    echo "  $t already stopped"
  fi
done
echo "  kept running (box-level, not the config's):"
printf '    %-22s %s\n' pilot-sync.timer "$(systemctl is-active pilot-sync.timer 2>/dev/null)"
printf '    %-22s %s\n' live-tick.timer "$(systemctl is-active live-tick.timer 2>/dev/null)"

# Refuse to continue if the old producer is somehow still armed to run.
still=$(systemctl is-active pilot-tick.timer 2>/dev/null)
if [ "$still" = "active" ]; then
  echo "  REFUSING to start the profile: the old producer is still active."
  echo "  Two live producers would double the next entry. Nothing changed."
  exit 1
fi

echo "=============================================================="
echo " STEP 2 -- start the profile"
echo "=============================================================="
cd "$APPDIR" || exit 1
SETUP_ID="$SETUP_ID" node <<'JSEOF'
const reg = require('/opt/general-classifier/lib/live/setups');
const id = process.env.SETUP_ID;
const s = reg.getSetup(id);
if (!s) { console.error(`  no setup ${id}`); process.exit(1); }
if (s.state === 'live') { console.log(`  ${id} is already live`); process.exit(0); }
try {
  const out = reg.transition(id, 'live', 'owner', 'took over the running book from the hardcoded config');
  console.log(`  ${id}: ${s.state} -> ${out.state}`);
} catch (e) {
  console.error(`  REFUSED: ${e.message}`);
  process.exit(1);
}
JSEOF
[ $? -eq 0 ] || { echo "  the profile did NOT start. The old producer is stopped, so nothing is trading — fix and re-run."; exit 1; }

echo "=============================================================="
echo " STEP 3 -- prove the profile reaches the box's allowlist"
echo "=============================================================="
# The allowlist is derived from the registry every run. If the profile is not in
# it with its key reference, the box will book paper and the owner would find
# out at 01:00 by nothing happening.
cd "$APPDIR" && node live-produce.js >/dev/null 2>&1
python3 - "$APPDIR/data/live/setups-allow.json" "$SETUP_ID" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"  REFUSING: no allowlist produced ({e})"); sys.exit(1)
e = d.get(sys.argv[2])
if not e:
    print(f"  REFUSING: {sys.argv[2]} is not in the allowlist"); sys.exit(1)
print(f"  allowlist entry: symbol={e.get('symbol')} state={e.get('state')} "
      f"clip=${e.get('max_clip_usd')} key_ref={e.get('key_ref')}")
if e.get("state") != "live":
    print("  REFUSING: the profile is in the allowlist but not as live"); sys.exit(1)
if not e.get("key_ref"):
    print("  REFUSING: no key_ref — the box would book paper, not real"); sys.exit(1)
print("  the profile can place real orders from its own sub-account")
PY
rc=$?
echo ""
if [ $rc -eq 0 ]; then
  echo "done. The profile owns the book. Next entry window: 01:00 UTC."
  echo "Exits were never touched; both open shorts keep their schedule."
else
  echo "STEP 3 FAILED — the profile is live in the registry but cannot trade for real."
  exit 1
fi
