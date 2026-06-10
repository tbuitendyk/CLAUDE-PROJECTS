#!/usr/bin/env bash
# Installs the HTTPS deploy-control endpoint on the VPS.
#
# Prereq: run setup-claude-access.sh FIRST -- this builds on the claude-deploy
# user, the /usr/local/sbin/claude-deploy helper, and its sudoers rule.
#
# Usage (as root, from a checkout of the vps-access branch):
#   sudo bash vps-access/install-deploy-control.sh
#
# What it does, in order of increasing blast radius:
#   1. Installs the local service (server.py -> /opt/deploy-control, systemd
#      unit, a generated bearer token) and starts it on 127.0.0.1 only. This is
#      safe: nothing is exposed yet.
#   2. Drops the nginx vhost into sites-available.
#   3. ONLY IF a TLS cert for deploy.buitendyk.ca already exists does it enable
#      the vhost + reload nginx. Otherwise it stops and prints the remaining
#      manual steps, leaving nginx untouched -- so a missing cert can never take
#      the web server down.
set -euo pipefail

DEPLOY_USER="claude-deploy"
APP_DIR="/opt/deploy-control"
ENV_DIR="/etc/deploy-control"
ENV_FILE="${ENV_DIR}/env"
PORT="8090"
HOSTNAME_FQDN="deploy.buitendyk.ca"
NGINX_CONF="${HOSTNAME_FQDN}.conf"
CERT_DIR="/etc/letsencrypt/live/${HOSTNAME_FQDN}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo bash vps-access/install-deploy-control.sh)" >&2
  exit 1
fi
if ! id "$DEPLOY_USER" &>/dev/null; then
  echo "User '${DEPLOY_USER}' not found -- run setup-claude-access.sh first." >&2
  exit 1
fi
if [[ ! -x /usr/local/sbin/claude-deploy ]]; then
  echo "/usr/local/sbin/claude-deploy not found -- run setup-claude-access.sh first." >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing the service files to ${APP_DIR}"
install -d -o root -g root -m 755 "$APP_DIR"
install -o root -g root -m 755 "${REPO_DIR}/vps-access/deploy-control/server.py" "${APP_DIR}/server.py"

echo "==> Generating the bearer token (only if one isn't already set)"
install -d -o root -g "$DEPLOY_USER" -m 750 "$ENV_DIR"
if [[ -f "$ENV_FILE" ]] && grep -q '^DEPLOY_CONTROL_TOKEN=' "$ENV_FILE"; then
  echo "    ${ENV_FILE} already has a token -- leaving it as-is."
  TOKEN="$(grep '^DEPLOY_CONTROL_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
  NEW_TOKEN=0
else
  TOKEN="$(openssl rand -hex 32)"
  printf 'DEPLOY_CONTROL_TOKEN=%s\nDEPLOY_CONTROL_PORT=%s\n' "$TOKEN" "$PORT" > "$ENV_FILE"
  NEW_TOKEN=1
fi
chown root:"$DEPLOY_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

echo "==> Installing and starting the systemd service"
install -o root -g root -m 644 "${REPO_DIR}/vps-access/deploy-control/deploy-control.service" \
  /etc/systemd/system/deploy-control.service
systemctl daemon-reload
systemctl enable --now deploy-control.service
sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
  echo "    Local service healthy on 127.0.0.1:${PORT}."
else
  echo "    WARNING: local health check failed -- see 'journalctl -u deploy-control'." >&2
fi

echo "==> Placing the nginx vhost in sites-available"
cp "${REPO_DIR}/vps-access/nginx/${NGINX_CONF}" "/etc/nginx/sites-available/${NGINX_CONF}"

if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
  echo "==> Cert found -- enabling the vhost and reloading nginx"
  ln -sf "/etc/nginx/sites-available/${NGINX_CONF}" "/etc/nginx/sites-enabled/${NGINX_CONF}"
  if nginx -t; then
    systemctl reload nginx
    echo "    nginx reloaded."
  else
    echo "    nginx -t FAILED -- unlinking the vhost so nginx stays healthy." >&2
    rm -f "/etc/nginx/sites-enabled/${NGINX_CONF}"
    echo "    Fix the config, then re-run this script." >&2
    exit 1
  fi
  NGINX_LIVE=1
else
  echo "==> No cert for ${HOSTNAME_FQDN} yet -- NOT touching nginx (kept safe)."
  NGINX_LIVE=0
fi

echo
echo "=============================================================================="
echo "deploy-control installed."
if [[ "$NEW_TOKEN" -eq 1 ]]; then
  echo
  echo "  >>> BEARER TOKEN (shown once -- copy it now) <<<"
  echo "      ${TOKEN}"
  echo
  echo "  Add it to the Claude Code environment as the env var:"
  echo "      DEPLOY_API_TOKEN=${TOKEN}"
fi

if [[ "$NGINX_LIVE" -eq 0 ]]; then
  cat <<EOF

  REMAINING MANUAL STEPS (nginx was left untouched until these are done):

  1. DNS: point ${HOSTNAME_FQDN} at this VPS's public IP (an A record),
     the same way bible./kjv./vp. are set up.

  2. SNI routing: add this line to the stream map in /etc/nginx/nginx.conf
     (the 'map \$ssl_preread_server_name \$backend' block):
         ${HOSTNAME_FQDN}   127.0.0.1:4433;

  3. TLS cert. Your existing certs use MANUAL DNS-01, so the consistent
     command is:
         certbot certonly --manual --preferred-challenges dns -d ${HOSTNAME_FQDN}
     (add the printed _acme-challenge TXT record at your DNS host, then enter).
     NOTE: manual DNS-01 does NOT auto-renew. For hands-off renewal, switch to
     a DNS-API plugin (e.g. certbot-dns-ionos) and add
     --deploy-hook "systemctl reload nginx". See README "Cert automation".

  4. Re-run this script:  sudo bash vps-access/install-deploy-control.sh
     This time it'll find the cert, enable the vhost, and reload nginx.
EOF
else
  cat <<EOF

  The endpoint is LIVE at https://${HOSTNAME_FQDN}/

  Smoke test from anywhere (replace TOKEN):
      curl -fsS -X POST https://${HOSTNAME_FQDN}/run \\
          -H "Authorization: Bearer TOKEN" \\
          -H "Content-Type: application/json" \\
          -d '{"action":"status"}'
EOF
fi
echo "=============================================================================="
