#!/usr/bin/env bash
# cert-acme-setup.sh -- CHANGES NGINX CONFIG. Signed off in-session.
#
# Why this works without touching port 80 or the mail VM:
#   Public :80 is owned by VBoxNetNAT and forwarded into the mail guest, so the
#   host can never answer HTTP-01 directly. But the guest 301s the challenge
#   preserving host and path:
#       http://www.buitendyk.ca/.well-known/acme-challenge/T
#         -> 301 https://www.buitendyk.ca/.well-known/acme-challenge/T
#   which comes back to the public :443, through the SNI stream proxy, into the
#   host's own vhost. Let's Encrypt follows up to 10 redirects and does NOT
#   validate certificates along the way, so the expired certs don't block it.
#   Serving the challenge from the host's :443 vhosts is therefore sufficient.
#
# What this changes (all reversible):
#   1. creates /var/www/letsencrypt/.well-known/acme-challenge
#   2. writes /etc/nginx/snippets/acme-challenge.conf
#   3. includes that snippet in each host vhost (after every server_name line)
#   4. removes the duplicate sites-enabled symlink
#      www.buitendyk.ca.conf.before-svc.20260824-232951 -> the SAME file as
#      www.buitendyk.ca.conf, which makes nginx load it twice (the source of
#      the "conflicting server name on 127.0.0.1:4432" warnings)
#   5. nginx -t, then reload only if the test passes; restores and re-tests on
#      failure so a bad edit cannot leave nginx unable to start
#   6. verifies end-to-end over the REAL public URL and exits non-zero unless
#      every hostname returns 200
#
# It does NOT touch renewal confs and does NOT request any certificate.
# Backups go to /root/cert-fix-backup/, deliberately NOT into sites-enabled --
# nginx loads every file in that directory regardless of extension, which is
# what created the duplicate in the first place.
set -euo pipefail

WEBROOT=/var/www/letsencrypt
SNIP=/etc/nginx/snippets/acme-challenge.conf
STAMP=$(date +%Y%m%d-%H%M%S)
BK=/root/cert-fix-backup/$STAMP
DUP=/etc/nginx/sites-enabled/www.buitendyk.ca.conf.before-svc.20260824-232951
FILES=(
  /etc/nginx/sites-available/www.buitendyk.ca.conf
  /etc/nginx/sites-available/docs.homeandofficemicro.com.conf
  /etc/nginx/sites-available/kjv-mcp
  /etc/nginx/sites-available/deploy.buitendyk.ca.conf
)
HOSTS=(www.buitendyk.ca buitendyk.ca kjv.buitendyk.ca bible.buitendyk.ca
       vp.buitendyk.ca docs.homeandofficemicro.com deploy.buitendyk.ca)

echo "== 1. webroot =="
install -d -m 755 "$WEBROOT/.well-known/acme-challenge"
chown -R www-data:www-data "$WEBROOT" 2>/dev/null || true
printf 'acme-ok\n' > "$WEBROOT/.well-known/acme-challenge/probe"
chmod 644 "$WEBROOT/.well-known/acme-challenge/probe"
echo "   $WEBROOT ready"

echo "== 2. snippet =="
install -d -m 755 /etc/nginx/snippets
cat > "$SNIP" <<'EOF'
# Serve the ACME HTTP-01 challenge. Included in every host vhost.
# `^~` so this outranks any regex location (e.g. a `location ~ /\.` deny).
# `auth_basic off` is what lets docs.homeandofficemicro.com renew at all --
# it has server-level Basic Auth that otherwise 401s the challenge.
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    allow all;
    default_type "text/plain";
    root /var/www/letsencrypt;
    try_files $uri =404;
    access_log off;
}
EOF
echo "   wrote $SNIP"

echo "== 3. back up and include =="
mkdir -p "$BK"
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "   MISSING $f -- skipped"; continue; }
  cp -a "$f" "$BK/$(basename "$f")"
  if grep -q "acme-challenge.conf" "$f"; then
    echo "   $(basename "$f"): already included"
  else
    # after every `server_name ...;` line, matching its indentation
    awk '{ print; if ($1=="server_name") { match($0,/^[[:space:]]*/)
             printf "%sinclude /etc/nginx/snippets/acme-challenge.conf;\n", substr($0,1,RLENGTH) } }' \
        "$f" > "$f.new"
    mv "$f.new" "$f"
    echo "   $(basename "$f"): added $(grep -c 'acme-challenge.conf' "$f") include(s)"
  fi
done
echo "   backups in $BK"

echo "== 4. duplicate symlink =="
if [ -L "$DUP" ]; then
  ls -l "$DUP" > "$BK/removed-symlink.txt"
  rm -f "$DUP"
  echo "   removed $(basename "$DUP")"
else
  echo "   not present (already clean)"
fi

echo "== 5. nginx -t =="
if nginx -t 2>&1 | tail -3; then
  systemctl reload nginx
  echo "   reloaded"
else
  echo "   !! nginx -t FAILED -- restoring backups"
  for f in "${FILES[@]}"; do
    [ -f "$BK/$(basename "$f")" ] && cp -a "$BK/$(basename "$f")" "$f"
  done
  nginx -t 2>&1 | tail -3
  echo "   restored; nginx NOT reloaded"
  exit 1
fi

echo "== 6. end-to-end probe over the real public URL =="
# -k because the certs are expired; LE ignores certs on redirect too, so this
# mirrors what the validator actually does. -L to follow guest:80 -> host:443.
fail=0
for h in "${HOSTS[@]}"; do
  code=$(curl -skL -o /dev/null -w '%{http_code}' --max-time 25 \
          "http://$h/.well-known/acme-challenge/probe" 2>/dev/null || echo 000)
  body=$(curl -skL --max-time 25 "http://$h/.well-known/acme-challenge/probe" 2>/dev/null | head -1)
  if [ "$code" = "200" ] && [ "$body" = "acme-ok" ]; then
    printf "   %-32s %s OK\n" "$h" "$code"
  else
    printf "   %-32s %s FAIL (body=%.20s)\n" "$h" "$code" "$body"
    fail=1
  fi
done

echo
if [ "$fail" -ne 0 ]; then
  echo "PROBE FAILED -- renewal confs untouched, no certificate requested."
  echo "Fix the failing hostname(s) before running cert-renew.sh."
  exit 1
fi
echo "ALL HOSTNAMES SERVE THE CHALLENGE. Safe to run cert-renew.sh."
