#!/usr/bin/env bash
# hub-queues.sh -- READ-ONLY, one line per registered container: queued count,
# oldest message age, pending notices. The hub session's dispatch loop calls
# this every tick to decide whether to fetch-and-dispatch. Cheap by design.
set -uo pipefail
shopt -s nullglob
HUB=/var/lib/claude-mail/hub
now=$(date +%s)
# cadence hint so a dispatcher tick needs only this one call
li=$(cat /var/lib/claude-mail/last-sent 2>/dev/null || echo 0)
case "$li" in (*[!0-9]*|"") li=0;; esac
if [ $((now - li)) -lt 1200 ]; then
  echo "NEXT-POLL 60  (fast window)"
else
  min=$((10#$(date +%M))); sec=$((10#$(date +%S)))
  echo "NEXT-POLL $(( (15 - min % 15) * 60 - sec + 60 ))  (phase-locked)"
fi
for r in $(ls "$HUB/registry" 2>/dev/null); do
  n=0; oldest=0
  for f in "$HUB/inbox/$r"/*.txt; do
    n=$((n+1)); a=$(( now - $(stat -c %Y "$f") )); [ "$a" -gt "$oldest" ] && oldest=$a
  done
  nn=$(ls "$HUB/notice/$r" 2>/dev/null | wc -l)
  echo "QUEUE $r queued=$n oldest=${oldest}s notices=$nn"
done
