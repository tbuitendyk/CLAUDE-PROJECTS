#!/usr/bin/env bash
# uts-field-cells.sh -- READ-ONLY. A stage 3 set priced under the field's gate
# beside its control, cell by cell: every gate value summed over the units it
# priced, held against the control's one setting on the same units. Reads the
# record stores; writes nothing, starts nothing.
#   arg: <fieldSetId>+<controlId>
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-field-cells.js" /tmp/uts-field-cells.js
node --max-old-space-size=600 /tmp/uts-field-cells.js "${1:-}"
