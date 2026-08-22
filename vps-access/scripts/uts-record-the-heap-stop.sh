#!/usr/bin/env bash
# uts-record-the-heap-stop.sh -- CHANGES ONE RECORD. Owner sign-off given
# 2026-08-22 ("write the reason onto that run").
#
# WHAT IT WRITES, AND WHY BY HAND. The run below stopped because the service
# ran out of memory: the journal has FATAL ERROR: Reached heap limit at
# 05:54:43 UTC and systemd restarting the unit five seconds later, and the run
# is stamped finished at 05:54:49.034Z having reached slim 316/123624.
#
# A run cannot report its own sudden death — the process was gone. The code now
# writes a reason when it finds a run still marked running at startup, but this
# one was marked interrupted by the version that wrote nothing, so its record
# says only the word "interrupted" and the screen has nothing to show. This
# fills that one gap, from the journal, once.
#
# It is a script and not a control on a screen deliberately: this is repairing
# a record that predates the fix, not something an operator should ever be
# doing to a run. The text says outright that it was reconstructed afterwards,
# so nobody later reads it as something the run itself managed to record.
#
# Touches exactly three fields on exactly one run. Never the description,
# never the results, never anything else. Idempotent: safe to run twice, and
# it refuses a run that is going.
set -uo pipefail
RUN=bracketlab-20260822-054954-null100-census-declared-trail
F="/opt/ultimate-trading-system/data/batches/$RUN.json"

python3 - "$F" <<'PY'
import json, os, sys, tempfile

path = sys.argv[1]
if not os.path.exists(path):
    print('no such run — nothing written:', os.path.basename(path)); raise SystemExit(1)

doc = json.load(open(path))
print('run    :', doc.get('id'))
print('status :', doc.get('status'))
print('before : error=%r  interruptedWhere=%r' % (doc.get('error'), doc.get('interruptedWhere')))

if doc.get('status') == 'running':
    print('REFUSED: this run is going right now. Nothing written.'); raise SystemExit(1)

REASON = (
    'The service ran out of memory and was restarted while this run was going — '
    'it was at slim 316/123624. Recorded afterwards from the system journal '
    '(FATAL ERROR: Reached heap limit — JavaScript heap out of memory, at '
    '1024 MB, 2026-08-22 05:54:43 UTC), NOT by the run itself, which had no '
    'chance to write anything. Two causes, both since fixed: every worker '
    'result was being held for the whole run although nothing read it, and the '
    'whole 2 MB run record was being rewritten after every single unit. The '
    'service also ran with the default heap ceiling of about 1 GB while it was '
    'allowed 3 GB; it now runs with 1792 MB. Nothing this run had already '
    'finished is lost. It did not complete: carry it on with Resume run on the '
    'Boards section, which scores only the units it never got to and keeps '
    'everything already scored, or start a fresh run from the Sweep section.'
)

before = (doc.get('error'), doc.get('interruptedWhere'), doc.get('interruptedAt'))
doc['error'] = REASON
doc['interruptedWhere'] = 'slim 316/123624'
doc['interruptedAt'] = doc.get('interruptedAt') or doc.get('finishedAt')
after = (doc.get('error'), doc.get('interruptedWhere'), doc.get('interruptedAt'))

if before == after:
    print('already says this — nothing to change'); raise SystemExit(0)

# tmp + rename, the same way the service writes this file, so a stop mid-write
# cannot leave truncated JSON where the run's whole record used to be.
d = os.path.dirname(path)
fd, tmp = tempfile.mkstemp(dir=d, prefix=os.path.basename(path) + '.tmp')
with os.fdopen(fd, 'w') as fh:
    json.dump(doc, fh, indent=1)
os.chmod(tmp, 0o644)
os.replace(tmp, path)

check = json.load(open(path))
print('after  : interruptedWhere=%r' % check.get('interruptedWhere'))
print('after  : error=%s' % check.get('error'))
print('description UNTOUCHED:', repr(check.get('description'))[:110], '...')
print('results UNTOUCHED: slimResults=%d leaders=%d' % (len(check.get('slimResults') or []), len(check.get('leaders') or [])))
PY
chown uts:uts "$F" 2>/dev/null || true

# WHO OWNS THE FILE AFTERWARDS. This script runs as root and the service runs
# as uts, so a rename would otherwise leave the run's own record owned by root
# — readable, deletable (the directory is the service's), but no longer
# writable by the thing that owns it. Saving notes onto this run would then
# fail with a permission error that looks like a bug in the notes box.
ls -l "$F" | sed 's/^/  /'
