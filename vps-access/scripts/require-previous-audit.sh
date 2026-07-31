#!/usr/bin/env bash
# require-previous-audit.sh -- refuse to fire a new job until the last
# completed one has been audited.
#
# Research-loop step 7 (owner, 2026-07-29): the analysis after a run must hunt
# for weaknesses in the MEASUREMENT, and the next planned step is provisional
# until those weaknesses are fixed. That instruction fails silently if it is
# left to willingness -- "analyse hard" is exactly the kind of rule that gets
# nodded at and skipped, which is how the silent-unit defect survived several
# runs after being flagged as "cheap to check".
#
# So it is enforced here instead: no audit file, no new job. Every cycle
# launcher must call this first.
#
# Usage:   . "$(dirname "$0")/require-previous-audit.sh"     # source it
#   or     ./require-previous-audit.sh && ./classifier-cycleN.sh
#
# Override (use sparingly, and it is logged loudly):
#   SKIP_AUDIT_GATE=1  -- for reruns of an identical job, or a job whose
#   predecessor was cancelled rather than completed.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B="http://127.0.0.1:8093"

if [ "${SKIP_AUDIT_GATE:-0}" = "1" ]; then
  echo "!! AUDIT GATE SKIPPED by SKIP_AUDIT_GATE=1 -- this is on the record."
  return 0 2>/dev/null || exit 0
fi

LAST=$(curl -sS --max-time 20 "$B/api/batches" 2>/dev/null | python3 -c "
import sys, json
try: bs = json.load(sys.stdin)['batches']
except Exception: raise SystemExit
for b in bs:
    # Walk-forward jobs are experiments too: this gate covered only
    # bracketlab- ids until the 2026-07-31 review caught the exemption
    # (QC 59) — a whole job kind could have fired unaudited follow-ups.
    if not (b['id'].startswith(('bracketlab-', 'walkforward-')) and b.get('status') == 'done'):
        continue
    # Preflights are not experiments: no reading rule, no findings, nothing to
    # audit. Skipping them here is a carve-out, not a loophole — the gate
    # exists to force analysis of runs that were meant to answer a question.
    if '-smoke' in b['id'] or '-cost-probe' in b['id']:
        continue
    print(b['id']); break
" 2>/dev/null)

if [ -z "$LAST" ]; then
  echo "audit gate: no completed bracketlab/walkforward job found — nothing to audit, proceeding."
  return 0 2>/dev/null || exit 0
fi

AUDIT="$HERE/reports/audit-${LAST}.md"
if [ ! -f "$AUDIT" ]; then
  echo "REFUSED — research-loop step 7."
  echo
  echo "  The last completed run was:  $LAST"
  echo "  It has no audit at:          reports/audit-${LAST}.md"
  echo
  echo "  Firing a new job now means building on an instrument nobody has"
  echo "  re-examined. Every serious defect in this project has been a"
  echo "  measurement defect, and each one shaped a decision before it was"
  echo "  found."
  echo
  echo "  Write the audit from reports/AUDIT-TEMPLATE.md, commit it, then"
  echo "  fire. Question 9 is the one that matters: is the step you were"
  echo "  ABOUT to take still the right one?"
  return 1 2>/dev/null || exit 1
fi

# An audit that is present but empty is worse than none, because it looks done.
WORDS=$(grep -vc '^[[:space:]]*$' "$AUDIT" 2>/dev/null || echo 0)
UNANSWERED=$(grep -c '^## [0-9]' "$AUDIT" 2>/dev/null || echo 0)
if [ "$WORDS" -lt 25 ] || [ "$UNANSWERED" -lt 9 ]; then
  echo "REFUSED — reports/audit-${LAST}.md exists but looks unfilled"
  echo "  ($WORDS non-blank lines, $UNANSWERED numbered sections; expected 10)."
  echo "  A stub audit is worse than none: it reads as done."
  return 1 2>/dev/null || exit 1
fi

echo "audit gate: OK — $LAST audited (reports/audit-${LAST}.md)"
return 0 2>/dev/null || exit 0
