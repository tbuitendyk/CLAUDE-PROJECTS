#!/usr/bin/env bash
# uts-data-audit.sh -- run the adversarial suite's read-only data check against
# the data the box is REALLY holding, rather than against a stand-in.
#
# The working copy holds a handful of candle files. The box holds thousands, and
# they are the ones every number the system reports is computed from. A check
# that only ever ran against the small copy was not checking the thing that
# matters.
#
# READ ONLY, and it PROVES it rather than claiming it: the modification times of
# every file under data/ are fingerprinted before and after, and the two are
# compared. If the check wrote, moved or deleted anything, this says so.
#
# Nothing here touches the previous generation on 8093, and nothing starts a
# listener — the data check is a plain file read.
set -uo pipefail
APP=/opt/ultimate-trading-system
DATA="$APP/data"

echo "== what is being checked =="
if [ ! -d "$DATA" ]; then echo "  no data directory at $DATA"; exit 1; fi
echo "  $DATA"
echo "  $(find "$DATA" -type f | wc -l) files, $(du -sh "$DATA" 2>/dev/null | cut -f1)"

# Fingerprint: every file, its size and its modification time.
fingerprint() { find "$DATA" -type f -printf '%p %s %T@\n' 2>/dev/null | sort | md5sum | cut -d' ' -f1; }
BEFORE=$(fingerprint)
echo "  fingerprint before: $BEFORE"

echo
echo "== the read-only data check =="
cd "$APP" || exit 1
node tests/adversarial/run.js --only=attack-storeddata --data="$DATA"
RC=$?

echo
echo "== proving nothing was written =="
AFTER=$(fingerprint)
echo "  fingerprint after:  $AFTER"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  PASS  not one file under data/ changed size or modification time"
else
  echo "  FAIL  something under data/ changed — the check is not read-only after all"
  RC=1
fi

echo
echo "== the previous generation is untouched =="
if systemctl is-active --quiet general-classifier; then
  echo "  PASS  general-classifier: active"
else
  echo "  FAIL  general-classifier is not active"
  RC=1
fi

echo
if [ "$RC" -eq 0 ]; then echo "DATA AUDIT: nothing new found"; else echo "DATA AUDIT: see above (exit $RC)"; fi
exit "$RC"
