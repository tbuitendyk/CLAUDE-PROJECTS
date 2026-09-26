#!/usr/bin/env bash
# uts-boot-log.sh -- READ-ONLY. The service's own log since it last started: the
# lines its start-up writes about bringing record sets forward, and anything that
# says error or could not. Nothing written.
set -uo pipefail
SINCE=$(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value)
echo "service up since: $SINCE"
sudo journalctl -u ultimate-trading-system --since "$SINCE" --no-pager -o short-iso 2>/dev/null \
  | grep -iE "record sets|walk sets|saved screen|listening|could not|could NOT|error|refus" | cut -c1-900 | tail -30
echo "== last 8 lines"
sudo journalctl -u ultimate-trading-system --since "$SINCE" --no-pager -o short-iso 2>/dev/null | tail -8 | cut -c1-400
