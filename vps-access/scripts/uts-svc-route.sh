#!/usr/bin/env bash
# READ-ONLY. Where does /uts/svc/ go, and is the reporting program the same one
# it went to yesterday? Changes nothing.
set -uo pipefail
echo "== nginx locations under /uts =="
grep -rn 'location .*uts' /etc/nginx/ 2>/dev/null | head -12
echo
echo "== what each proxies to =="
awk '/location .*uts/{f=1} f{print} /}/{if(f)c++; if(c>0&&f){f=0;c=0;print "---"}}' /etc/nginx/sites-enabled/* 2>/dev/null | head -50
echo
echo "== nginx config valid? =="
nginx -t 2>&1 | tail -3
echo
echo "== how long each service has been up =="
for u in uts-service-control ultimate-trading-system general-classifier; do
  printf '%-28s %s  since %s\n' "$u" "$(systemctl is-active $u 2>/dev/null)" "$(systemctl show -p ActiveEnterTimestamp --value $u 2>/dev/null)"
done
