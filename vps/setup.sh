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

# Add Match block for the tunnel user:
#   - Restrict to remote forwarding only
#   - GatewayPorts yes (within the match context)
#   - ForceCommand to keep the session alive (required for -N tunnels)
if ! grep -q "Match User tunnel-qnap" "$SSHD_CONFIG"; then
    cat >> "$SSHD_CONFIG" << 'SSHD_EOF'

# Allow tunnel-qnap to bind privileged ports for SMB forwarding
Match User tunnel-qnap
    PermitOpen any
    AllowTcpForwarding remote
    GatewayPorts yes
    ForceCommand /bin/sleep infinity
SSHD_EOF
    echo "Added Match block for tunnel-qnap."
fi

# Allow non-root users to bind privileged ports via sysctl
if ! grep -q "^net.ipv4.ip_unprivileged_port_start=0" /etc/sysctl.conf; then
    echo "net.ipv4.ip_unprivileged_port_start=0" >> /etc/sysctl.conf
    sysctl -w net.ipv4.ip_unprivileged_port_start=0
    echo "Enabled unprivileged binding to all ports."
fi

# Create a dedicated user for the tunnel
if ! id tunnel-qnap >/dev/null 2>&1; then
    useradd -r -s /bin/sh -m tunnel-qnap
    echo "Created user: tunnel-qnap"

    # Set up SSH key auth for this user
    mkdir -p /home/tunnel-qnap/.ssh
    chmod 700 /home/tunnel-qnap/.ssh
    touch /home/tunnel-qnap/.ssh/authorized_keys
    chmod 600 /home/tunnel-qnap/.ssh/authorized_keys
    chown -R tunnel-qnap:tunnel-qnap /home/tunnel-qnap

    echo ""
    echo "=== ACTION REQUIRED ==="
    echo "Paste the QNAP's SSH public key into:"
    echo "  /home/tunnel-qnap/.ssh/authorized_keys"
    echo "========================"
else
    echo "User tunnel-qnap already exists."
fi

# Restart sshd to apply changes
systemctl restart ssh
echo "sshd restarted."

# 2. Firewall — allow TCP 445 inbound
# Support both UFW and raw iptables
echo "Configuring firewall..."
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "active"; then
    if ! ufw status | grep -q "445/tcp"; then
        ufw allow 445/tcp
        echo "Added UFW rule to allow TCP 445."
    else
        echo "UFW already allows TCP 445."
    fi
else
    if ! iptables -C INPUT -p tcp --dport 445 -j ACCEPT 2>/dev/null; then
        iptables -A INPUT -p tcp --dport 445 -j ACCEPT
        echo "Added iptables rule to allow TCP 445."
    else
        echo "TCP 445 already allowed."
    fi

    # Persist iptables rules
    if command -v netfilter-persistent >/dev/null 2>&1; then
        netfilter-persistent save
    else
        echo "NOTE: Install iptables-persistent to keep rules across reboots:"
        echo "  apt-get install -y iptables-persistent"
    fi
fi

echo ""
echo "=== VPS Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Add the QNAP's SSH public key to /home/tunnel-qnap/.ssh/authorized_keys"
echo "  2. Run the QNAP setup script on the QNAP"
echo "  3. The QNAP will connect and forward VPS:445 -> QNAP:445"
echo ""
echo "IMPORTANT: Make sure your VPS platform firewall also allows TCP 445 inbound."
