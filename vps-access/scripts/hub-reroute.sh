#!/usr/bin/env bash
# hub-reroute.sh <msgfile>/<target> -- the gatekeeper handoff: move one message
# from the vps-access (hub) queues to another registered container's inbox.
# <msgfile> is the basename shown by hub-fetch/hub-status (e.g. 1723490000-01.txt),
# searched in the hub session's inbox first, then its delivered archive.
# Usage: run-script hub-reroute.sh  arg 1723490000-01.txt/general-classifier
set -uo pipefail
HUB=/var/lib/claude-mail/hub
ARG="${1:-}"
FILE="${ARG%%/*}"; TARGET="${ARG##*/}"
[ -n "$FILE" ] && [ -n "$TARGET" ] && [ "$FILE" != "$TARGET" ] \
  || { echo "usage: hub-reroute.sh <msgfile>/<target-container>"; exit 1; }
[[ "$FILE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$ ]] || { echo "bad msgfile: $FILE"; exit 1; }
[[ "$TARGET" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "bad target: $TARGET"; exit 1; }
[ -f "$HUB/registry/$TARGET" ] || { echo "NOT REGISTERED: $TARGET"; exit 1; }

SRC=""
for d in "$HUB/inbox/vps-access" "$HUB/delivered/vps-access"; do
  [ -f "$d/$FILE" ] && SRC="$d/$FILE" && break
done
[ -n "$SRC" ] || { echo "not found in hub queues: $FILE"; exit 1; }
mkdir -p "$HUB/inbox/$TARGET"
mv "$SRC" "$HUB/inbox/$TARGET/$FILE"
echo "rerouted $FILE -> $TARGET (queued for its next hub-fetch)"
echo "$(date '+%F %T') REROUTE $FILE -> $TARGET" >> "$HUB/log/hub.log"
