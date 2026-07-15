#!/usr/bin/env bash
# smoke.sh -- read-only end-to-end test of the run-script action.
# Prints identity/basics and changes nothing.
set -euo pipefail

echo "smoke: host=$(hostname -f 2>/dev/null || hostname)"
echo "smoke: date=$(date -u +%FT%TZ)"
echo "smoke: user=$(whoami)"
echo "smoke: uptime: $(uptime -p)"
echo "smoke: checkout=$(git -C /root/claude-projects log --oneline -1 2>/dev/null)"
echo "smoke: OK"
