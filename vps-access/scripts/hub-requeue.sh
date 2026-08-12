#!/usr/bin/env bash
# hub-requeue.sh <name> -- gatekeeper recovery: move ALL of a container's
# delivered (fetched) messages back into its inbox queue. Used when a container
# session died after fetching but before acting -- the messages re-appear on its
# next hub-fetch as if never consumed.
set -uo pipefail
HUB=/var/lib/claude-mail/hub
NAME="${1:-}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "usage: hub-requeue.sh <registered-name>"; exit 1; }
[ -f "$HUB/registry/$NAME" ] || { echo "NOT REGISTERED: $NAME"; exit 1; }
shopt -s nullglob
n=0
for f in "$HUB/delivered/$NAME"/*.txt; do
  mv "$f" "$HUB/inbox/$NAME/"; n=$((n+1))
  echo "  requeued $(basename "$f")"
done
echo "$n message(s) moved back to $NAME's queue"
echo "$(date '+%F %T') REQUEUE $n -> $NAME" >> "$HUB/log/hub.log"
