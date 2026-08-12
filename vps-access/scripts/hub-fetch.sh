#!/usr/bin/env bash
# hub-fetch.sh <name> -- a registered container picks up the verified owner
# mail the hub routed to it. Prints NEXT-POLL (60s inside the 20-min fast
# window, else 900s), then the queued messages oldest-first within a ~6KB
# budget (the endpoint caps output); anything beyond the budget stays queued
# for the next call. Shown messages move to delivered/<name>/ (archived, not
# deleted). Usage from a session:  run-script hub-fetch.sh  arg <name>
set -uo pipefail
HUB=/var/lib/claude-mail/hub
STATE=/var/lib/claude-mail
NAME="${1:-}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "usage: hub-fetch.sh <registered-name>"; exit 1; }
[ -f "$HUB/registry/$NAME" ] || { echo "NOT REGISTERED: $NAME -- run-script hub-register.sh arg $NAME"; exit 1; }

now=$(date +%s); last_int=$(cat "$STATE/last-sent" 2>/dev/null || echo 0)
case "$last_int" in (*[!0-9]*|"") last_int=0;; esac
if [ $((now - last_int)) -lt 1200 ]; then
  echo "NEXT-POLL 60  (inside the 20-min fast window)"
else
  echo "NEXT-POLL 900"
fi

shopt -s nullglob
files=( "$HUB/inbox/$NAME"/*.txt )
if [ ${#files[@]} -eq 0 ]; then
  echo "no routed mail for $NAME"
  exit 0
fi
mkdir -p "$HUB/delivered/$NAME"
budget=6000; shown=0
for f in "${files[@]}"; do
  sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
  if [ "$shown" -gt 0 ] && [ $((budget - sz)) -lt 0 ]; then
    echo "MORE QUEUED: $(( ${#files[@]} - shown )) message(s) remain -- call hub-fetch.sh $NAME again"
    break
  fi
  echo "===== $(basename "$f") ====="
  cat "$f"; echo
  mv "$f" "$HUB/delivered/$NAME/"
  budget=$((budget - sz)); shown=$((shown + 1))
done
echo "$shown message(s) delivered to $NAME (archive: hub/delivered/$NAME/)"
