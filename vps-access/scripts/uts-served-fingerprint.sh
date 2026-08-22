#!/usr/bin/env bash
# uts-served-fingerprint.sh -- READ-ONLY. Exactly what the box is SERVING right
# now: which commit, and the hash of each file the screens are drawn from.
#
# Written 2026-08-22, owner order: "generate the list from what the box serves".
#
# The closed word list is the only vocabulary allowed when talking about a
# screen, and it was being generated from the repository. Between a commit and
# its deploy those are different things — so the list authorised words the owner
# could not see, which is the rule's own tool failing in the exact direction the
# rule exists to prevent. It happened: a control was renamed, committed, held
# back from deploy so a running sweep would survive, and then named to the owner
# as though it were on their screen.
#
# Output is deliberately tiny — hashes, not files — because only the last 8 KB
# reaches the session. The repository regenerates the list from the commit named
# here and checks its own copy of each file against these hashes, so a mismatch
# is a refusal rather than a wrong list.
set -uo pipefail
PORT=8094
CHECKOUT="$HOME/deploy-uts"

echo "== the commit this box last deployed =="
if [ -d "$CHECKOUT/.git" ]; then
  git -C "$CHECKOUT" rev-parse HEAD 2>/dev/null | sed 's/^/commit /'
  git -C "$CHECKOUT" log --oneline -1 2>/dev/null | sed 's/^/subject /'
else
  echo "commit UNKNOWN (no deploy checkout)"
fi

echo
echo "== what it is actually serving =="
for f in construct.js help-content.js construct.html setup.html trade.html; do
  BODY="$(curl -s --max-time 20 "http://127.0.0.1:$PORT/$f")"
  if [ -z "$BODY" ]; then
    echo "served $f MISSING"
    continue
  fi
  printf 'served %s %s %s\n' "$f" "$(printf '%s' "$BODY" | sha256sum | cut -d' ' -f1)" "$(printf '%s' "$BODY" | wc -c)"
done

echo
echo "== and what is on disk, in case they differ =="
for f in construct.js help-content.js; do
  D="/opt/ultimate-trading-system/public/$f"
  [ -f "$D" ] && printf 'ondisk %s %s %s\n' "$f" "$(sha256sum "$D" | cut -d' ' -f1)" "$(stat -c%s "$D")" || echo "ondisk $f MISSING"
done
