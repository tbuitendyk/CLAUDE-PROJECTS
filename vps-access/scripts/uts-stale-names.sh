#!/usr/bin/env bash
# uts-stale-names.sh -- READ-ONLY wrapper. See uts-stale-names.js beside it.
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-stale-names.js" /tmp/uts-stale-names.js
node --max-old-space-size=900 /tmp/uts-stale-names.js
