#!/usr/bin/env bash
# VPS Setup Script — Debian 11
# Run as root on the VPS
set -euo pipefail

echo "=== VPS WireGuard + SMB Forwarding Setup ==="

# 1. Install WireGuard
apt-get update
apt-get install -y wireguard iptables

# 2. Generate keys (if not already present)
KEY_DIR="/etc/wireguard"
if [ ! -f "$KEY_DIR/privatekey" ]; then
    echo "Generating WireGuard key pair..."
    wg genkey | tee "$KEY_DIR/privatekey" | wg pubkey > "$KEY_DIR/publickey"
    chmod 600 "$KEY_DIR/privatekey"
    echo ""
    echo "=== VPS Public Key (give this to the QNAP config) ==="
    cat "$KEY_DIR/publickey"
    echo "======================================================="
    echo ""
else
    echo "Keys already exist in $KEY_DIR"
    echo "VPS Public Key: $(cat "$KEY_DIR/publickey")"
fi

# 3. Detect primary network interface (for iptables rules)
DEFAULT_IF=$(ip route show default | awk '/default/ {print $5}' | head -1)
echo "Detected default interface: $DEFAULT_IF"

# 4. Install the WireGuard config
if [ ! -f "$KEY_DIR/wg0.conf" ]; then
    VPS_PRIVKEY=$(cat "$KEY_DIR/privatekey")

    read -rp "Enter the QNAP's WireGuard public key: " QNAP_PUBKEY

    sed -e "s|VPS_PRIVATE_KEY|$VPS_PRIVKEY|" \
        -e "s|QNAP_PUBLIC_KEY|$QNAP_PUBKEY|" \
        -e "s|eth0|$DEFAULT_IF|g" \
        "$(dirname "$0")/wg0.conf" > "$KEY_DIR/wg0.conf"

    chmod 600 "$KEY_DIR/wg0.conf"
    echo "Config written to $KEY_DIR/wg0.conf"
else
    echo "Config already exists at $KEY_DIR/wg0.conf — skipping."
    echo "Delete it first if you want to regenerate."
fi

# 5. Enable IP forwarding persistently
if ! grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf; then
    echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
    sysctl -p
    echo "IP forwarding enabled."
fi

# 6. Enable and start WireGuard
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

echo ""
echo "=== Setup Complete ==="
echo "WireGuard is running. Check status with: wg show"
echo "Clients can connect to SMB via: smb://YOUR_VPS_PUBLIC_IP/"
echo ""
echo "IMPORTANT: Make sure your VPS firewall allows:"
echo "  - UDP 51820 (WireGuard)"
echo "  - TCP 445   (SMB forwarding)"
