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
curl -s -o /dev/null -w '  /uts/construct.html -> %{http_code}\n' -k "https://127.0.0.1:4432/uts/construct.html" -H 'Host: www.buitendyk.ca'
curl -s -k "https://127.0.0.1:4432/uts/construct.html" -H 'Host: www.buitendyk.ca' | grep -o '<script src="[^"]*"' | sed 's/^/  /'
