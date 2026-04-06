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
| VPS | Debian 11, root access, static public IP, firewall allows TCP 445 |
| QNAP | Root shell (SSH), Entware recommended but not required |

## Setup

### 1. VPS — run setup

```sh
ssh root@your-vps
chmod +x vps/setup.sh
./vps/setup.sh
```

This will:
- Enable `GatewayPorts yes` in sshd (so the tunnel listens on all interfaces)
- Create a `tunnel-qnap` user for the tunnel connection
- Open TCP 445 in iptables

### 2. QNAP — run setup

```sh
ssh admin@your-qnap
sudo -i
chmod +x qnap/setup.sh
sh qnap/setup.sh
```

This will:
- Generate an SSH key pair for the tunnel
- Print the public key — **copy it to the VPS** (`/home/tunnel-qnap/.ssh/authorized_keys`)
- Create a tunnel script and auto-restart monitor
- Start the tunnel

### 3. Add the QNAP public key to the VPS

On the VPS, paste the QNAP's public key:

```sh
echo "ssh-ed25519 AAAA..." >> /home/tunnel-qnap/.ssh/authorized_keys
```

For extra security, restrict the key to forwarding only:

```sh
# Prefix the key in authorized_keys with:
command="/bin/false",no-pty,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA...
```

### 4. Persist across QNAP reboots

Add this line to your QNAP startup script (e.g., `/share/ICLDRVol2/datadr/startup.sh`):

```sh
/opt/tunnel-monitor.sh monitor &
```

### 5. Connect via SMB

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
4. The monitor script (`tunnel-monitor.sh`) automatically restarts the tunnel if SSH drops

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
- **Restrict by source IP** on the VPS to limit who can connect:
  ```sh
  iptables -A INPUT -p tcp --dport 445 -s YOUR_CLIENT_IP -j ACCEPT
  iptables -A INPUT -p tcp --dport 445 -j DROP
  ```
- The `tunnel-qnap` user is locked down: no shell, key-only auth, optionally restricted to forwarding only.
- The SSH tunnel itself is fully encrypted.

## Troubleshooting

- **Tunnel won't start**: Check `/var/log/tunnel-smb.log` on the QNAP. Verify the SSH key is in the VPS authorized_keys file.
- **"Permission denied" on SSH**: Make sure the key file permissions are correct (`chmod 600`) and the VPS user/key match.
- **Port 445 not responding on VPS**: Verify `GatewayPorts yes` is in `/etc/ssh/sshd_config` and sshd was restarted. Check `ss -tlnp | grep 445` on the VPS.
- **Tunnel drops frequently**: Your QNAP's upstream connection may be unstable. The monitor script will restart it automatically. Check the log for patterns.
- **"Address already in use" on port 445**: Something else on the VPS is using port 445 (e.g., Samba). Stop it: `systemctl stop smbd`.
