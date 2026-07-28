#!/usr/bin/env bash
# wireguard-montreal-setup.sh -- bring up the Binance-execution split tunnel:
# a WireGuard interface (wg0) whose exit is our dedicated Montreal IP.
#
# SAFETY BY DESIGN — this cannot disrupt the classifier's own traffic:
#   * the config MUST set `Table = off` (checked below), so wg-quick installs
#     NO default route. The interface simply EXISTS; nothing on the box is
#     rerouted. The execution adapter later sends ONLY its Binance API calls
#     out via wg0 explicitly (curl --interface wg0 / bind-to-device). Data
#     pulls, deploys, the site — all stay on the direct line, untouched.
#
# PREREQUISITES (done by hand, out of band — secrets NEVER live in git):
#   1. Provision the Montreal endpoint + dedicated IP (owner; see the runbook
#      wireguard-montreal-runbook.md). Get its WireGuard peer config.
#   2. Place it at /etc/wireguard/wg0.conf on the VPS, root:root 600, with
#      `Table = off` in the [Interface] section.
#   3. Only THEN run this (and only when no screen/sweep/null is in flight).
# Idempotent: re-running re-checks and re-verifies. Read-only if already up.
set -euo pipefail

CONF=/etc/wireguard/wg0.conf
IFACE=wg0

if [[ ! -f "$CONF" ]]; then
  echo "REFUSING: $CONF not present. Place the Montreal peer config first (see runbook)." >&2
  exit 1
fi
if ! grep -qiE '^\s*Table\s*=\s*off' "$CONF"; then
  echo "REFUSING: $CONF must set 'Table = off' (application-layer split; no system reroute)." >&2
  echo "Add 'Table = off' to the [Interface] section and re-run." >&2
  exit 1
fi

echo "== ensuring wireguard is installed =="
if ! command -v wg-quick >/dev/null 2>&1; then
  apt-get update -qq || echo "  apt update failed (stale repo?) — trying install anyway"
  apt-get install -y --no-install-recommends wireguard-tools || {
    echo "REFUSING: could not install wireguard-tools." >&2; exit 1; }
fi

echo "== bringing up $IFACE (Table=off — no default-route change) =="
if wg show "$IFACE" >/dev/null 2>&1; then
  echo "  $IFACE already up; leaving it."
else
  wg-quick up "$IFACE"
fi
systemctl enable "wg-quick@${IFACE}" >/dev/null 2>&1 || true

echo "== verifying the tunnel and the exit IP =="
sleep 2
wg show "$IFACE" | sed 's/^/  /'
# Direct exit (should be the US VPS address) vs tunnel exit (should be Montreal)
DIRECT=$(curl -s -m 15 https://api.ipify.org || echo "?")
TUN=$(curl -s -m 15 --interface "$IFACE" https://api.ipify.org || echo "?")
echo "  direct exit IP : $DIRECT"
echo "  wg0 exit IP    : $TUN"
if [[ "$TUN" == "?" || "$TUN" == "$DIRECT" ]]; then
  echo "WARNING: tunnel exit IP did not resolve to a distinct address — check the peer config/handshake." >&2
  exit 2
fi
echo "OK: split tunnel up. Point the execution adapter at --interface $IFACE; IP-pin the Binance key to $TUN."
