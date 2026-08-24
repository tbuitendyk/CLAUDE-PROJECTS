#!/usr/bin/env bash
# Installs UTS Service Control -- the separate process that says what is running
# on this machine and starts, stops and restarts it (owner order, 2026-08-24).
#
# It is separate from the trading system on purpose, and the reasoning is in
# service-control/server.js. In short: the trading service runs as an
# unprivileged user with ProtectSystem=strict and cannot run systemctl at all,
# and even if it could, a control served by the same single thread that just
# froze would have frozen with it.
#
# What this does (idempotent -- safe to re-run):
#   1. Puts server.js in /opt/uts-service-control.
#   2. Installs, enables and (re)starts uts-service-control on 127.0.0.1:8095.
#   3. Adds the nginx location /uts/svc/ so the screens can reach it, behind the
#      same site password as everything else, and reloads nginx.
#   4. Checks it answers, and that nothing else was disturbed.
#
# IT TOUCHES NO OTHER SERVICE. It does not write to /opt/general-classifier,
# /opt/ultimate-trading-system, or any unit but its own. The nginx change is one
# added location block inside the existing server, and the file is backed up
# first and rolled back if nginx will not accept it.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash service-control/install.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/uts-service-control"
SERVICE_NAME="uts-service-control"
PORT=8095
NGINX_CONF="/etc/nginx/sites-enabled/www.buitendyk.ca.conf"

# A guard, not a formality: nothing here may resolve into another project's
# installation. Resolved with readlink rather than compared as text, because a
# symlinked /opt/uts-service-control would pass a string test and still write
# somewhere else entirely.
for other in /opt/general-classifier /opt/ultimate-trading-system /opt/deploy-control; do
  if [[ -L "${INSTALL_DIR}" ]]; then
    echo "REFUSING: ${INSTALL_DIR} is a symlink; resolve it by hand before installing" >&2; exit 1
  fi
  resolved="$(readlink -f "${INSTALL_DIR}" 2>/dev/null || echo "${INSTALL_DIR}")"
  other_resolved="$(readlink -f "${other}" 2>/dev/null || echo "${other}")"
  if [[ "${resolved}" == "${other_resolved}" || "${resolved}" == "${other_resolved}/"* ]]; then
    echo "REFUSING: ${INSTALL_DIR} resolves inside ${other}" >&2; exit 1
  fi
done
# And do not adopt a unit that is not ours.
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
if [[ -e "${UNIT_PATH}" ]] && ! grep -q "^WorkingDirectory=${INSTALL_DIR}$" "${UNIT_PATH}"; then
  echo "REFUSING: ${UNIT_PATH} exists and does not point at ${INSTALL_DIR}" >&2; exit 1
fi
# The port has to be free, or ours. Landing on somebody else's port is how one
# service quietly takes another's traffic.
HOLDER="$(ss -lntpH "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [[ -n "${HOLDER}" ]]; then
  HOLDER_UNIT="$(ps -o unit= -p "${HOLDER}" 2>/dev/null | tr -d ' ' || true)"
  if [[ "${HOLDER_UNIT}" != "${SERVICE_NAME}.service" ]]; then
    echo "REFUSING: port ${PORT} is already held by ${HOLDER_UNIT:-pid ${HOLDER}}" >&2; exit 1
  fi
fi

NODE_MAJOR="$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p' || true)"
if [[ -z "${NODE_MAJOR}" || "${NODE_MAJOR}" -lt 18 ]]; then
  echo "REFUSING: node ${NODE_MAJOR:-none} is below 18, and this installer will not replace the" >&2
  echo "          interpreter the running trading system uses." >&2
  exit 1
fi

echo "==> Putting the control in ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
install -m 0644 "${REPO_DIR}/server.js" "${INSTALL_DIR}/server.js"

echo "==> Installing and starting ${SERVICE_NAME} on 127.0.0.1:${PORT}"
install -m 0644 "${REPO_DIR}/${SERVICE_NAME}.service" "${UNIT_PATH}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"
sleep 2

echo "==> Does it answer"
if curl -sf --max-time 20 "http://127.0.0.1:${PORT}/api/services" -o /tmp/uts-svc-check.json; then
  echo "    yes: $(python3 -c 'import json;d=json.load(open("/tmp/uts-svc-check.json"));print(len(d["units"]),"service(s) listed,",sum(1 for u in d["units"] if u["ports"]),"holding a port")' 2>/dev/null || echo 'answered')"
else
  echo "    NO -- it did not answer. Leaving nginx alone; nothing is routed to a service that does not work." >&2
  systemctl --no-pager --lines 20 status "${SERVICE_NAME}" || true
  exit 1
fi

echo "==> Routing /uts/svc/ to it"
if [[ ! -f "${NGINX_CONF}" ]]; then
  echo "    ${NGINX_CONF} is not there. The control is installed and works locally, but nothing" >&2
  echo "    on the web reaches it. Add the location by hand." >&2
  exit 1
fi
if grep -q 'location /uts/svc/' "${NGINX_CONF}"; then
  echo "    already routed -- leaving the file alone"
else
  BACKUP="${NGINX_CONF}.before-svc.$(date -u +%Y%m%d-%H%M%S)"
  cp -a "${NGINX_CONF}" "${BACKUP}"
  echo "    backed up to ${BACKUP}"
  # Inserted BEFORE the /uts/ block. nginx picks the longest matching prefix
  # regardless of order, so this is for a reader's benefit rather than nginx's.
  python3 - "${NGINX_CONF}" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
block = '''    # SERVICE CONTROL (uts-service-control on 127.0.0.1:8095). A SEPARATE
    # process from the trading system on 8094, and that is the entire point: it
    # answers when 8094 does not. Same site password as every other location
    # here. nginx matches the longest prefix, so this wins over /uts/ below.
    #
    # Short timeouts on purpose. This one must never be the request that hangs,
    # so if it cannot answer in fifteen seconds the answer is that it cannot.
    location /uts/svc/ {
        auth_basic           "www.buitendyk.ca";
        auth_basic_user_file /etc/nginx/.htpasswd-www-buitendyk-ca;

        proxy_pass http://127.0.0.1:8095/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout   15s;
        proxy_send_timeout   15s;

        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options nosniff   always;
        add_header X-Frame-Options        SAMEORIGIN always;
        add_header Referrer-Policy        no-referrer always;
    }

'''
m = re.search(r'^[ \t]*location /uts/ \{', s, re.M)
if not m:
    sys.stderr.write('could not find the /uts/ location to insert before\n')
    sys.exit(2)
open(p, 'w').write(s[:m.start()] + block + s[m.start():])
PY
  if nginx -t 2>/tmp/uts-svc-nginx.err; then
    systemctl reload nginx
    echo "    added and nginx reloaded"
  else
    cp -a "${BACKUP}" "${NGINX_CONF}"
    echo "    nginx would not accept it, so the file has been put back exactly as it was:" >&2
    cat /tmp/uts-svc-nginx.err >&2
    exit 1
  fi
fi

echo "==> Confirming nothing else was disturbed"
for u in ultimate-trading-system general-classifier nginx; do
  printf '    %-26s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)"
done

cat <<EOF

==============================================================================
UTS Service Control is installed.

  Service : ${SERVICE_NAME} on 127.0.0.1:${PORT}
  Files   : ${INSTALL_DIR}
  Address : https://www.buitendyk.ca/uts/svc/   (the same screens, served from
            here, for when the trading service is not answering)

  On the screens it is the Service tab, and that tab talks to THIS process, so
  it keeps working when the rest of the page cannot be drawn.
==============================================================================
EOF
