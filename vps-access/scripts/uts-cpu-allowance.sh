#!/usr/bin/env bash
# READ-ONLY. What share of the machine the trading service is allowed, and what
# the sweep worker count is set to. Changes nothing.
set -uo pipefail
echo "== the quota drop-in =="
cat /etc/systemd/system.control/ultimate-trading-system.service.d/50-CPUQuota.conf 2>/dev/null || echo "(no drop-in)"
systemctl show ultimate-trading-system -p CPUQuotaPerSecUSec -p CPUAccounting 2>/dev/null
echo
echo "== what the screens' workers/share are set to =="
curl -s --max-time 8 http://127.0.0.1:8094/api/compute-config | head -c 400; echo
echo
echo "== the same for the run that took 12.63 hours, for comparison =="
nproc
