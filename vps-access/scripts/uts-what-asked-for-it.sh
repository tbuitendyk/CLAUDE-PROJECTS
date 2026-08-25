#!/usr/bin/env bash
# uts-what-is-asking.sh -- READ-ONLY. What has been requested from the trading
# system recently, in order, with how long each took. The main thread is pinned
# at 99% and doing one thing; this says what was asked for just before that
# started. Changes nothing.
set -uo pipefail
L=/var/log/nginx/www.buitendyk.ca.access.log

echo "== the last 30 things asked of /uts/ =="
if [ -r "$L" ]; then
  grep -F ' /uts/' "$L" 2>/dev/null | tail -30 \
    | sed -E 's/^([0-9.]+) - [^ ]+ \[([^]]+)\] "([A-Z]+) ([^ ?]+)[^"]*" ([0-9]+) ([0-9-]+).*/  \2  \5  \3 \4/' \
    | cut -c1-140
else
  echo "  cannot read $L"
fi

echo
echo "== anything asking for the replication table (the ten-minute one) =="
if [ -r "$L" ]; then
  N=$(grep -cF 'replication' "$L" 2>/dev/null || echo 0)
  echo "  $N request(s) for it in this log"
  grep -F 'replication' "$L" 2>/dev/null | tail -8 \
    | sed -E 's/^([0-9.]+) - [^ ]+ \[([^]]+)\] "([A-Z]+) ([^ ?]+)[^"]*" ([0-9]+) .*/  \2  \5  \4/' | cut -c1-150
else
  echo "  cannot read the log"
fi

echo
echo "== which version of the page the browser is running =="
echo "  (the script address carries a hash of the file, so a browser still on"
echo "   the old one asks for a different address than a reloaded browser)"
if [ -r "$L" ]; then
  grep -oE 'construct\.js\?v=[a-z0-9]+' "$L" 2>/dev/null | sort | uniq -c | tail -5 | sed 's/^/  /'
  echo "  what the box serves now: $(grep -oE 'construct\.js\?v=[a-z0-9]+' /dev/null 2>/dev/null || true)"
  node -e 'const c=require("crypto"),f=require("fs");console.log("  the current file hashes to: construct.js?v="+c.createHash("sha1").update(f.readFileSync("/opt/ultimate-trading-system/public/construct.js")).digest("hex").slice(0,12))'
fi

echo
echo "== open connections to the trading service =="
ss -tnp 2>/dev/null | grep -c ':8094' | sed 's/^/  /'
ss -tnp 2>/dev/null | grep ':8094' | head -8 | cut -c1-120 | sed 's/^/  /'
