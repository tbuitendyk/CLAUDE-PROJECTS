# Incident: intermittent severe latency/loss reaching homsionos01 (2026-08-13 → 15)

**Verdict: the VPS, IONOS, and the wider internet are healthy. The fault is in
the path from the owner's home network through Telmex transit (Telia) to IONOS.
Nothing on the server can fix it.**

## Symptom
~36 h of intermittent, minutes-scale episodes where VNC/GUI sessions to the VPS
became unusable, alternating with periods of perfect performance. Not CPU: the
box idled at load 0.01 with 14 GiB free throughout.

## Ruled out (with evidence)
- **Claude automation / deployed services** — all stopped AND disabled
  2026-08-15 ~17:54–18:00 (mail-hub cron, NAT watchdog, general-classifier,
  asset-balancer, semi-auto-balancer, youtube-dubber, deploy-control).
  Episodes continued afterwards. Interface throughput before stopping was
  0.6 kB/s rx / 20 kB/s tx — nowhere near saturation.
- **VPS reboot** (17:19) — did not help.
- **Owner's LAN** — ping to 192.168.1.254 and 192.168.2.1: 0% loss, 3–6 ms.
- **Owner's ISP generally** — ping 8.8.8.8: 0% loss, 13–16 ms (excellent).
- **The box / IONOS** — see the three-vantage test below.

## The decisive measurement (2026-08-15 ~12:45 MDT, during a live episode)
Same destination (74.208.226.14), same minutes, three sources:

| Source | Loss | RTT | Note |
|---|---|---|---|
| Owner's desk, Telmex | 42% (3/7) | 103–174 ms | VNC unusable |
| AWS mx-central-1 (78.13.103.81) | 0/100 | 62.7 ms avg, **mdev 0.172 ms** | flawless |
| Claude cloud container, US | 0% (10/10 burst, 20/20 sampled) | 56–61 ms | flawless |

Loss with FLAT latency (103/105/104/103 ms) is the signature of packets being
dropped/policed, not of congestion — congestion queues before it drops.

## Path (owner's tracert)
    1-4   192.168.1.254 → (no reply) → 192.168.1.2 → 192.168.2.1   (local, clean)
    5     201.154.156.165   44 ms    Telmex/Uninet
    6-14  62.115.x / 80.239.x  61→180 ms   TELIA transit  <-- suspect segment
    15    74.208.1.75      174 ms    IONOS edge
    18    74.208.226.14    174 ms    destination

## Workaround (also a permanent improvement)
AWS mx-central-1 → IONOS is 62.7 ms vs the owner's direct 113 ms. Using the AWS
box as a jump host both bypasses the faulty segment and roughly halves latency:

    ssh -i aws-mex-deb13-new.pem -J admin@78.13.103.81 root@74.208.226.14
    # VNC through the same jump:
    ssh -i aws-mex-deb13-new.pem -L 5901:localhost:5901 -J admin@78.13.103.81 root@74.208.226.14
    # then point the VNC client at localhost:5901

## Escalation
Ticket goes to **Telmex**, not IONOS. Include: the tracert above; paired pings
showing 8.8.8.8 at 0%/14 ms vs 74.208.226.14 at 42% loss in the same minute;
and the AWS-Mexico + US results proving the destination answers other networks
flawlessly during the episodes.
