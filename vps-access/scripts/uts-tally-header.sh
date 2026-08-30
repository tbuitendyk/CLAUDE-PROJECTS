#!/usr/bin/env bash
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-tally-header.js" /tmp/uts-tally-header.js
node --max-old-space-size=400 /tmp/uts-tally-header.js
