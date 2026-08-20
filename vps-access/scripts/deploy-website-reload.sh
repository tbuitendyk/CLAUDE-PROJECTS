#!/usr/bin/env bash
# deploy-website-reload.sh -- ship the portal site and its nginx vhost, and
# RELOAD nginx. No package work of any kind.
#
# Why this exists beside deploy-website: that path runs
# `apt-get install -y nginx apache2-utils rsync` first. If a package upgrade is
# pending, installing nginx RESTARTS it, and a restart drops every proxied site
# on this box for the duration — including /classifier/, which is the previous
# generation's live trading and paper books. Shipping a static page and one
# location block does not need apt, so this does not run it.
#
# Differences from deploy-website, all deliberate:
#   - no apt, so no upgrade and no restart;
#   - reload, never restart, so established connections are not dropped;
#   - the current vhost is backed up before it is replaced;
#   - `nginx -t` gates the reload, so a bad config changes nothing;
#   - the .htpasswd file is never touched.
set -euo pipefail
CHECKOUT="$HOME/deploy-website-reload"
SITE="www.buitendyk.ca"
CONF="/etc/nginx/sites-available/${SITE}.conf"

if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch website https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin website
git checkout -B website origin/website
echo "==> shipping $(git log --oneline -1)"

SRC="$CHECKOUT/${SITE}"

echo "==> Static site -> /var/www/${SITE}"
rsync -a --delete "${SRC}/sites/${SITE}/" "/var/www/${SITE}/"
chown -R www-data:www-data "/var/www/${SITE}"

echo "==> nginx vhost"
if [[ -f "$CONF" ]]; then
  BACKUP="${CONF}.$(date -u +%Y%m%dT%H%M%SZ).bak"
  cp -a "$CONF" "$BACKUP"
  echo "    backed up to ${BACKUP}"
  if diff -q "$CONF" "${SRC}/nginx/${SITE}.conf" >/dev/null; then
    echo "    identical — nothing to change"
  else
    echo "    --- changes being applied ---"
    diff -u "$CONF" "${SRC}/nginx/${SITE}.conf" || true
  fi
fi
cp "${SRC}/nginx/${SITE}.conf" "$CONF"
ln -sf "$CONF" "/etc/nginx/sites-enabled/${SITE}.conf"

echo "==> Testing config"
if ! nginx -t; then
  echo "nginx -t FAILED — restoring the previous vhost and leaving nginx alone" >&2
  [[ -n "${BACKUP:-}" && -f "${BACKUP}" ]] && cp -a "${BACKUP}" "$CONF"
  nginx -t || true
  exit 1
fi

echo "==> Reloading nginx (reload, not restart)"
systemctl reload nginx
sleep 1
systemctl is-active --quiet nginx && echo "    nginx: active" || { echo "    nginx: NOT active" >&2; exit 1; }

echo "==> Proxied sites still answering through nginx"
for loc in classifier uts balancer semibalancer; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -k "https://127.0.0.1:4432/${loc}/" -H "Host: ${SITE}" || echo 000)"
  echo "    /${loc}/ -> ${code}   (401 = up, behind site credentials)"
done
