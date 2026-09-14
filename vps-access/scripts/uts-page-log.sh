#!/usr/bin/env bash
# uts-page-log.sh -- READ-ONLY. The web server's own record of what the trading
# system's screens asked for: page loads (construct.html and its script) and the
# presses that start a rebuild of the test history numbers, with their times
# and answers. So "was the page reloaded after the deploy before the press" is
# read off the log rather than guessed.
#   usage: uts-page-log.sh [how many lines back to read, default 4000]
set -uo pipefail
N="${1:-4000}"
LOG=/var/log/nginx/www.buitendyk.ca.access.log
[ -r "$LOG" ] || { echo "cannot read $LOG"; exit 1; }
echo "== page loads and rebuild presses under /uts/, oldest first (last $N lines of the log) =="
tail -n "$N" "$LOG" | grep -E '/uts/(construct\.html|construct\.js|setup\.html|trade\.html|api/funnel/[^/ ]+/rebuild|api/funnel/[^/ ]+/read)' \
  | sed -E 's/^([0-9.]+) [^ ]+ [^ ]+ \[([^]]+)\] "([A-Z]+) ([^ ]+)[^"]*" ([0-9]+) [0-9-]+ "[^"]*" "([^"]*)"/\2  \3 \5  \4   ua=\6/' \
  | grep -vE 'GET [0-9]+  /uts/api/funnel/[^/ ]+/rebuild' \
  | sed -E 's/ua=(Mozilla[^ ]*)[^ ]* [^ ]* [^ ]* \(([^;)]*)[^)]*\).*/ua=\1 (\2)/' | tail -120
