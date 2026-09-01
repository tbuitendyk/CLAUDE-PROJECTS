#!/usr/bin/env bash
# Clears leftover totals TEMP files -- and ONLY ones whose writer is dead.
#
# The totalling writes to "<tally>.tmp<pid>-<n>" and renames it into place when
# it finishes; a service that dies mid-write leaves the temp behind. The pid is
# in the NAME, so whether it is garbage or a live write is a fact to be read,
# not assumed. Anything whose pid still exists is LEFT ALONE and said so.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
shopt -s nullglob
FOUND=0
for f in data/stagesets/*.tmp*-*; do
  FOUND=1
  base=$(basename "$f")
  pid=$(printf '%s\n' "$base" | sed -n 's/.*\.tmp\([0-9]\{1,\}\)-[0-9]\{1,\}$/\1/p')
  size=$(stat -c %s "$f" 2>/dev/null || echo '?')
  when=$(stat -c %y "$f" 2>/dev/null | cut -c1-19)
  if [ -z "$pid" ]; then
    echo "  LEFT: $base -- no pid in the name, so nothing here can say it is dead"
  elif kill -0 "$pid" 2>/dev/null; then
    echo "  LEFT: $base -- process $pid is ALIVE, this is a write in progress"
  else
    echo "  removing $base  (${size} bytes, ${when}, process $pid is gone)"
    rm -f -- "$f"
  fi
done
[ "$FOUND" = 0 ] && echo "  nothing to clear"
echo
echo "== what is left beside the totals =="
ls -la --time-style=long-iso data/stagesets/ | grep -i 'tally' || echo "  (no totals files)"
