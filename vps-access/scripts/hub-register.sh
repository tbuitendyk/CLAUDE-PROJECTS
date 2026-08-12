#!/usr/bin/env bash
# hub-register.sh [<name>|<name>/default] -- register a container/session with
# the mail hub, or list the registry (no argument). Registering <name>/default
# also makes it the default route for verified mail whose subject names no
# registered container. Names: lowercase letters, digits, hyphens (match the
# GitHub project branch, e.g. general-classifier).
set -uo pipefail
HUB=/var/lib/claude-mail/hub
mkdir -p "$HUB/registry"
ARG="${1:-}"

if [ -z "$ARG" ]; then
  echo "registered containers:"
  ls -1 "$HUB/registry" 2>/dev/null | sed 's/^/  /' || true
  [ -n "$(ls -A "$HUB/registry" 2>/dev/null)" ] || echo "  (none)"
  echo "default route: $(cat "$HUB/default-route" 2>/dev/null || echo '(unset)')"
  exit 0
fi

NAME="${ARG%/default}"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid name: $NAME (want ^[a-z0-9][a-z0-9-]*$)"; exit 1; }
mkdir -p "$HUB/inbox/$NAME" "$HUB/delivered/$NAME"
[ -f "$HUB/registry/$NAME" ] || echo "registered $(date '+%F %T')" > "$HUB/registry/$NAME"
echo "registered: $NAME"
if [ "$ARG" != "$NAME" ]; then
  echo "$NAME" > "$HUB/default-route"
  echo "default route set to: $NAME"
fi
