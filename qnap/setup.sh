#!/bin/sh
# QNAP Setup Script
# Run as root on the QNAP via SSH
# Compatible with ash/sh (no bash required)
set -eu

echo "=== QNAP WireGuard Setup ==="

# 1. Check for / install WireGuard
if command -v wg >/dev/null 2>&1; then
    echo "WireGuard is already installed."
else
    echo "WireGuard not found. Attempting install via opkg (Entware)..."
    if command -v opkg >/dev/null 2>&1; then
        opkg update
        opkg install wireguard-tools kmod-wireguard
    else
        echo ""
        echo "ERROR: Neither wg nor opkg found."
        echo "Install WireGuard manually on your QNAP first:"
        echo "  Option A: Install Entware from the QNAP App Center, then run this script again."
        echo "  Option B: Install the QVPN Service app and enable WireGuard."
        echo "  Option C: Manually compile/install wireguard-tools."
        exit 1
    fi
fi

# 2. Generate keys (if not already present)
KEY_DIR="/etc/wireguard"
mkdir -p "$KEY_DIR"

if [ ! -f "$KEY_DIR/privatekey" ]; then
    echo "Generating WireGuard key pair..."
    wg genkey | tee "$KEY_DIR/privatekey" | wg pubkey > "$KEY_DIR/publickey"
    chmod 600 "$KEY_DIR/privatekey"
    echo ""
    echo "=== QNAP Public Key (give this to the VPS config) ==="
    cat "$KEY_DIR/publickey"
    echo "========================================================"
    echo ""
else
    echo "Keys already exist in $KEY_DIR"
    printf "QNAP Public Key: "
    cat "$KEY_DIR/publickey"
fi

# 3. Install the WireGuard config
if [ ! -f "$KEY_DIR/wg0.conf" ]; then
    QNAP_PRIVKEY=$(cat "$KEY_DIR/privatekey")

    printf "Enter the VPS public IP address: "
    read VPS_IP
    printf "Enter the VPS's WireGuard public key: "
    read VPS_PUBKEY

    SCRIPT_DIR=$(dirname "$0")
    sed -e "s|QNAP_PRIVATE_KEY|$QNAP_PRIVKEY|" \
        -e "s|VPS_PUBLIC_KEY|$VPS_PUBKEY|" \
        -e "s|VPS_PUBLIC_IP|$VPS_IP|" \
        "$SCRIPT_DIR/wg0.conf" > "$KEY_DIR/wg0.conf"

    chmod 600 "$KEY_DIR/wg0.conf"
    echo "Config written to $KEY_DIR/wg0.conf"
else
    echo "Config already exists at $KEY_DIR/wg0.conf -- skipping."
fi

# 4. Start WireGuard
if command -v systemctl >/dev/null 2>&1; then
    systemctl enable wg-quick@wg0 2>/dev/null || true
    systemctl start wg-quick@wg0
else
    echo "No systemd detected -- starting WireGuard with wg-quick..."
    wg-quick up wg0
    echo ""
    echo "NOTE: WireGuard won't auto-start on reboot without systemd."
    echo "Add the following to your QNAP's autorun.sh (or equivalent):"
    echo "  wg-quick up wg0"
    echo ""
    echo "On QNAP, you can enable autorun scripts via:"
    echo "  Control Panel > Hardware > General > Run user defined processes (autorun.sh)"
fi

echo ""
echo "=== Setup Complete ==="
echo "Check status with: wg show"
echo "Test connectivity with: ping 10.0.0.1"
