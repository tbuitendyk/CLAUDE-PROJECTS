#!/usr/bin/env bash
# uts-what-survives.sh -- READ-ONLY. Exactly what is left on disk for the named
# record set, and whether anything anywhere holds a copy. Changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data
echo "== the store directory =="
ls -la $D/stagesets/ 2>/dev/null | head -30
echo ""
for d in $D/stagesets/*/; do
  b=$(basename "$d")
  case "$b" in *mto5o106*) echo "-- $b"; ls -la "$d" 2>/dev/null; du -sh "$d" 2>/dev/null;; esac
done
echo ""
echo "== every directory that mentions this set =="
find $D -maxdepth 3 -name '*mto5o106*' -printf '%y %10s  %p\n' 2>/dev/null | head -40
echo ""
echo "== is there a trash / snapshot / backup anywhere =="
ls -la $D 2>/dev/null | head -20
find /opt/ultimate-trading-system -maxdepth 2 -iname '*backup*' -o -maxdepth 2 -iname '*snapshot*' -o -maxdepth 2 -iname '*.bak' 2>/dev/null | head
echo ""
echo "== filesystem snapshots =="
( command -v zfs >/dev/null && zfs list -t snapshot 2>/dev/null | head ) || echo "(no zfs)"
( command -v btrfs >/dev/null && btrfs subvolume list / 2>/dev/null | head ) || echo "(no btrfs)"
( command -v lvs >/dev/null && lvs 2>/dev/null | head ) || echo "(no lvm tooling)"
echo ""
echo "== disk free (a large recent free is the deleted data) =="
df -h /opt 2>/dev/null
