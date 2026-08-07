#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$HERE/node/plateau-strong.js" /tmp/plateau-strong.js
cd /opt/general-classifier && node /tmp/plateau-strong.js
