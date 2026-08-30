#!/usr/bin/env bash
# uts-state-of-the-data.sh -- READ-ONLY wrapper. See the .js beside it.
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-state-of-the-data.js" /tmp/uts-state-of-the-data.js
node --max-old-space-size=700 /tmp/uts-state-of-the-data.js
