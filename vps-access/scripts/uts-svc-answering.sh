#!/usr/bin/env bash
# READ-ONLY. Is the reporting program that feeds the Compute tab's machine
# tiles and service cards alive, and does it answer? Changes nothing.
set -uo pipefail
echo "== the unit =="
systemctl is-active uts-service-control 2>/dev/null || echo "(uts-service-control: not a unit by that name)"
systemctl --no-pager --plain list-units --all 2>/dev/null | grep -i 'service-control\|uts-svc' | head -5
echo
echo "== what it is listening on, if anything =="
ss -ltnp 2>/dev/null | grep -E '809[0-9]|8100' | head -8
echo
echo "== asking it directly =="
for port in 8095 8096 8093 8092; do
  code=$(curl -s -o /tmp/svcbody -w '%{http_code}' --max-time 6 "http://127.0.0.1:$port/api/compute" 2>/dev/null)
  echo "port $port -> HTTP ${code:-no answer}"
  [ "$code" = "200" ] && head -c 200 /tmp/svcbody && echo
done
echo
echo "== through the front door, the way the browser asks =="
code=$(curl -s -o /tmp/svcbody2 -w '%{http_code}' --max-time 8 "https://www.buitendyk.ca/uts/svc/api/compute" 2>/dev/null)
echo "svc/api/compute -> HTTP ${code:-no answer}"
head -c 300 /tmp/svcbody2 2>/dev/null; echo
echo
echo "== recent complaints =="
journalctl -u uts-service-control -n 12 --no-pager 2>/dev/null | tail -12 || echo "(no journal for that unit)"
