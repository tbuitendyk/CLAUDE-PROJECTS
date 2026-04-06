# VPN + SMB Forwarding: VPS to QNAP

Access your QNAP NAS SMB shares from anywhere using a Debian VPS as a public entry point, with a WireGuard tunnel connecting the two.

## Architecture

```
SMB Client ──TCP 445──▶ VPS (public IP) ──WireGuard tunnel──▶ QNAP (home network)
                        10.0.0.1                               10.0.0.2
```

- **VPS** (Debian 11): Has a static public IP. Listens for WireGuard and forwards SMB traffic.
- **QNAP**: Behind NAT / provider VPN. Initiates the WireGuard connection outbound (no inbound ports needed on the home network).
- **WireGuard**: Lightweight kernel-level VPN. The QNAP connects *to* the VPS, keeping the tunnel alive with `PersistentKeepalive`.

## Prerequisites

| Machine | Requirements |
|---------|-------------|
| VPS | Debian 11, root access, static public IP, firewall allows UDP 51820 + TCP 445 |
| QNAP | Root shell (SSH), WireGuard available (via Entware/opkg, QVPN, or manual install) |

## Quick Start

### 1. Set up the QNAP first (generate its keys)

```bash
ssh admin@your-qnap
sudo -i
# Copy the qnap/ directory to the QNAP, then:
chmod +x setup.sh
./setup.sh
# Note the QNAP public key printed during setup
```

### 2. Set up the VPS

```bash
ssh root@your-vps
# Copy the vps/ directory to the VPS, then:
chmod +x setup.sh
./setup.sh
# It will prompt for the QNAP public key from step 1
# Note the VPS public key printed during setup
```

### 3. Finish QNAP config

The QNAP setup script will have prompted for the VPS public key. If you ran the QNAP first, re-run it or manually edit `/etc/wireguard/wg0.conf` to insert the VPS public key.

### 4. Verify the tunnel

On either machine:
```bash
wg show
# Should show a handshake and data transfer

# From QNAP:
ping 10.0.0.1

# From VPS:
ping 10.0.0.2
```

### 5. Connect via SMB

From any machine on the internet:
```
smb://YOUR_VPS_PUBLIC_IP/
\\YOUR_VPS_PUBLIC_IP\sharename
```

## File Overview

```
vps/
  wg0.conf     # WireGuard config template for the VPS
  setup.sh     # Automated setup script for the VPS

qnap/
  wg0.conf     # WireGuard config template for the QNAP
  setup.sh     # Automated setup script for the QNAP
```

## Network Details

| Setting | Value |
|---------|-------|
| WireGuard subnet | 10.0.0.0/24 |
| VPS tunnel IP | 10.0.0.1 |
| QNAP tunnel IP | 10.0.0.2 |
| WireGuard port | UDP 51820 |
| SMB port forwarded | TCP 445 |

## Security Considerations

- **SMB over the internet is inherently risky.** Anyone who can reach your VPS on port 445 can attempt to authenticate against your QNAP shares. Make sure your QNAP SMB credentials are strong.
- **Consider restricting access** by IP using iptables on the VPS. For example, to allow only your known client IP:
  ```bash
  iptables -I FORWARD -i eth0 -o wg0 -p tcp --dport 445 -s !YOUR_CLIENT_IP -j DROP
  ```
- **Alternative: tunnel SMB over SSH** instead of exposing port 445 directly. This adds authentication at the transport layer:
  ```bash
  ssh -L 4450:10.0.0.2:445 root@YOUR_VPS_IP
  # Then connect to smb://localhost:4450/
  ```
- The WireGuard tunnel itself is encrypted and authenticated via public key cryptography.

## Troubleshooting

- **No WireGuard handshake**: Check that UDP 51820 is open on the VPS firewall. On the QNAP, verify the VPS endpoint IP is correct.
- **Tunnel up but SMB not working**: Run `iptables -t nat -L -n` on the VPS to verify the DNAT rule exists. Check that SMB is running on the QNAP (`ss -tlnp | grep 445`).
- **Connection drops**: The `PersistentKeepalive = 25` in the QNAP config should keep the tunnel alive. If the QNAP's upstream VPN/NAT is aggressive, try lowering it to `15`.
- **QNAP reboot loses WireGuard**: Add `wg-quick up wg0` to your QNAP's `autorun.sh`. See the setup script output for details.
- **VPS interface isn't eth0**: The setup script auto-detects your default interface. If you need to change it later, update the `iptables` rules in `/etc/wireguard/wg0.conf`.
