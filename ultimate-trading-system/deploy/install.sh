#!/usr/bin/env bash
# Installs the General Classifier service on a Debian/Ubuntu VPS.
#
# Usage (run from inside this sub-project directory, as root):
#   cd claude-projects/general-classifier
#   sudo bash deploy/install.sh
#
# What it does (idempotent -- safe to re-run for upgrades):
#   1. Ensures Node.js >= 18 (NodeSource 20 LTS when the system node is too old).
#   2. Creates an unprivileged 'classifier' system user and /opt/general-classifier.
#   3. Syncs the project there (preserving data/, the Binance month cache) and
#      installs production npm dependencies (express only -- no native builds).
#   4. Seeds /etc/general-classifier/env from deploy/env.example (only if absent).
#   5. Installs, enables and (re)starts the systemd unit on 127.0.0.1:8093.
#
# The public face is the nginx location /classifier/ on the website branch
# (www.buitendyk.ca), which proxies to 8093 behind the site's Basic Auth.
# This script does not touch nginx -- ship that via deploy-website.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash deploy/install.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/general-classifier"
SERVICE_USER="classifier"
ENV_FILE="/etc/general-classifier/env"

echo "==> Installing system packages"
# apt update must not kill a code deploy: third-party repos rot (the old
# NodeSource node_20.x list now 403s) while the packages this needs are
# long since installed. Try the update, then verify the tools exist.
apt-get update -qq || echo "    apt-get update failed (stale third-party repo?) — continuing with installed packages"
apt-get install -y --no-install-recommends rsync ca-certificates curl \
  || { command -v rsync >/dev/null && command -v curl >/dev/null && echo "    apt install failed but rsync/curl present — continuing"; }

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

echo "==> Installing npm dependencies"
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
cp "${REPO_DIR}/deploy/general-classifier.service" /etc/systemd/system/general-classifier.service
systemctl daemon-reload
systemctl enable general-classifier
systemctl restart general-classifier
sleep 1
systemctl --no-pager --lines 5 status general-classifier || true

cat <<EOF

==============================================================================
Install complete.

  1. The public URL https://www.buitendyk.ca/classifier/ needs the nginx
     location from the website branch (ships via deploy-website). Until
     then the app is only reachable locally on 127.0.0.1:8093.

  2. Sanity check:
       curl -s http://127.0.0.1:8093/api/healthz
==============================================================================
EOF
