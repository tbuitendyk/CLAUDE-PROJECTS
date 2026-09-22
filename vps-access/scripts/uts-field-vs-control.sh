#!/usr/bin/env bash
# uts-field-vs-control.sh -- READ-ONLY. A stage 3 set priced under a field
# beside its control from the same parent and block, read per unit and paired
# setting by setting. Reads the record stores; writes nothing, starts nothing.
#   arg: <fieldSetId>+<controlId>[+units1|+units2]
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-field-vs-control.js" /tmp/uts-field-vs-control.js
node --max-old-space-size=1200 /tmp/uts-field-vs-control.js "${1:-}"
