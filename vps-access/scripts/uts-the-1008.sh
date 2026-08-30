#!/usr/bin/env bash
# uts-the-1008.sh -- READ-ONLY wrapper. See uts-the-1008.js beside it.
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-the-1008.js" /tmp/uts-the-1008.js
node --max-old-space-size=1200 /tmp/uts-the-1008.js
