#!/usr/bin/env bash
# live-alert-dryrun.sh -- READ-ONLY: run the per-setup alerter against the REAL
# journal and reproduce-check verdict, in dry-run, and print exactly what it
# would email. Sends nothing, writes no alert state (a scratch state file is
# used and discarded), places no orders, touches no engine.
#
# Why this exists: the fixture harness proves the RULES, but only against
# fabricated events. It cannot prove the real journal carries the fields those
# rules read. A guard that is correct over fixtures and blind over production
# data is the failure this whole class of bug keeps taking.
set -uo pipefail
APP=/opt/general-classifier
J="${1:-$APP/data/pilot/journal.jsonl}"
M="$APP/data/live/mirror.json"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

echo "== inputs =="
echo "  journal: $J ($( [ -f "$J" ] && wc -l < "$J" || echo 0) lines)"
echo "  verdict: $M"
echo
echo "== do the journal's fill events carry a setup id? =="
# The alarm counts open positions PER SETUP. Fills written before the migration
# may carry no setup_id at all, in which case every setup reads as flat and the
# alarm stays silent exactly when it matters most.
python3 - "$J" <<'PYEOF'
import json, sys
tagged = untagged = 0
per = {}
try:
    for line in open(sys.argv[1]):
        line = line.strip()
        if not line: continue
        try: e = json.loads(line)
        except Exception: continue
        if e.get("event") not in ("ENTRY_FILL", "EXIT_FILL", "PAPER_ENTRY_FILL", "PAPER_EXIT_FILL"):
            continue
        sid = e.get("setup_id")
        if sid:
            tagged += 1
            per.setdefault(sid, []).append(e.get("event"))
        else:
            untagged += 1
except FileNotFoundError:
    print("  (no journal)"); raise SystemExit
print(f"  fill events WITH a setup id: {tagged}")
print(f"  fill events WITHOUT one:     {untagged}")
if untagged:
    print("  ^^ those are invisible to the per-setup alarm — it can only count what is tagged")
for sid, evs in per.items():
    print(f"    {sid}: {evs}")
PYEOF

echo
echo "== what the alerter would send, right now =="
LIVE_ALERT_DRYRUN=1 LIVE_MIRROR_FILE="$M" LIVE_ALERT_STATE="$T/state.json" \
  bash /usr/local/sbin/live-alert.sh "$J" 2>&1 | sed 's/^/  /'
echo "(read-only; nothing sent, no alert state kept)"
