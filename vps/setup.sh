#!/bin/sh
# VPS Setup Script — Debian 11
# SSH reverse tunnel approach for SMB forwarding
# Run as root on the VPS
set -eu

echo "=== VPS SSH Tunnel Setup for SMB Forwarding ==="

# 1. Configure SSH to allow remote port forwarding on port 445
SSHD_CONFIG="/etc/ssh/sshd_config"

echo "Configuring sshd..."

# Enable GatewayPorts so the tunnel listens on all interfaces (not just localhost)
if grep -q "^GatewayPorts" "$SSHD_CONFIG"; then
    sed -i 's/^GatewayPorts.*/GatewayPorts yes/' "$SSHD_CONFIG"
elif grep -q "^#GatewayPorts" "$SSHD_CONFIG"; then
    sed -i 's/^#GatewayPorts.*/GatewayPorts yes/' "$SSHD_CONFIG"
else
    echo "GatewayPorts yes" >> "$SSHD_CONFIG"
fi

# Create a dedicated user for the tunnel (no shell, no home)
if ! id tunnel-qnap >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin -M tunnel-qnap
    echo "Created user: tunnel-qnap"

    # Set up SSH key auth for this user
    mkdir -p /home/tunnel-qnap/.ssh
    chmod 700 /home/tunnel-qnap/.ssh
    touch /home/tunnel-qnap/.ssh/authorized_keys
    chmod 600 /home/tunnel-qnap/.ssh/authorized_keys
    chown -R tunnel-qnap:tunnel-qnap /home/tunnel-qnap 2>/dev/null || true

    echo ""
    echo "=== ACTION REQUIRED ==="
    echo "Paste the QNAP's SSH public key into:"
    echo "  /home/tunnel-qnap/.ssh/authorized_keys"
    echo ""
    echo "To restrict this key to only port forwarding, prefix it with:"
    echo '  command="/bin/false",no-pty,no-X11-forwarding,no-agent-forwarding ssh-rsa AAAA...'
    echo "========================"
else
    echo "User tunnel-qnap already exists."
fi

# Restart sshd to apply GatewayPorts
systemctl restart sshd
echo "sshd restarted with GatewayPorts enabled."

# 2. Firewall — allow TCP 445 inbound and redirect to 44500
# The SSH tunnel binds to port 44500 (non-privileged) on the VPS.
# iptables redirects incoming port 445 to 44500.
echo "Configuring iptables..."
if ! iptables -C INPUT -p tcp --dport 445 -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -p tcp --dport 445 -j ACCEPT
    echo "Added iptables rule to allow TCP 445."
fi
if ! iptables -C INPUT -p tcp --dport 44500 -j ACCEPT 2>/dev/null; then
    iptables -A INPUT -p tcp --dport 44500 -j ACCEPT
    echo "Added iptables rule to allow TCP 44500."
fi
if ! iptables -t nat -C PREROUTING -p tcp --dport 445 -j REDIRECT --to-port 44500 2>/dev/null; then
    iptables -t nat -A PREROUTING -p tcp --dport 445 -j REDIRECT --to-port 44500
    echo "Added NAT redirect: 445 -> 44500."
fi

# Persist iptables rules
if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save
else
    echo "NOTE: Install iptables-persistent to keep rules across reboots:"
    echo "  apt-get install -y iptables-persistent"
fi

echo ""
echo "=== VPS Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Add the QNAP's SSH public key to /home/tunnel-qnap/.ssh/authorized_keys"
echo "  2. Run the QNAP setup script on the QNAP"
echo "  3. The QNAP will connect and forward VPS:44500 -> QNAP:445"
echo "  4. iptables redirects external port 445 -> 44500"
echo ""
echo "IMPORTANT: Make sure your VPS firewall allows TCP 445 inbound."
