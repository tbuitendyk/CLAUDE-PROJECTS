#!/usr/bin/env bash
# live-parity-result.sh -- READ the detached parity run's report (see
# live-parity-check.sh). Prints the whole report; the final EXIT= line is the
# verdict (0=parity proven, 1=DIVERGENCE — stop the release, 2=could not run).
set -uo pipefail
REPORT=/opt/general-classifier/data/parity-report.txt
if [ ! -s "$REPORT" ]; then
  if pgrep -f "node live-parity.js" >/dev/null 2>&1; then
    echo "parity run in progress; report not written yet"
  else
    echo "no parity report present — start one with live-parity-check.sh"
  fi
  exit 0
fi
cat "$REPORT"
if ! grep -q '^EXIT=' "$REPORT"; then
  echo "(run still in progress — EXIT line not written yet)"
fi
