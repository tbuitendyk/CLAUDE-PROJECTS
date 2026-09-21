#!/usr/bin/env bash
# uts-s1-filters.sh -- READ-ONLY. What a stage 1 or 2 set's table is cut down
# to by the filters saved on it, and how beat its own null set and beat its
# own null set -- tuning-slice $ are spread over all rows and over the rows
# that pass. Reads the set document and the record store; writes nothing.
#   arg: <setId>
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-s1-filters.js" /tmp/uts-s1-filters.js
node --max-old-space-size=600 /tmp/uts-s1-filters.js "${1:-}"
