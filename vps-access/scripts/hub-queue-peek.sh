#!/usr/bin/env bash
# hub-queue-peek.sh -- READ-ONLY gatekeeper view: per-container queue/delivered
# files with mtimes and subject lines, plus the routing history from the hub
# log. Diagnoses "container not picking up its mail" without consuming anything.
set -uo pipefail
HUB=/var/lib/claude-mail/hub
for name in $(ls "$HUB/registry" 2>/dev/null); do
  echo "== $name =="
  for kind in inbox delivered; do
    d="$HUB/$kind/$name"
    [ -d "$d" ] || continue
    for f in "$d"/*.txt; do
      [ -f "$f" ] || continue
      subj=$(grep -m1 -E '^\s*subject\s*:' "$f" | sed 's/^\s*subject\s*:\s*//' | cut -c1-60)
      printf "  %-9s %s  %s  [%s]\n" "$kind" "$(basename "$f")" "$(date -d @"$(stat -c %Y "$f")" '+%m-%d %H:%M:%S')" "$subj"
    done
  done
done
echo "== routing history (hub log: ROUTED/REROUTE lines, last 12) =="
grep -E 'ROUTED=[1-9]|-> |REROUTE|CHECK FAILED' "$HUB/log/hub.log" 2>/dev/null | tail -12 | sed 's/^/  /'
echo "(read-only)"
