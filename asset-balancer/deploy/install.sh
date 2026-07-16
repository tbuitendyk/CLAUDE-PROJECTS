#!/usr/bin/env bash
# Installs the Asset Balancer service on a Debian/Ubuntu VPS.
#
# Usage (run from inside this sub-project directory, as a user with sudo):
#   cd claude-projects/asset-balancer
#   sudo bash deploy/install.sh
#
# What it does (idempotent -- safe to re-run for upgrades):
#   1. Installs Node.js + npm via apt (build-essential + python3 are needed
#      once to compile better-sqlite3's native module).
#   2. Creates an unprivileged 'balancer' system user and /opt/asset-balancer.
#   3. Syncs the project there (preserving data/, the SQLite database) and
#      installs production npm dependencies.
#   4. Seeds /etc/asset-balancer/env from deploy/env.example (only if absent
#      -- re-running never clobbers configured SMTP credentials).
#   5. Installs, enables and (re)starts the systemd unit on 127.0.0.1:8091.
#
# The public face of the app is the nginx location /balancer/ on the website
# branch (www.buitendyk.ca), which proxies to 8091 behind the site's Basic
# Auth. This script does not touch nginx -- ship that via deploy-website.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash deploy/install.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/asset-balancer"
SERVICE_USER="balancer"
ENV_FILE="/etc/asset-balancer/env"

echo "==> Installing system packages (build tools for better-sqlite3)"
apt-get update -qq
apt-get install -y --no-install-recommends \
  rsync ca-certificates curl build-essential python3

# The app needs Node >= 18 (global fetch, better-sqlite3 v11). Debian 11's
# apt nodejs is v12, so install Node 20 LTS from NodeSource when the system
# node is missing or too old. NodeSource's package ships npm and installs to
# /usr/bin/node, which is what the systemd unit expects.
NODE_MAJOR="$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p' || true)"
if [[ -z "${NODE_MAJOR}" || "${NODE_MAJOR}" -lt 18 ]]; then
  echo "==> Installing Node.js 20 from NodeSource (system node: ${NODE_MAJOR:-none})"
  apt-get remove -y nodejs npm >/dev/null 2>&1 || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    using node $(node -v) / npm $(npm -v)"

echo "==> Creating service user '${SERVICE_USER}' and ${INSTALL_DIR}"
id -u "${SERVICE_USER}" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
mkdir -p "${INSTALL_DIR}"

echo "==> Syncing project files to ${INSTALL_DIR}"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'data' --exclude '.env' \
  "${REPO_DIR}/" "${INSTALL_DIR}/"
mkdir -p "${INSTALL_DIR}/data"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Installing npm dependencies (compiles better-sqlite3 on first run)"
sudo -u "${SERVICE_USER}" bash -c "cd '${INSTALL_DIR}' && npm ci --omit=dev --no-audit --no-fund"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "==> Seeding ${ENV_FILE} from deploy/env.example"
  mkdir -p "$(dirname "${ENV_FILE}")"
  cp "${REPO_DIR}/deploy/env.example" "${ENV_FILE}"
else
  echo "==> ${ENV_FILE} already exists -- leaving it alone"
fi
chown "root:${SERVICE_USER}" "${ENV_FILE}"
chmod 640 "${ENV_FILE}"

echo "==> Installing and starting the systemd unit"
cp "${REPO_DIR}/deploy/asset-balancer.service" /etc/systemd/system/asset-balancer.service
systemctl daemon-reload
systemctl enable asset-balancer
systemctl restart asset-balancer
sleep 1
systemctl --no-pager --lines 5 status asset-balancer || true

cat <<EOF

==============================================================================
Install complete. Remaining manual steps (first install only):

  1. Edit ${ENV_FILE} with SMTP credentials (e.g. the iRedMail
     server on mail.homeandofficemicro.com, or Gmail + App Password) so
     alert emails can be sent, then: sudo systemctl restart asset-balancer

  2. The public URL https://www.buitendyk.ca/balancer/ needs the nginx
     location from the website branch (ships via deploy-website). Until
     then the app is only reachable locally on 127.0.0.1:8091.

  3. Sanity checks:
       curl -s http://127.0.0.1:8091/api/session
       sudo -u ${SERVICE_USER} node ${INSTALL_DIR}/scripts/test-email.js
==============================================================================
EOF
