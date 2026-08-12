#!/usr/bin/env bash
# hub-queues.sh -- READ-ONLY, one line per registered container: queued count,
# oldest message age, pending notices. The hub session's dispatch loop calls
# this every tick to decide whether to fetch-and-dispatch. Cheap by design.
set -uo pipefail
shopt -s nullglob
HUB=/var/lib/claude-mail/hub
now=$(date +%s)
for r in $(ls "$HUB/registry" 2>/dev/null); do
  n=0; oldest=0
  for f in "$HUB/inbox/$r"/*.txt; do
    n=$((n+1)); a=$(( now - $(stat -c %Y "$f") )); [ "$a" -gt "$oldest" ] && oldest=$a
  done
  nn=$(ls "$HUB/notice/$r" 2>/dev/null | wc -l)
  echo "QUEUE $r queued=$n oldest=${oldest}s notices=$nn"
done
