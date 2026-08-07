#!/usr/bin/env bash
# classifier-trainextent-fire.sh -- launch the declared training-extent
# stability test DETACHED (24 trainings overrun the request window).
# The program lives in scripts/node/trainextent.js so no shell quoting can
# mangle it — the first attempt did exactly that and finished silently.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -f /tmp/trainextent.out /tmp/trainextent.done
cp "$HERE/node/trainextent.js" /tmp/trainextent.js
nohup bash -c 'cd /opt/general-classifier && node /tmp/trainextent.js > /tmp/trainextent.out 2>&1; touch /tmp/trainextent.done' >/dev/null 2>&1 &
sleep 2
echo "fired. first bytes of output:"
head -c 300 /tmp/trainextent.out 2>/dev/null || echo "(none yet)"
