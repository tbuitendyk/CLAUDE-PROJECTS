#!/usr/bin/env bash
# disk-hogs-read.sh -- READ-ONLY: what is filling the VPS root filesystem?
#
# Written 2026-08-24 when the classifier service failed an owner action with
# "ENOSPC: no space left on device" — the box could not write the unhalt
# request, so the "Clear the halt" button could not work no matter how many
# times it was pressed. df said 315G used, 0 available, and nothing in the
# repo could say WHERE it went.
#
# Reads only. No deletes, no truncation, no rotation, no service restarts.
# Every du is depth-bounded and wrapped in a timeout so a 300G tree cannot
# hang the deploy door.
set -uo pipefail

echo "===== filesystems ====="
df -h -x tmpfs -x devtmpfs 2>/dev/null | sed 's/^/  /'
echo
echo "===== inodes (a full inode table looks identical to a full disk) ====="
df -i -x tmpfs -x devtmpfs 2>/dev/null | sed 's/^/  /'
echo
echo "===== top-level of / (depth 1, one filesystem) ====="
timeout 120 du -x -h --max-depth=1 / 2>/dev/null | sort -rh | head -20 | sed 's/^/  /'
echo
for d in /var /opt /home /root /tmp; do
  [ -d "$d" ] || continue
  echo "===== $d (depth 2) ====="
  timeout 90 du -x -h --max-depth=2 "$d" 2>/dev/null | sort -rh | head -12 | sed 's/^/  /'
  echo
done
echo "===== 25 largest individual files on / ====="
timeout 150 find / -xdev -type f -size +200M -printf '%s\t%p\n' 2>/dev/null \
  | sort -rn | head -25 \
  | awk -F'\t' '{printf "  %8.2f GB  %s\n", $1/1073741824, $2}'
echo
echo "===== systemd journal on disk ====="
journalctl --disk-usage 2>/dev/null | sed 's/^/  /' || echo "  (journalctl unavailable)"
echo
echo "===== deleted-but-open files still holding space ====="
# A rotated/removed log a process still has open frees nothing until the
# process closes it. df and du DISAGREE in exactly this case, which is the
# classic "I deleted it and got no space back".
timeout 60 lsof -nP +L1 2>/dev/null | awk 'NR==1 || $NF ~ /deleted/' | head -15 | sed 's/^/  /' \
  || echo "  (lsof unavailable)"
echo
echo "(read-only)"
