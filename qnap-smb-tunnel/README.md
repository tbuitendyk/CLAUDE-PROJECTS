# SMB Access to QNAP via VPS — SSH Reverse Tunnel

Access your QNAP NAS SMB shares from anywhere using a Debian VPS as a public entry point, with an SSH reverse tunnel connecting the two.

## Architecture

```
SMB Client ──TCP 445──▶ VPS (public IP) ──SSH reverse tunnel──▶ QNAP:445
```

- **VPS** (Debian 11): Has a static public IP. sshd accepts a tunnel connection from the QNAP and exposes port 445.
- **QNAP**: Behind NAT / provider VPN (not publicly accessible). Initiates an outbound SSH connection to the VPS, forwarding the VPS's port 445 back to its own local SMB service.
- **No kernel modules required** — uses only SSH, which is already available on both machines.

## Prerequisites

| Machine | Requirements |
|---------|-------------|
| VPS | Debian 11, root access, static public IP, platform + OS firewall allows TCP 445 |
| QNAP | Root shell (SSH), outbound SSH access to VPS on port 22 |

## Setup

### 1. QNAP — run setup first (to generate SSH key)

```sh
ssh admin@your-qnap
sudo -i
sh qnap/setup.sh
```

This will:
- Generate an SSH key pair for the tunnel
- Print the public key — save it for step 3
- Create the tunnel and monitor scripts in `/opt/`

### 2. VPS — run setup

```sh
ssh root@your-vps
chmod +x vps/setup.sh
./vps/setup.sh
```

This will:
- Enable `GatewayPorts yes` in sshd
- Add a `Match User tunnel-qnap` block with `ForceCommand /bin/sleep infinity`
- Set `net.ipv4.ip_unprivileged_port_start=0` so the tunnel user can bind port 445
- Create the `tunnel-qnap` user with SSH key auth
- Open TCP 445 in the OS firewall (UFW or iptables)

### 3. Add the QNAP public key to the VPS

On the VPS, paste the QNAP's public key:

```sh
echo "ssh-ed25519 AAAA..." > /home/tunnel-qnap/.ssh/authorized_keys
chown -R tunnel-qnap:tunnel-qnap /home/tunnel-qnap
chmod 700 /home/tunnel-qnap/.ssh
chmod 600 /home/tunnel-qnap/.ssh/authorized_keys
```

### 4. Open port 445 on the VPS platform firewall

If your VPS provider has a separate network/platform firewall (e.g., IONOS, Hetzner, DigitalOcean), you must also open TCP 445 there. The OS-level firewall alone is not sufficient.

You can restrict this to specific client IPs for security.

### 5. Start the tunnel

On the QNAP:

```sh
/opt/tunnel-monitor.sh monitor &
```

### 6. Persist across QNAP reboots

Add these lines to your QNAP startup script (before any `sleep`):

```sh
# Restore /opt symlink for Entware
ln -sf /share/CACHEDEV3_DATA/.opt /opt
export PATH="/opt/bin:/opt/sbin:$PATH"

# Start SMB tunnel to VPS
/opt/tunnel-monitor.sh monitor &
```

### 7. Connect via SMB

From any machine:
```
smb://YOUR_VPS_PUBLIC_IP/
\\YOUR_VPS_PUBLIC_IP\sharename
```

## File Overview

```
vps/
  setup.sh          # VPS setup: sshd config, tunnel user, firewall

qnap/
  setup.sh          # QNAP setup: SSH keys, tunnel + monitor scripts
```

## How the Tunnel Works

1. The QNAP opens an SSH connection to the VPS as user `tunnel-qnap`
2. The `-R 0.0.0.0:445:127.0.0.1:445` flag tells the VPS to listen on port 445 and forward all traffic through the SSH tunnel to the QNAP's local port 445 (SMB)
3. `ServerAliveInterval=30` sends keepalives every 30 seconds
4. `ForceCommand /bin/sleep infinity` on the VPS keeps the sshd child process alive
5. The monitor script (`tunnel-monitor.sh`) automatically restarts the tunnel if SSH drops

## Managing the Tunnel

On the QNAP:

```sh
/opt/tunnel-monitor.sh start     # Start tunnel
/opt/tunnel-monitor.sh stop      # Stop tunnel
/opt/tunnel-monitor.sh restart   # Restart tunnel
/opt/tunnel-monitor.sh monitor   # Start with auto-restart (use in startup script)
cat /var/log/tunnel-smb.log      # View logs
```

## Security Considerations

- **SMB over the internet is inherently risky.** Anyone who can reach your VPS on port 445 can attempt to authenticate. Use strong QNAP credentials.
- **Restrict by source IP** on the VPS platform firewall and/or UFW:
  ```sh
  ufw allow from YOUR_CLIENT_IP to any port 445 proto tcp
  ufw deny 445/tcp
  ```
- The `tunnel-qnap` user is restricted: `ForceCommand /bin/sleep infinity` prevents interactive use, `AllowTcpForwarding remote` limits to remote port forwarding only.
- The SSH tunnel itself is fully encrypted.
- Consider installing `fail2ban` on the VPS to protect against SSH brute-force attacks.

## Troubleshooting

- **Tunnel won't start**: Check `/var/log/tunnel-smb.log` on the QNAP. Verify the SSH key is in `/home/tunnel-qnap/.ssh/authorized_keys` on the VPS with correct ownership (`tunnel-qnap:tunnel-qnap`) and permissions (700/600).
- **"remote port forwarding failed for listen port 445"**:
  - Check `ss -tlnp | grep 445` on the VPS — a stale sshd process may be holding the port. Kill it.
  - Verify `net.ipv4.ip_unprivileged_port_start=0` is set: `sysctl net.ipv4.ip_unprivileged_port_start`
  - Check that `ForceCommand /bin/sleep infinity` is in the sshd Match block — without it, the session exits immediately and orphans the port binding.
- **Client connects but times out**:
  - Check the VPS platform firewall allows TCP 445 (not just iptables/UFW).
  - Verify with `tcpdump -i <interface> port 445 -n` on the VPS.
  - If using UFW, ensure the UFW rule is added (`ufw allow 445/tcp`), as UFW chains are evaluated before manual iptables rules.
- **"Address already in use" on port 445**: A stale sshd child from a previous tunnel is holding the port. Find and kill it: `ss -tlnp | grep 445`, then `kill <pid>`.
- **Tunnel drops frequently**: The monitor script restarts automatically. Check the log for patterns. The QNAP's upstream connection may be unstable.
- **QNAP reboot loses tunnel**: Ensure the startup script includes the `/opt` symlink restore and the tunnel monitor start. The symlink is needed because QNAP's root filesystem is a tmpfs.
- **QNAP script errors with "No such file or directory"**: The script has Windows (CRLF) line endings. Fix with: `sed -i 's/\r$//' setup.sh` and run with `sh setup.sh`.
