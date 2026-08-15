# Incident: intermittent severe latency/loss reaching homsionos01 (2026-08-13 → 15)

**Verdict: the VPS, IONOS, and the wider internet are healthy. The fault is in
TELMEX'S INTERNATIONAL EGRESS generally — not one route. Nothing on the server
can fix it. RESOLVED for the owner by tunnelling out via a real (non-Smart-
Routing) Proton VPN server in Mexico City.**

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

## Later tests that BROADENED the diagnosis (same day)
- **Proton VPN exit in VANCOUVER: still lossy.** A completely different
  destination on a different network, still impaired. This RULES OUT "the
  Telia->IONOS route is bad" as the sole cause: the fault is Telmex's
  international egress in general. (Consistent with 8.8.8.8 being clean —
  Google peers with Telmex *inside* Mexico, so it never crosses the boundary.)
- **Proton VPN exit in MEXICO CITY (real server 134.82.72.81, NOT "Smart
  Routing"): clean and FIXED IT.** Tunnel leg 44-47 ms, 0/20 loss, 3 ms spread;
  the owner's VNC became fully usable again. Same principle as the AWS-Mexico
  result: reach a well-connected PoP over a short domestic hop, then ride that
  provider's international backbone instead of Telmex's.
- **TRAP:** VPN "Mexico" servers are often *virtual* (Proton labels this "Smart
  Routing") and physically sit in the USA — those cross the same broken
  boundary and do NOT help. Verify with ping: ~5-45 ms = really in Mexico;
  60 ms+ = offshore, useless for this.

## HARD EVIDENCE from the owner's own link (2026-08-15 12:53-13:23 MDT)
30 min of continuous pings from the owner's PC to three targets, through three
egress configurations. (Loss reconstructed from inter-sample timing: a timeout
blocks ~5 s, a success returns instantly. Contrast is stark enough that no
plausible threshold changes the result.)

| window (MDT) | 8.8.8.8 | IONOS edge 74.208.1.75 | THE BOX 74.208.226.14 | egress |
|---|---|---|---|---|
| 12:53-12:58 | 0% | 15.2% | 8.7%  | direct Telmex |
| 12:58-13:03 | 0% | 25.0% | 37.1% | direct Telmex |
| 13:03-13:08 | 0% | 16.7% | **43.2%** | Proton VANCOUVER |
| 13:08-13:13 | 0% | 15.6% | 13.3% | Proton Vancouver |
| 13:13-13:18 | 0% | **0.0%** | **0.0%** | Proton MEXICO CITY |
| 13:18-13:23 | 0% | **0.0%** | **0.0%** | Proton Mexico City |

Totals: 8.8.8.8 = **0 lost / 271**. IONOS edge = 29/272 (10.7%).
The box = 39/272 (14.3%).

THE THREE CONCLUSIONS:
1. 8.8.8.8 perfect throughout every configuration -> the owner's LAN, router and
   Telmex's DOMESTIC network are not at fault.
2. The Vancouver exit was the WORST bucket (43.2%) -> the fault is not the route
   to IONOS specifically; it is Telmex's international egress generally.
3. The Mexico City exit is a clean binary switch: 109 consecutive pings to both
   IONOS targets with ZERO loss, from the minute it was enabled.

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
