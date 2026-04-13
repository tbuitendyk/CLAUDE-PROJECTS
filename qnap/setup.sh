#!/bin/sh
# QNAP Setup Script — SSH Reverse Tunnel
# Run as root on the QNAP via SSH
# Compatible with ash/sh (no bash required)
set -eu

echo "=== QNAP SSH Reverse Tunnel Setup ==="

# Configuration
VPS_USER="tunnel-qnap"
KEY_FILE="/root/.ssh/id_tunnel_vps"
TUNNEL_SCRIPT="/opt/tunnel-smb.sh"
MONITOR_SCRIPT="/opt/tunnel-monitor.sh"

# 1. Generate SSH key pair for the tunnel (if not present)
if [ ! -f "$KEY_FILE" ]; then
    echo "Generating SSH key pair for tunnel..."
    mkdir -p /root/.ssh
    chmod 700 /root/.ssh
    ssh-keygen -t ed25519 -f "$KEY_FILE" -N "" -C "qnap-tunnel"
    echo ""
    echo "=============================================="
    echo "=== QNAP Public Key (add to VPS)          ==="
    echo "=============================================="
    cat "${KEY_FILE}.pub"
    echo "=============================================="
    echo ""
    echo "Add this key to the VPS file:"
    echo "  /home/tunnel-qnap/.ssh/authorized_keys"
    echo ""
else
    echo "SSH key already exists at $KEY_FILE"
    printf "Public key: "
    cat "${KEY_FILE}.pub"
fi

# 2. Get VPS IP
printf "Enter the VPS public IP address: "
read VPS_IP

# 3. Test SSH connectivity
echo "Testing SSH connection to $VPS_IP..."
echo "(If this is the first connection, type 'yes' to accept the host key)"
if ssh -i "$KEY_FILE" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
   "${VPS_USER}@${VPS_IP}" "echo connected" 2>/dev/null; then
    echo "SSH connection successful."
else
    echo ""
    echo "WARNING: SSH connection failed."
    echo "Make sure you've added the public key above to the VPS first."
    echo "The tunnel script will be created anyway — fix the key and start it manually."
fi

# 4. Create the tunnel script
cat > "$TUNNEL_SCRIPT" << SCRIPT_EOF
#!/bin/sh
# SSH reverse tunnel: forward VPS:445 -> QNAP:445 (SMB)
exec ssh -i "$KEY_FILE" \\
    -o ServerAliveInterval=30 \\
    -o ServerAliveCountMax=3 \\
    -o ExitOnForwardFailure=yes \\
    -o StrictHostKeyChecking=accept-new \\
    -N \\
    -R 0.0.0.0:445:127.0.0.1:445 \\
    "${VPS_USER}@${VPS_IP}"
SCRIPT_EOF
chmod +x "$TUNNEL_SCRIPT"
echo "Created tunnel script: $TUNNEL_SCRIPT"

# 5. Create a cron-based monitor script (called every minute by crond)
cat > "$MONITOR_SCRIPT" << 'MONITOR_HEADER'
#!/bin/sh
# Called by cron every minute. Starts tunnel if not running.
TUNNEL_SCRIPT="TUNNEL_PLACEHOLDER"
PIDFILE="/var/run/tunnel-smb.pid"
LOGFILE="/var/log/tunnel-smb.log"

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && grep -q "ssh" /proc/"$PID"/cmdline 2>/dev/null; then
        exit 0
    fi
fi

echo "$(date): Tunnel not running, starting..." >> "$LOGFILE"
rm -f "$PIDFILE"
$TUNNEL_SCRIPT >> "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
MONITOR_HEADER

# Replace placeholder with actual tunnel script path
sed -i "s|TUNNEL_PLACEHOLDER|$TUNNEL_SCRIPT|" "$MONITOR_SCRIPT"
chmod +x "$MONITOR_SCRIPT"
echo "Created monitor script: $MONITOR_SCRIPT"

# 6. Add cron job to /etc/config/crontab (persists across QNAP reboots)
CRONTAB="/etc/config/crontab"
if ! grep -q "tunnel-monitor" "$CRONTAB"; then
    echo "* * * * * /opt/tunnel-monitor.sh >> /var/log/tunnel-smb.log 2>&1" >> "$CRONTAB"
    crontab "$CRONTAB"
    echo "Added cron job for tunnel monitor."
else
    echo "Cron job already exists."
fi

# 7. Run it now
$MONITOR_SCRIPT
sleep 3

# Check if it's running
if [ -f /var/run/tunnel-smb.pid ] && kill -0 "$(cat /var/run/tunnel-smb.pid)" 2>/dev/null; then
    echo "Tunnel is running! (PID: $(cat /var/run/tunnel-smb.pid))"
else
    echo "WARNING: Tunnel may not have started. Check /var/log/tunnel-smb.log"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The tunnel is managed by cron (every 60 seconds)."
echo "If the tunnel dies, cron restarts it automatically."
echo ""
echo "Logs: cat /var/log/tunnel-smb.log"
echo ""
echo "Ensure your QNAP startup script includes the /opt symlink restore:"
echo "  ln -sf /share/CACHEDEV3_DATA/.opt /opt"
echo ""
echo "Test from any machine: smb://YOUR_VPS_IP/"
