#!/usr/bin/env bash
# uts-rows-squash-prove.sh -- READ-ONLY. Runs uts-rows-squash-test.js against
# the lib/rowstore.js that is actually DEPLOYED on this box, in a scratch
# directory of its own. Touches nothing under data/. Run this before
# uts-rows-squash-start.sh: passing on a laptop proves the converter agrees with
# the code on the laptop, which is not the code that will read the result.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/opt/ultimate-trading-system
WORK=$(mktemp -d /tmp/uts-squash-prove.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
echo "deployed rowstore: $(sha256sum "$ROOT/lib/rowstore.js" | cut -c1-16)  $(stat -c%y "$ROOT/lib/rowstore.js")"
echo "node: $(node -v)"
# Three tears, and what each one should cost. The fixture is deterministic, so
# these are fixed numbers and not a range to be nodded at: if the converter's
# idea of where the damage starts ever moves, one of them fails.
FAILED=0
for PAIR in 400:4 8000:7 60000:22; do
  CHOP=${PAIR%%:*}; WANT=${PAIR##*:}
  echo "== a tear of $CHOP bytes, which should cost $WANT row(s) =="
  if CHOP=$CHOP WANT_REDO=$WANT UTS_ROOT=$ROOT node "$HERE/uts-rows-squash-test.js" "$WORK/w$CHOP" "$HERE/uts-rows-squash.js" > "$WORK/out$CHOP" 2>&1; then
    grep -E "^  ok |ALL CHECKS PASSED|declared configuration label|reading A|reading B|only A|only B|both can|NEITHER" "$WORK/out$CHOP" | sed 's/^ *|* */  /'
  else
    FAILED=1
    echo "  FAILED:"
    tail -25 "$WORK/out$CHOP" | sed 's/^/    /'
  fi
done
[ "$FAILED" = 0 ] && echo "== the converter agrees with the rowstore this box is running ==" || echo "== SOMETHING FAILED -- do not run the conversion =="
exit $FAILED
