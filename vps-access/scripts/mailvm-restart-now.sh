#!/usr/bin/env bash
# mailvm-restart-now.sh -- run the daily restart immediately, out of schedule.
# Same code path the timer uses, so a manual run is also a test of the timer's
# job. Blocks until the guest is back (or the script gives up) and prints the
# tail of the log.
set -uo pipefail
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mailvm-restart.sh"
rc=$?
echo
echo "== exit code: $rc =="
echo "== last 25 log lines =="
tail -25 /var/log/mailvm-restart.log 2>/dev/null || echo "(no log yet)"
exit $rc
