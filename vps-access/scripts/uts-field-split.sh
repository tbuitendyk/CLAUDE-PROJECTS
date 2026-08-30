#!/usr/bin/env bash
set -uo pipefail
cd /opt/ultimate-trading-system
cp "$(dirname "$(readlink -f "$0")")/uts-field-split.js" /tmp/uts-field-split.js
node --max-old-space-size=700 /tmp/uts-field-split.js
