# Montreal split-tunnel — provisioning runbook

Goal: a dedicated, static Montreal IP that ONLY the Binance-execution traffic
exits through, so the account trades from a Canadian address while everything
else on the US VPS stays direct. The API key gets IP-pinned to that address.

## Step 1 — provision the endpoint (OWNER — needs payment + identity; the
## session cannot do this)

**Recommended: self-hosted WireGuard on an OVHcloud VPS in Beauharnois, QC.**
- Beauharnois is OVH's Quebec datacenter (~40 km from Montreal); a datacenter
  IP is fine for exchange API use (residential is not required for API keys).
- Entry VPS is plenty — 1 vCPU / 2 GB is overkill for a WG relay; ~$5–6/mo.
  You get a dedicated IPv4 nobody else shares — the whole point.
- Why self-host over a commercial static-IP VPN: a dedicated IP you control,
  no third party in the trade path, no shared-IP reputation risk. Reputable
  commercial fallback if you'd rather not run a box: **Windscribe static IP**
  (Toronto/Montreal, WireGuard). AVOID the low-end "dedicated wireguard"
  proxy resellers that surface in search — unknown operators in a funded
  trading path is a bad trade.

On the Montreal box: install wireguard, generate a server keypair, add this
VPS as a peer, enable IP forwarding + NAT (masquerade) so our traffic egresses
on the Montreal IP. (A one-command installer like angristan/wireguard-install
does all of this; then just add our peer.)

## Step 2 — place the peer config on the classifier VPS (OWNER, out of band)
Write the WireGuard peer config to `/etc/wireguard/wg0.conf`, `root:root 600`.
Secrets NEVER go in git. The [Interface] section MUST include:

    [Interface]
    PrivateKey = <this-vps-private-key>
    Address    = <tunnel-address, e.g. 10.66.66.2/32>
    Table      = off        # CRITICAL: no default-route change; app-layer split

    [Peer]
    PublicKey  = <montreal-server-public-key>
    Endpoint   = <montreal-ip>:51820
    AllowedIPs = 0.0.0.0/0  # routing is via `curl --interface wg0`, not the table
    PersistentKeepalive = 25

`Table = off` is what keeps the classifier's own traffic untouched — the
interface exists but reroutes nothing. wireguard-montreal-setup.sh refuses to
run without it.

## Step 3 — bring it up (SESSION, only when no job is in flight)
`run-script wireguard-montreal-setup.sh` — installs wireguard-tools, brings up
wg0, verifies the wg0 exit IP is a distinct Montreal address. Then
`run-script wireguard-tunnel-check.sh` any time for health.

## Step 4 — IP-pin the key (OWNER, in the Binance account)
Restrict the Binance API key to the Montreal exit IP only. The key becomes
useless from anywhere else, including the VPS's own direct line.

## Step 5 — wire the adapter (SESSION, Phase 2)
Execution adapter sends Binance calls via `--interface wg0` (or a tiny local
SOCKS bound to wg0); watchdog runs wireguard-tunnel-check.sh before every
entry — tunnel down or wrong exit IP → halt new entries, resting stops stay.
