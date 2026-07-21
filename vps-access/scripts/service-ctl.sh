#!/usr/bin/env bash
# service-ctl.sh -- stop/start BOTH balancer services together, through the
# deploy-control run-script interface. Arg: stop | start | status (default).
#
#   {"action":"run-script","script":"service-ctl.sh","arg":"stop"}
#   {"action":"run-script","script":"service-ctl.sh","arg":"start"}
#   {"action":"run-script","script":"service-ctl.sh","arg":"status"}
#
# HARD WHITELIST: exactly the two balancer units. This script can never touch
# deploy-control (the access path) or any other unit. `stop` is temporary by
# nature — the units stay enabled, so a reboot brings them back; `start`
# resumes them any time. While stopped: no polls, no alert emails/Telegram,
# no exchange syncs, no ladder-monitor checks; missed advice is skipped, not
# queued. A running comp-lab search dies with the stop; a ⏸-paused one
# survives via its checkpoint and resumes after start.
set -euo pipefail
MODE="${1:-status}"
UNITS=(asset-balancer semi-auto-balancer)

case "$MODE" in
  stop|start)
    for u in "${UNITS[@]}"; do
      echo "== systemctl $MODE $u =="
      systemctl "$MODE" "$u" || echo "  (failed: $u)"
    done
    ;;
  status) ;;
  *)
    echo "usage: service-ctl.sh [stop|start|status]" >&2
    exit 2
    ;;
esac

echo "== state =="
for u in "${UNITS[@]}"; do
  printf '%-20s %s (enabled: %s)\n' "$u" "$(systemctl is-active "$u" || true)" "$(systemctl is-enabled "$u" 2>/dev/null || echo '?')"
done
