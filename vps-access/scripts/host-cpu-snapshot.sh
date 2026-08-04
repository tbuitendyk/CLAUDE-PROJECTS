#!/usr/bin/env bash
# host-cpu-snapshot.sh -- read-only: actual CPU use right now (the healthz
# "cpuPct" is the configured throttle CEILING, not a measurement).
set -uo pipefail
echo "load average: $(cut -d' ' -f1-3 /proc/loadavg)  (cores: $(nproc))"
echo
echo "top processes by CPU:"
ps aux --sort=-%cpu | head -8
echo
echo "classifier service:"
systemctl show general-classifier -p CPUUsageNSec 2>/dev/null || true
