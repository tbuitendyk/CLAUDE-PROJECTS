#!/usr/bin/env bash
# classifier-journal-window.sh -- READ-ONLY: print the pilot journal's events for
# a given UTC date prefix (arg, e.g. 2026-08-11 or 2026-08-11T13), minus the
# routine per-tick noise, plus the decision/stand-down record filenames. Used to
# reconstruct what the live rail did on a specific day. No writes.
set -uo pipefail
APPDIR=/opt/general-classifier
PREFIX="${1:-}"
J="$APPDIR/data/pilot/journal.jsonl"
[ -n "$PREFIX" ] || { echo "usage: classifier-journal-window.sh <utc-prefix>"; exit 1; }

echo "== decision records =="
# One append-only JSONL per profile. Only actionable non-FLAT calls are written,
# so an absent day means EITHER the committee declined OR the tick did not run —
# the two are not distinguishable from this store (open gap, 2026-08-19).
ls -1 "$APPDIR/data/live/decisions" 2>/dev/null | sed 's/^/  decisions  /'

echo
echo "== journal events for $PREFIX (routine ticks dropped) =="
python3 - "$J" "$PREFIX" <<'PY'
import sys, json
path, pref = sys.argv[1], sys.argv[2]
NOISE = {'CLOCK_SYNC','RECONCILE_OK','PNL_MTM','RUN_STATUS','BALANCE','DUST_SUBMIN','HEARTBEAT','ARM_OK','TICK'}
n = 0
try:
    with open(path, 'r', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if not str(e.get('utc','')).startswith(pref):
                continue
            ev = e.get('event')
            if ev in NOISE:
                continue
            n += 1
            rest = {k: v for k, v in e.items() if k not in ('event','ts','utc')}
            print('  %s  %-22s %s' % (e.get('utc'), ev, json.dumps(rest)[:260]))
except FileNotFoundError:
    print('  no journal')
print('  (%d non-routine events)' % n)
PY

echo
echo "== routine-tick coverage for $PREFIX (count per event kind) =="
python3 - "$J" "$PREFIX" <<'PY'
import sys, json, collections
path, pref = sys.argv[1], sys.argv[2]
c = collections.Counter()
first = last = None
try:
    with open(path, 'r', errors='replace') as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except Exception:
                continue
            u = str(e.get('utc',''))
            if not u.startswith(pref):
                continue
            c[e.get('event')] += 1
            first = first or u
            last = u
except FileNotFoundError:
    pass
print('  first:', first, '| last:', last)
for k, v in sorted(c.items(), key=lambda kv: -kv[1]):
    print('   %-22s %d' % (k, v))
PY
echo "(read-only)"
