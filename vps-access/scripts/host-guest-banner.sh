#!/usr/bin/env bash
# host-guest-banner.sh -- READ-ONLY: isolate "forwarding broken" from "guest
# too slow". Banner-grab the guest DIRECTLY on host-only (192.168.56.129) vs
# THROUGH the public forward (74.208.226.14), generous 15s timeout for the
# load-19 boot storm. No changes.
set -uo pipefail
probe() { # $1 host  $2 port  $3 label
  local out
  out=$(timeout 15 bash -c "exec 3<>/dev/tcp/$1/$2 && head -c 100 <&3" 2>/dev/null)
  if [ -n "$out" ]; then echo "  $3 $1:$2 -> BANNER: $(printf '%s' "$out" | head -1 | tr -d '\r')"
  else echo "  $3 $1:$2 -> connect ok but NO banner in 15s"; fi
}
echo "== DIRECT to guest (host-only 192.168.56.129) =="
for p in 25 143 110; do probe 192.168.56.129 "$p" direct; done
echo "== THROUGH public forward (74.208.226.14 -> VBoxNetNAT -> guest) =="
for p in 25 143 110; do probe 74.208.226.14 "$p" public; done
echo "(read-only)"
