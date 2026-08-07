#!/usr/bin/env bash
# classifier-trainextent-read.sh -- READ-ONLY: progress/result of the detached
# training-extent stability test.
set -uo pipefail
if [ -f /tmp/trainextent.done ]; then echo "STATUS: finished"; else echo "STATUS: still running"; fi
echo "---"
cat /tmp/trainextent.out 2>/dev/null || echo "(no output yet)"
