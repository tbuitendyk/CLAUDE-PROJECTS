#!/usr/bin/env bash
# list-scripts.sh -- list the run-script scripts on the box, each with a one-line synopsis.
set -uo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
echo "run-script scripts available on the box ($(git -C "$dir" log --oneline -1 2>/dev/null)):"
echo
for f in "$dir"/*.sh; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  desc="$(grep -m1 '^# ' "$f" | sed -E 's/^# *//; s/^[^ ]+ -- //')"
  printf '  %-20s %s\n' "$name" "$desc"
done
