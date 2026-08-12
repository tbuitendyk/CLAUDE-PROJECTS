#!/usr/bin/env bash
# hub-notice-post.sh <name> -- post the committed notice file
# vps-access/hub-notices/<name>.txt into the on-box notice queue; the container
# sees it (clearly labeled, non-owner) at the top of its next hub-fetch.
set -uo pipefail
HUB=/var/lib/claude-mail/hub
NAME="${1:-}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "usage: hub-notice-post.sh <registered-name>"; exit 1; }
[ -f "$HUB/registry/$NAME" ] || { echo "NOT REGISTERED: $NAME"; exit 1; }
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hub-notices/$NAME.txt"
[ -f "$SRC" ] || { echo "no committed notice at vps-access/hub-notices/$NAME.txt"; exit 1; }
mkdir -p "$HUB/notice/$NAME"
cp "$SRC" "$HUB/notice/$NAME/$(date +%s).txt"
echo "notice posted for $NAME ($(wc -c < "$SRC") bytes); it prints at the top of their next hub-fetch"
echo "$(date '+%F %T') NOTICE posted -> $NAME" >> "$HUB/log/hub.log"
