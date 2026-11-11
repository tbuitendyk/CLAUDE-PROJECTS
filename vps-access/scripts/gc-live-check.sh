#!/usr/bin/env bash
# gc-live-check.sh -- READ-ONLY: is the general classifier still trading, and
# what do its pilot units do? (UTS to-do 29, 2026-11-11). Reads only.
set -uo pipefail
G=/opt/general-classifier/data
for u in general-classifier pilot-sync pilot-alert pilot-tunnel live-alert; do
  echo "== $u =="; systemctl cat "$u.service" 2>/dev/null | grep -E '^(Description|ExecStart|User|WorkingDirectory)=' | cut -c1-200
done
echo "== pilot and live folders, newest first =="
ls -lt $G/pilot $G/live 2>/dev/null | head -24 | cut -c1-140
for d in $G/pilot/* $G/live/*; do [ -d "$d" ] && { echo "-- $d"; ls -lt "$d" | head -4 | cut -c1-140; }; done
echo "== words armed / halt / position / open in the pilot's small json files =="
find $G/pilot $G/live -maxdepth 2 -name '*.json' -size -8k -mmin -1440 2>/dev/null | head -12 | while read f; do
  echo "-- $f"; grep -oE '"(armed|halted|halt|mode|real|live|state|open|positions?|qty|side|status)"\s*:\s*("[^"]{0,24}"|[0-9.]+|true|false|null|\[\]|\{\})' "$f" | head -8
done
echo "== recent log of the service (last 15 lines) =="
journalctl -u general-classifier --no-pager -n 15 2>/dev/null | cut -c1-200
echo "== recent log of pilot-sync (last 6 lines) =="
journalctl -u pilot-sync --no-pager -n 6 2>/dev/null | cut -c1-200
