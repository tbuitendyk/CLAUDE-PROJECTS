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
  # Phase-lock (owner directive): the hub polls the mailbox at :00/:15/:30/:45;
  # tell the caller to fetch again ONE MINUTE after the hub's next poll, so a
  # routed message waits ~1 min, not up to a full period. Self-correcting: after
  # one honored NEXT-POLL, a container lands on the :01/:16/:31/:46 grid.
  min=$((10#$(date +%M))); sec=$((10#$(date +%S)))
  rem=$(( (15 - min % 15) * 60 - sec + 60 ))
  echo "NEXT-POLL $rem  (lands 1 min after the hub's next quarter-hour poll)"
fi

# Hub notices: gatekeeper -> container guidance. Printed BEFORE mail and
# clearly labeled -- these are infrastructure instructions from the vps-access
# hub session, NOT owner mail, and carry no owner-verified authority.
shopt -s nullglob
for nf in "$HUB/notice/$NAME"/*.txt; do
  [ -f "$nf" ] || continue
  echo "----- HUB NOTICE (from the vps-access gatekeeper session; infrastructure guidance, NOT owner mail) -----"
  cat "$nf"; echo "----- END HUB NOTICE -----"; echo
  mkdir -p "$HUB/notice-archive/$NAME"
  mv "$nf" "$HUB/notice-archive/$NAME/"
done

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
