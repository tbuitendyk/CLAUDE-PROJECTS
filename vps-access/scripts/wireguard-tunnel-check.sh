#!/usr/bin/env bash
# wireguard-tunnel-check.sh -- read-only health probe for the Montreal split
# tunnel: interface state, last handshake age, and the exit IP seen through
# wg0 vs the direct line. This is the check the execution adapter's watchdog
# runs before every entry: if wg0 is down or the exit IP is wrong, HALT new
# entries (resting exchange-side stops stay parked). Safe to run any time.
set -euo pipefail
IFACE=wg0
if ! wg show "$IFACE" >/dev/null 2>&1; then
  echo "DOWN: $IFACE not up"
  exit 1
fi
HS=$(wg show "$IFACE" latest-handshakes | awk '{print $2}' | head -1)
NOW=$(date +%s)
AGE=$(( NOW - ${HS:-0} ))
TUN=$(curl -s -m 15 --interface "$IFACE" https://api.ipify.org || echo "?")
DIRECT=$(curl -s -m 15 https://api.ipify.org || echo "?")
echo "iface=$IFACE handshake_age=${AGE}s wg0_exit=$TUN direct_exit=$DIRECT"
if [[ "$TUN" == "?" || "$TUN" == "$DIRECT" ]]; then echo "UNHEALTHY: tunnel exit not distinct"; exit 2; fi
if (( AGE > 300 )); then echo "STALE: last handshake ${AGE}s ago"; exit 3; fi
echo "HEALTHY"
