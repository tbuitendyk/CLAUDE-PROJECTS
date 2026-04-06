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

# 5. Create a monitor script that restarts the tunnel if it drops
cat > "$MONITOR_SCRIPT" << 'MONITOR_HEADER'
#!/bin/sh
# Monitor and restart the SMB tunnel if it drops
TUNNEL_SCRIPT="TUNNEL_PLACEHOLDER"
PIDFILE="/var/run/tunnel-smb.pid"
LOGFILE="/var/log/tunnel-smb.log"

start_tunnel() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        return 0
    fi
    echo "$(date): Starting SMB tunnel..." >> "$LOGFILE"
    $TUNNEL_SCRIPT >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
}

stop_tunnel() {
    if [ -f "$PIDFILE" ]; then
        kill "$(cat "$PIDFILE")" 2>/dev/null || true
        rm -f "$PIDFILE"
        echo "$(date): Tunnel stopped." >> "$LOGFILE"
    fi
}

case "${1:-start}" in
    start)
        start_tunnel
        ;;
    stop)
        stop_tunnel
        ;;
    restart)
        stop_tunnel
        sleep 2
        start_tunnel
        ;;
    monitor)
        # Run in a loop, restarting if the tunnel dies
        while true; do
            start_tunnel
            # Wait for tunnel process to exit
            wait "$(cat "$PIDFILE")" 2>/dev/null || true
            echo "$(date): Tunnel exited, restarting in 10s..." >> "$LOGFILE"
            sleep 10
        done
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|monitor}"
        exit 1
        ;;
esac
MONITOR_HEADER

# Replace placeholder with actual tunnel script path
sed -i "s|TUNNEL_PLACEHOLDER|$TUNNEL_SCRIPT|" "$MONITOR_SCRIPT"
chmod +x "$MONITOR_SCRIPT"
echo "Created monitor script: $MONITOR_SCRIPT"

# 6. Start the tunnel
echo ""
echo "Starting tunnel..."
$MONITOR_SCRIPT monitor &
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
echo "Commands:"
echo "  Start:   $MONITOR_SCRIPT monitor &"
echo "  Stop:    $MONITOR_SCRIPT stop"
echo "  Restart: $MONITOR_SCRIPT restart"
echo "  Logs:    cat /var/log/tunnel-smb.log"
echo ""
echo "Add this to your startup script for persistence across reboots:"
echo "  $MONITOR_SCRIPT monitor &"
echo ""
echo "Test from any machine: smb://YOUR_VPS_IP/"
