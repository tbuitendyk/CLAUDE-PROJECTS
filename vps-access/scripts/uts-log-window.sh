#!/usr/bin/env bash
# uts-log-window.sh -- READ-ONLY. The service's journal from 03:20 to 03:50
# UTC today, and every set document and capture file touched in that window.
set -uo pipefail
echo "== journal 03:20-03:50 UTC"
sudo journalctl -u ultimate-trading-system --since "$(date -u +%F) 03:20:00" --until "$(date -u +%F) 03:50:00" --no-pager -o short-iso 2>/dev/null | tail -60
echo "== files under data/stagesets changed 03:20-03:50 UTC"
D=/opt/ultimate-trading-system/data/stagesets
sudo find $D -maxdepth 1 -newermt "$(date -u +%F) 03:20:00" ! -newermt "$(date -u +%F) 03:50:00" -printf '%TT %s %f\n' 2>/dev/null | sort | tail -40
echo "== the two sets' documents, last written"
for id in s4-mufzcga2-32 s4-mugeujd8-36; do sudo stat -c '%y %n' $D/$id.json; done
