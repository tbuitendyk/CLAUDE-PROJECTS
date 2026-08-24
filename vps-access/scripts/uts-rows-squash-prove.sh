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
for CHOP in 400 8000 60000; do
  echo "== a tear of $CHOP bytes =="
  CHOP=$CHOP UTS_ROOT=$ROOT node "$HERE/uts-rows-squash-test.js" "$WORK/w$CHOP" "$HERE/uts-rows-squash.js" 2>&1 \
    | grep -E "^  ok |ALL CHECKS PASSED|AssertionError|declared configuration label|reading A|reading B|only A|only B|both can|NEITHER" \
    | sed 's/^/  /'
  # WANT_REDO only matches the default tear, so the report assertion is expected
  # to fail on the others; what those runs are for is the round trip above.
done
