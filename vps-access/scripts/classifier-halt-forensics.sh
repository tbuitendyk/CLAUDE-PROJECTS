#!/usr/bin/env bash
# classifier-halt-forensics.sh -- READ-ONLY: everything needed to explain the
# current reconcile halt, in one page.
#
# The check compares the exchange's BORROW against the journal's SOLD short
# quantity. Those are the same number only when the borrow financed the whole
# sale. If the account already held some base asset, a MARGIN_BUY sell consumes
# that first and borrows only the remainder — so borrow < sold, by exactly the
# free base that was there beforehand. This prints the free-base readings
# either side of the entry so that explanation can be confirmed or ruled out
# rather than assumed.
set -uo pipefail
J=${JOURNAL:-/home/claude/pilot/journal.jsonl}
[ -f "$J" ] || J=/opt/general-classifier/data/pilot/journal.jsonl
[ -f "$J" ] || { echo "no journal found"; exit 1; }
echo "== journal: $J =="
echo
echo "== the last BALANCE readings (free base + borrow as the exchange reports them) =="
grep '"BALANCE"' "$J" | tail -12 | cut -c1-230
echo
echo "== DUST_SUBMIN: base the box holds but cannot sell (below the \$5 minimum) =="
grep '"DUST_SUBMIN"' "$J" | tail -6 | cut -c1-220
echo
echo "== the entry that opened the current short =="
grep -E '"ENTRY_FILL"|"ORDER_ACK"' "$J" | tail -4 | cut -c1-260
echo
echo "== the newest reconcile reading =="
grep -E '"RECONCILE_MISMATCH"|"RECONCILE_OK"' "$J" | tail -2 | cut -c1-260
echo
echo "== halt state =="
ls -l /home/claude/pilot/halt.flag 2>/dev/null || echo "  (no halt.flag at the default path)"
echo "(read-only — clears nothing)"
