#!/usr/bin/env bash
# classifier-plateau-run.sh -- run the F1 plateau check (search window only).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$HERE/node/plateau.js" /tmp/plateau.js
cd /opt/general-classifier && node /tmp/plateau.js
