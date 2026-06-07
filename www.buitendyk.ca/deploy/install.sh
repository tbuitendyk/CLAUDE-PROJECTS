#!/usr/bin/env bash
# Deploys the www.buitendyk.ca portal site on a Debian/Ubuntu VPS.
#
# Usage (run from inside this sub-project directory, as a user with sudo):
#   cd claude-projects/www.buitendyk.ca
#   sudo bash deploy/install.sh
#
# What it does:
#   1. Syncs the static site files to /var/www/www.buitendyk.ca.
#   2. Installs the nginx site config and enables it.
#   3. Creates the .htpasswd file that gates /dubber/api/ behind HTTP Basic
#      Auth (only if it doesn't already exist -- re-running this script
#      won't clobber credentials you've already set).
#   4. Reloads nginx.
#
# This script does NOT obtain TLS certificates -- it assumes you're managing
# those the same way as the rest of the VPS already (e.g. certbot). Run
# certbot for www.buitendyk.ca (and buitendyk.ca) before -- or right after --
# enabling this config; nginx won't start with a site block that references
# certificate files that don't exist yet.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash deploy/install.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_NAME="www.buitendyk.ca"
WEB_ROOT="/var/www/${SITE_NAME}"
NGINX_CONF_NAME="${SITE_NAME}.conf"
HTPASSWD_FILE="/etc/nginx/.htpasswd-www-buitendyk-ca"

echo "==> Installing nginx and Basic-Auth tooling (if not already present)"
apt-get update -qq
apt-get install -y --no-install-recommends nginx apache2-utils rsync

echo "==> Syncing static site files to ${WEB_ROOT}"
mkdir -p "${WEB_ROOT}"
rsync -a --delete "${REPO_DIR}/sites/${SITE_NAME}/" "${WEB_ROOT}/"
chown -R www-data:www-data "${WEB_ROOT}"

echo "==> Installing nginx site config"
cp "${REPO_DIR}/nginx/${NGINX_CONF_NAME}" "/etc/nginx/sites-available/${NGINX_CONF_NAME}"
ln -sf "/etc/nginx/sites-available/${NGINX_CONF_NAME}" "/etc/nginx/sites-enabled/${NGINX_CONF_NAME}"

if [[ ! -f "${HTPASSWD_FILE}" ]]; then
  echo "==> Creating ${HTPASSWD_FILE} (you'll be prompted for a username and password)"
  echo "    These are the 'site creds' that unlock the dubber control panel."
  read -rp "    Choose a username for the site credentials: " HTPASSWD_USER
  htpasswd -c "${HTPASSWD_FILE}" "${HTPASSWD_USER}"
else
  echo "==> ${HTPASSWD_FILE} already exists -- leaving it alone"
  echo "    (use 'sudo htpasswd ${HTPASSWD_FILE} <user>' to add/change credentials)"
fi
chown root:www-data "${HTPASSWD_FILE}"
chmod 640 "${HTPASSWD_FILE}"

echo "==> Testing and reloading nginx"
nginx -t
systemctl reload nginx

cat <<EOF

==============================================================================
Install complete. Remaining manual steps:

  1. This box routes HTTPS through an SNI-based stream proxy in
     /etc/nginx/nginx.conf (the "map \$ssl_preread_server_name \$backend"
     block) -- the vhost in this config listens on 127.0.0.1:4432 and
     expects that block to forward both "buitendyk.ca" and
     "www.buitendyk.ca" there, e.g.:
         buitendyk.ca       127.0.0.1:4432;
         www.buitendyk.ca   127.0.0.1:4432;
     Add those two lines to the map (pick a free port if 4432 collides
     with something else), then 'sudo nginx -t && sudo systemctl reload nginx'.

  2. Get a TLS certificate covering both hostnames at the paths referenced
     in nginx/${NGINX_CONF_NAME} -- follow whatever process you already use
     for this VPS's other certs (see /etc/letsencrypt/live/ and
     'sudo certbot certificates' for examples, e.g. the kjv.buitendyk.ca
     cert covers multiple subdomains on one certificate the same way).

  3. Make sure DNS for both buitendyk.ca and www.buitendyk.ca points at
     this VPS's public IP.

  4. The dubber control panel at https://www.buitendyk.ca/dubber/ needs the
     youtube-spanish-dubber service running locally on 127.0.0.1:8088 --
     see ../youtube-spanish-dubber/README.md if it isn't set up yet.

  5. Visit https://www.buitendyk.ca/dubber/ and click "Sign in" to test the
     Basic Auth gate with the credentials you just created.
==============================================================================
EOF
