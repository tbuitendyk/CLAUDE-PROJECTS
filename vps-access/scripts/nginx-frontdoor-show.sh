#!/usr/bin/env bash
# nginx-frontdoor-show.sh -- READ-ONLY. The box's front door on :443 (the nginx
# stream block that routes by SNI) exactly as it stands, what each site behind
# it listens on, and whether nginx carries what passing the caller's real
# address needs (the stream proxy_protocol flag, the realip module). Changes
# nothing.
set -uo pipefail
echo "== nginx build: the pieces passing the real address needs =="
nginx -V 2>&1 | tr ' ' '\n' | grep -E 'realip|stream|^nginx' | head -8
echo "== the stream block in /etc/nginx/nginx.conf, as it stands =="
awk 'BEGIN{d=0;on=0} /^[[:space:]]*stream[[:space:]]*\{/{on=1} on{print NR": "$0; n=gsub(/\{/,"{"); m=gsub(/\}/,"}"); d+=n-m; if(d==0 && NR>1){exit}}' /etc/nginx/nginx.conf
echo "== the http block's include lines and any real-address settings already there =="
grep -nE 'include|set_real_ip_from|real_ip_header|proxy_protocol' /etc/nginx/nginx.conf | head -20
ls -la /etc/nginx/conf.d/ 2>/dev/null | tail -n +2 | head
echo "== every listen on 127.0.0.1:443x, by file =="
grep -rnE 'listen[[:space:]]+127\.0\.0\.1:443[0-9]' /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -20
echo "== sites-enabled =="
ls -la /etc/nginx/sites-enabled/ | tail -n +2
echo "== nginx -t =="
nginx -t 2>&1 | tail -2
echo "(read-only)"
