#!/usr/bin/env bash
# Deploys docs.homeandofficemicro.com on the host running the nginx SNI router.
# Run as root on that host, from the root of this repo.
#
# Prereqs (one-time):
#   1. DNS A record  docs.homeandofficemicro.com -> 74.208.226.14  (done)
#   2. LE cert at    /etc/letsencrypt/live/docs.homeandofficemicro.com/
#      (issue with deploy/issue-cert.sh first)
#   3. htpasswd at   /etc/nginx/htpasswd/docs.homeandofficemicro.com
#      (create with: htpasswd -c /etc/nginx/htpasswd/docs.homeandofficemicro.com <user>)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBROOT=/var/www/docs.homeandofficemicro.com
VHOST_SRC="$REPO_ROOT/nginx/docs.homeandofficemicro.com.conf"
VHOST_DST=/etc/nginx/sites-available/docs.homeandofficemicro.com.conf
VHOST_LINK=/etc/nginx/sites-enabled/docs.homeandofficemicro.com.conf

if [[ $EUID -ne 0 ]]; then echo "run as root" >&2; exit 1; fi

# 1. Content
install -d -m 755 "$WEBROOT"
rsync -a --delete "$REPO_ROOT/sites/docs.homeandofficemicro.com/" "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"

# 2. htpasswd dir (file itself must be created manually with `htpasswd -c ...`)
install -d -m 750 -o root -g www-data /etc/nginx/htpasswd
if [[ ! -f /etc/nginx/htpasswd/docs.homeandofficemicro.com ]]; then
  echo "WARN: /etc/nginx/htpasswd/docs.homeandofficemicro.com is missing." >&2
  echo "      Create it with:  htpasswd -c /etc/nginx/htpasswd/docs.homeandofficemicro.com <username>" >&2
fi

# 3. Vhost
install -m 644 "$VHOST_SRC" "$VHOST_DST"
ln -sf "$VHOST_DST" "$VHOST_LINK"

# 4. Verify the SNI map already routes docs to 127.0.0.1:4431
if ! grep -qE 'docs\.homeandofficemicro\.com\s+127\.0\.0\.1:4431' /etc/nginx/nginx.conf; then
  echo "ERROR: SNI map in /etc/nginx/nginx.conf still missing docs route." >&2
  echo "       Edit the stream { map ... } block and add:" >&2
  echo "         docs.homeandofficemicro.com    127.0.0.1:4431;" >&2
  echo "       above the 'default' line. See nginx/sni-map.patch.conf." >&2
  exit 2
fi

# 5. Test + reload
nginx -t
systemctl reload nginx
echo "deployed: https://docs.homeandofficemicro.com/leon-solar-project/"
