#!/usr/bin/env bash
# list-scripts.sh -- list the scripts available to run-script, each with the
# one-line synopsis from its header comment. Read-only; changes nothing.
set -uo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
echo "run-script scripts available on the box ($(git -C "$dir" log --oneline -1 2>/dev/null)):"
echo
for f in "$dir"/*.sh; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  desc="$(grep -m1 '^# ' "$f" | sed 's/^# *//')"
  printf '  %-20s %s\n' "$name" "$desc"
done
