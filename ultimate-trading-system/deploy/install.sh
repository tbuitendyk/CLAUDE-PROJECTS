#!/usr/bin/env bash
# Installs the Ultimate Trading System on a Debian/Ubuntu VPS.
#
# Usage (as root, from inside this sub-project directory):
#   cd claude-projects/ultimate-trading-system
#   sudo bash deploy/install.sh
#
# THE PREVIOUS GENERATION KEEPS RUNNING. A separate installation of the older
# app lives at /opt/general-classifier, as unit `general-classifier`, on port
# 8093, and it holds the owner's live trading and paper books. NOTHING in this
# script writes to that directory, that unit, that env file or that port. The
# only thing it ever does with the old installation is READ its candle cache,
# once, to seed this one (see "candle cache" below).
#
# What it does (idempotent -- safe to re-run for upgrades):
#   1. Ensures Node.js >= 18.
#   2. Creates an unprivileged 'uts' system user and /opt/ultimate-trading-system.
#   3. Syncs the project there, preserving data/, and installs npm deps.
#   4. Seeds the candle cache from the previous installation the FIRST time only
#      (THIS-RELEASE point 15: the downloaded candle files are kept, everything
#      else starts empty).
#   5. Seeds /etc/ultimate-trading-system/env from deploy/env.example if absent.
#   6. Installs, enables and (re)starts the unit on 127.0.0.1:8094.
#
# The public face is the nginx location /uts/ on the website branch, which ships
# separately via deploy-website. This script does not touch nginx.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash deploy/install.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/ultimate-trading-system"
SERVICE_USER="uts"
SERVICE_NAME="ultimate-trading-system"
ENV_FILE="/etc/ultimate-trading-system/env"
# Read-only source for the one-time candle seed. Never written to.
LEGACY_CACHE="/opt/general-classifier/data/cache"

# A guard, not a formality: every path this script writes must differ from the
# running previous generation's. Resolved with readlink, not compared as a
# string, because a symlinked /opt/ultimate-trading-system would pass a string
# test and still write straight into the live installation. A check that costs
# nothing and fails loudly beats discovering the collision by taking the
# owner's trading down.
LEGACY_DIRS=(/opt/general-classifier /etc/general-classifier)
for d in "${INSTALL_DIR}" "$(dirname "${ENV_FILE}")"; do
  if [[ -L "${d}" ]]; then
    echo "REFUSING: ${d} is a symlink; resolve it by hand before installing" >&2; exit 1
  fi
  resolved="$(readlink -f "${d}" 2>/dev/null || echo "${d}")"
  for legacy in "${LEGACY_DIRS[@]}"; do
    legacy_resolved="$(readlink -f "${legacy}" 2>/dev/null || echo "${legacy}")"
    if [[ "${resolved}" == "${legacy_resolved}" || "${resolved}" == "${legacy_resolved}/"* ]]; then
      echo "REFUSING: ${d} resolves inside the running previous generation (${legacy})" >&2; exit 1
    fi
  done
done
if [[ "${SERVICE_NAME}" == "general-classifier" ]]; then
  echo "REFUSING: service name collides with the running previous generation" >&2; exit 1
fi
# And do not adopt a unit that is not ours.
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
if [[ -e "${UNIT_PATH}" ]] && ! grep -q "^WorkingDirectory=${INSTALL_DIR}$" "${UNIT_PATH}"; then
  echo "REFUSING: ${UNIT_PATH} exists and does not point at ${INSTALL_DIR}" >&2; exit 1
fi

echo "==> Installing system packages"
# apt update must not kill a code deploy: third-party repos rot while the
# packages this needs are long since installed. Try, then verify the tools exist.
apt-get update -qq || echo "    apt-get update failed (stale third-party repo?) — continuing with installed packages"
apt-get install -y --no-install-recommends rsync ca-certificates curl \
  || { command -v rsync >/dev/null && command -v curl >/dev/null && echo "    apt install failed but rsync/curl present — continuing"; }

NODE_MAJOR="$(node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p' || true)"
if [[ -z "${NODE_MAJOR}" || "${NODE_MAJOR}" -lt 18 ]]; then
  # DELIBERATELY REFUSING rather than installing Node. The previous generation
  # runs on this same /usr/bin/node and its hourly trading tick shells out to
  # `node` by name, so a swapped interpreter is picked up within the hour with
  # no restart and no warning. The NodeSource installer also rewrites shared apt
  # state as root, which is already known to rot on this box and would break
  # every later apt run including the website deploy. Provisioning Node is its
  # own authorised task, not a side effect of shipping this app.
  echo "REFUSING: node ${NODE_MAJOR:-none} is below 18, and this installer will not replace the interpreter" >&2
  echo "          the running trading system uses. Install Node as a separate, authorised step." >&2
  exit 1
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

# ---- candle cache: carried once, and nothing else (THIS-RELEASE point 15) ----
# The point says the downloaded candle files are kept and every other trace of
# the previous project goes. So this copies ONLY data/cache, only when this
# installation has none, and reads the source read-only. Run records,
# greenlights, setups, journals and book state are deliberately not copied:
# this system starts from zero use.
if [[ ! -d "${INSTALL_DIR}/data/cache" && -d "${LEGACY_CACHE}" ]]; then
  # Space first. This duplicates the cache onto the SAME filesystem, and the box
  # was at 83% when this was written. Filling the disk would stop the live
  # trading rail from journalling, which is a far worse outcome than not seeding.
  NEED_KB="$(du -sk "${LEGACY_CACHE}" | cut -f1)"
  FREE_KB="$(df -Pk "${INSTALL_DIR}" | awk 'NR==2 {print $4}')"
  MARGIN_KB=$(( NEED_KB + 2 * 1024 * 1024 ))   # the copy plus 2 GB of headroom
  if (( FREE_KB < MARGIN_KB )); then
    echo "REFUSING to seed: need $(( NEED_KB / 1024 )) MB plus 2 GB headroom, only $(( FREE_KB / 1024 )) MB free" >&2
    echo "          The install continues without a seeded cache; the system will download what it needs." >&2
  else
    echo "==> Seeding the candle cache from ${LEGACY_CACHE} ($(( NEED_KB / 1024 )) MB; one time; nothing else is copied)"
    mkdir -p "${INSTALL_DIR}/data/cache"
    # Idle I/O and lowest CPU priority: the live rail writes into that same
    # directory hourly, and this copy must never be what makes it late.
    ionice -c3 nice -n19 rsync -a "${LEGACY_CACHE}/" "${INSTALL_DIR}/data/cache/"
    echo "    seeded $(find "${INSTALL_DIR}/data/cache" -type f | wc -l) cached file(s)"
  fi
else
  echo "==> Candle cache already present (or no previous cache to read) — leaving it alone"
fi

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
cp "${REPO_DIR}/deploy/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 2
systemctl --no-pager --lines 5 status "${SERVICE_NAME}" || true

echo "==> Health check"
PORT_IN_USE="$(sed -n 's/^PORT=//p' "${ENV_FILE}" | head -1)"
curl -sf "http://127.0.0.1:${PORT_IN_USE:-8094}/api/healthz" >/dev/null \
  && echo "    healthz OK on 127.0.0.1:${PORT_IN_USE:-8094}" \
  || { echo "    healthz FAILED on 127.0.0.1:${PORT_IN_USE:-8094}" >&2; exit 1; }

echo "==> Confirming the previous generation is still up"
systemctl is-active --quiet general-classifier \
  && echo "    general-classifier: still active (untouched)" \
  || echo "    general-classifier: NOT active — it was not touched by this script, but check it"

cat <<EOF

==============================================================================
Install complete.

  Service : ${SERVICE_NAME} on 127.0.0.1:${PORT_IN_USE:-8094}
  Files   : ${INSTALL_DIR}
  Env     : ${ENV_FILE}

  The public URL https://www.buitendyk.ca/uts/ needs the nginx location from
  the website branch (ships via deploy-website). Until then the app is only
  reachable locally.
==============================================================================
EOF
