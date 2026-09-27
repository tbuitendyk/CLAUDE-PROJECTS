#!/usr/bin/env bash
# nginx-frontdoor-apply.sh -- CHANGES THE BOX'S WEB SERVER (owner's GO NOW!,
# 2026-09-27). The front door on :443 (the stream block in /etc/nginx/nginx.conf)
# hands each site the bare connection, so every site sees every caller as
# 127.0.0.1 -- the trading platforms included, which is why the Compute tab
# cannot say where a platform calls from. This has the front door send the
# caller's real address ahead of each connection (the PROXY protocol), has the
# four sites read it, and leaves the mail server's machine exactly as it was,
# through a hop that takes the address off again:
#
#   stream  proxy_protocol on;              after ssl_preread on;
#           default 127.0.0.1:4450;         was 192.168.56.129:443
#           server { listen 127.0.0.1:4450 proxy_protocol; proxy_pass 192.168.56.129:443; }
#   sites   " proxy_protocol" on each `listen 127.0.0.1:443N ...;` line, with a
#           comment saying why: www.buitendyk.ca.conf (two), kjv-mcp,
#           docs.homeandofficemicro.com.conf, deploy.buitendyk.ca.conf
#   http    /etc/nginx/conf.d/real-client-ip.conf:
#           set_real_ip_from 127.0.0.1; real_ip_header proxy_protocol;
#
# Roll-back is ready before anything is touched:
#   - every file goes to /root/nginx-frontdoor-backup/<stamp>/ with a restore.sh
#     beside it, and /root/nginx-frontdoor-backup/latest points at it;
#   - a timer runs that restore.sh in 15 minutes unless nginx-frontdoor-confirm.sh
#     stops it, so a change that cut off the deploy door -- which sits behind
#     this same front door -- undoes itself;
#   - nginx -t gates the reload, and every site is asked for its front page
#     through the front door before and after: any site answering differently
#     afterwards puts everything back at once.
# nginx-frontdoor-restore.sh puts the latest backup back at any later time.
# Refuses, changing nothing, unless every file is exactly in the shape expected.
set -uo pipefail
NGX=/etc/nginx/nginx.conf
SA=/etc/nginx/sites-available
SITES="www.buitendyk.ca.conf:2 docs.homeandofficemicro.com.conf:1 kjv-mcp:1 deploy.buitendyk.ca.conf:1"
REALIP=/etc/nginx/conf.d/real-client-ip.conf
HOP=127.0.0.1:4450
MAILVM=192.168.56.129:443
ROOT=/root/nginx-frontdoor-backup
UNIT=nginx-frontdoor-deadman
HOSTS="kjv.buitendyk.ca vp.buitendyk.ca bible.buitendyk.ca docs.homeandofficemicro.com buitendyk.ca www.buitendyk.ca deploy.buitendyk.ca mail.homeandofficemicro.com"
# a site's loopback listen line; the edit is the same one the branches' copies get
LISTEN='^[[:space:]]*listen[[:space:]]+127\.0\.0\.1:443[0-3][[:space:]][^;#]*;'
EDIT="/$LISTEN/ s/;/ proxy_protocol;  # the :443 front door sends the real client address first/"

probe() {  # each site's front page through the front door, from this box
  local h c rc
  for h in $HOSTS; do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$h:443:127.0.0.1" "https://$h/"); rc=$?
    echo "$h $c/$rc"
  done
}
WORK=$(mktemp -d)
refuse() { echo "REFUSED, nothing changed: $*"; rm -rf "$WORK"; exit 1; }
short() { sha256sum "$1" | cut -c1-16; }

echo "== already done? =="
if grep -q proxy_protocol "$NGX" || [ -e "$REALIP" ]; then
  echo "the front door already sends the address (or $REALIP exists) -- nothing to do"
  grep -nE 'proxy_protocol|4450' "$NGX"; rm -rf "$WORK"; exit 0
fi
echo "not yet"

echo "== checks, before anything is touched =="
nginx -t >/dev/null 2>&1 || refuse "nginx -t fails as things stand"
ss -ltn | awk '{print $4}' | grep -qE ':4450$' && refuse "something already listens on port 4450"
HOPBLOCK="    # The mail server's machine is not told the caller's address: this hop
    # takes the PROXY header off again and passes the connection on as before.
    server {
        listen $HOP proxy_protocol;
        proxy_pass $MAILVM;
        proxy_connect_timeout 5s;
        proxy_timeout 300s;
    }"
HOPBLOCK="$HOPBLOCK" HOP="$HOP" awk '
  /^[[:space:]]*stream[[:space:]]*\{/ { s = 1 }
  s && /^[[:space:]]*ssl_preread[[:space:]]+on;/ { print; print "        proxy_protocol on;"; a++; next }
  s && /^[[:space:]]*default[[:space:]]+192\.168\.56\.129:443;/ { sub(/192\.168\.56\.129:443/, ENVIRON["HOP"]); b++ }
  s && !h && /^[[:space:]]*server[[:space:]]*\{/ { print ENVIRON["HOPBLOCK"]; h = 1 }
  { print }
  END { exit (s == 1 && a == 1 && b == 1 && h == 1) ? 0 : 3 }
' "$NGX" > "$WORK/nginx.conf" || refuse "the stream block is not in the shape expected (one ssl_preread on;, one default $MAILVM;)"
added=$(diff "$NGX" "$WORK/nginx.conf" | grep -c '^>'); gone=$(diff "$NGX" "$WORK/nginx.conf" | grep -c '^<')
[ "$added" = 10 ] && [ "$gone" = 1 ] || refuse "the stream edit came out $added lines in, $gone out (expected 10 and 1)"
echo "nginx.conf $(short "$NGX"): stream edit ready"
for spec in $SITES; do
  n="${spec%:*}"; f="$SA/$n"; want="${spec##*:}"
  [ -f "$f" ] && [ ! -L "$f" ] || refuse "$f is not a plain file"
  got=$(grep -cE "$LISTEN" "$f")
  [ "$got" = "$want" ] || refuse "$f has $got loopback listen lines, expected $want"
  grep -E "$LISTEN" "$f" | grep -q proxy_protocol && refuse "$f already carries proxy_protocol"
  sed -E "$EDIT" "$f" > "$WORK/$n"
  m=$(diff "$f" "$WORK/$n" | grep -c '^>')
  [ "$m" = "$want" ] || refuse "$f: the edit touched $m lines, expected $want"
  echo "$n $(short "$f"): $want listen line(s) ready"
done
cat > "$WORK/real-client-ip.conf" <<'EOF'
# The front door on :443 (the stream block in /etc/nginx/nginx.conf) sends each
# caller's address ahead of the connection (PROXY protocol), and each site's
# `listen 127.0.0.1:443N ... proxy_protocol` line accepts it. This makes it the
# address every site sees as $remote_addr: what it logs, rate-limits by and
# passes on as X-Real-IP. Only the front door itself (127.0.0.1) is believed.
set_real_ip_from 127.0.0.1;
real_ip_header proxy_protocol;
EOF
if command -v fail2ban-client >/dev/null 2>&1; then echo "fail2ban: $(fail2ban-client status 2>/dev/null | tail -1)"; else echo "fail2ban: not installed"; fi

echo "== every site's front page through the front door, before =="
BEFORE=$(probe); echo "$BEFORE"

STAMP=$(date -u +%Y%m%dT%H%M%SZ); BK="$ROOT/$STAMP"
FILES="$NGX"; for spec in $SITES; do FILES="$FILES $SA/${spec%:*}"; done
mkdir -p "$BK" && cp -a --parents $FILES "$BK/" || refuse "the backup failed"
{
  echo '#!/usr/bin/env bash'
  echo "# Puts the web server back exactly as it was before nginx-frontdoor-apply.sh ran at $STAMP."
  for f in $FILES; do echo "cp -a '$BK$f' '$f'"; done
  echo "rm -f '$REALIP'"
  echo 'if ! nginx -t 2>/dev/null; then echo "THE RESTORED FILES FAIL nginx -t"; nginx -t; exit 1; fi'
  echo 'if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi && echo "restored and reloaded"'
} > "$BK/restore.sh"
chmod 700 "$BK/restore.sh"
ln -sfn "$BK" "$ROOT/latest"
systemctl stop "$UNIT.timer" >/dev/null 2>&1; systemctl reset-failed "$UNIT.service" "$UNIT.timer" >/dev/null 2>&1
systemd-run --quiet --unit="$UNIT" --on-active=15min --timer-property=AccuracySec=1s /bin/bash "$BK/restore.sh" \
  || refuse "could not arm the 15-minute roll-back timer"
echo "== backed up to $BK; roll-back timer armed =="
systemctl list-timers --no-legend "$UNIT.timer" | cut -c1-70

put_back() {
  echo "== PUTTING EVERYTHING BACK: $* =="
  bash "$BK/restore.sh"; systemctl stop "$UNIT.timer" >/dev/null 2>&1
  echo "== after the roll-back =="; probe; rm -rf "$WORK"; exit 1
}
cat "$WORK/nginx.conf" > "$NGX" || put_back "could not write $NGX"
for spec in $SITES; do cat "$WORK/${spec%:*}" > "$SA/${spec%:*}" || put_back "could not write ${spec%:*}"; done
{ cat "$WORK/real-client-ip.conf" > "$REALIP" && chmod 644 "$REALIP"; } || put_back "could not write $REALIP"
echo "== nginx -t =="
out=$(nginx -t 2>&1); rc=$?; echo "$out" | tail -2
[ "$rc" = 0 ] || put_back "nginx -t failed"
systemctl reload nginx || put_back "the reload failed"
sleep 2
systemctl is-active --quiet nginx || put_back "nginx is not running after the reload"
echo "== every site's front page through the front door, after =="
AFTER=$(probe); echo "$AFTER"
[ "$BEFORE" = "$AFTER" ] || put_back "a site answers differently than before"

echo "== the change =="
diff "$BK$NGX" "$NGX"
for spec in $SITES; do echo "${spec%:*} $(short "$SA/${spec%:*}")"; diff "$BK$SA/${spec%:*}" "$SA/${spec%:*}" | grep '^>'; done

echo "== does a site now see a caller's real address? =="
PUB=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
MARK="frontdoor-check-$STAMP"
curl -s -o /dev/null --max-time 10 --resolve "www.buitendyk.ca:443:$PUB" "https://www.buitendyk.ca/$MARK" || true
sleep 1
SEEN=$(grep -h "$MARK" /var/log/nginx/*.log 2>/dev/null | tail -1 | awk '{print $1}')
echo "a call from this box's own public address ($PUB) was logged by the www site as from: ${SEEN:-nothing logged}"
[ "$SEEN" = "$PUB" ] && echo "the real address arrives" || echo "THE ADDRESS IS NOT ARRIVING -- the sites answer, but see the note above"

echo "== done. The roll-back timer is still armed: run nginx-frontdoor-confirm.sh once the sites answer from outside =="
rm -rf "$WORK"
