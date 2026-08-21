#!/usr/bin/env bash
# uts-data-inventory.sh -- what data the new system is actually holding, and
# what the old one holds beside it. Read-only: ls, du, find. Changes nothing.
set -uo pipefail
NEW=/opt/ultimate-trading-system/data
OLD=/opt/general-classifier/data

echo "== the new system's data tree =="
if [ -d "$NEW" ]; then
  du -sh "$NEW" 2>/dev/null
  for d in "$NEW"/*/; do
    [ -d "$d" ] || continue
    printf "  %-28s %8s  %s files\n" "$(basename "$d")" "$(du -sh "$d" 2>/dev/null | cut -f1)" "$(find "$d" -type f 2>/dev/null | wc -l)"
  done
  echo "  loose files at the top:"
  find "$NEW" -maxdepth 1 -type f -printf "    %f (%s bytes)\n" 2>/dev/null | head -20
  echo "  cache contents by kind:"
  find "$NEW/cache" -type f 2>/dev/null | sed 's|.*/||' | sed 's/[0-9]\{4\}-[0-9]\{2\}/YYYY-MM/g' | sed 's/^[A-Z0-9]\{5,12\}/SYMBOL/' | sort | uniq -c | sort -rn | head -12
  echo "  distinct symbols cached:"
  find "$NEW/cache" -type f 2>/dev/null | sed 's|.*/||' | grep -o '^[A-Z0-9]\{5,12\}' | sort -u | tr '\n' ' '; echo
else
  echo "  (no data directory)"
fi

echo
echo "== the previous generation, for comparison (untouched) =="
[ -d "$OLD" ] && du -sh "$OLD" 2>/dev/null && ls "$OLD" | tr '\n' ' ' && echo || echo "  (absent)"

echo
echo "== disk =="
df -h /opt | tail -1
