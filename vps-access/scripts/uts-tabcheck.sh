#!/usr/bin/env bash
# uts-tabcheck.sh -- read-only. Exactly what the box is serving for the tab
# strip, and in what order, so "where is my tab" can be answered from the thing
# the browser actually receives rather than from the repository.
set -uo pipefail
echo "== the sub-tabs, in the order the browser gets them =="
curl -s http://127.0.0.1:8094/construct.js \
  | grep -o "const TABS = \[[^]]*\]" | head -1
echo
echo "== how the strip is built =="
curl -s http://127.0.0.1:8094/construct.js | grep -n "tabs').innerHTML" | head -2
echo
echo "== what construct.html tells the browser to fetch =="
curl -s http://127.0.0.1:8094/construct.html | grep -o '<script src="[^"]*"'
echo
echo "== and through nginx, the way the owner reaches it =="
# through the :443 front door, never the site's own port 4432: that port takes
# only connections the front door has put the caller's address in front of
curl -s -o /dev/null -w '  /uts/construct.html -> %{http_code}\n' -k --resolve www.buitendyk.ca:443:127.0.0.1 "https://www.buitendyk.ca/uts/construct.html"
curl -s -k --resolve www.buitendyk.ca:443:127.0.0.1 "https://www.buitendyk.ca/uts/construct.html" | grep -o '<script src="[^"]*"' | sed 's/^/  /'
