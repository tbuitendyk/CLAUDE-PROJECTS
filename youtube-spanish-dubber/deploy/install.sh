#!/usr/bin/env bash
# Installs the YouTube Spanish Dubber service on a Debian/Ubuntu VPS.
#
# Usage (run from inside this sub-project directory, as a user with sudo):
#   cd claude-projects/youtube-spanish-dubber
#   sudo bash deploy/install.sh
#
# What it does:
#   1. Installs system packages (ffmpeg + Python build tools) via apt -- all free.
#   2. Creates an unprivileged 'dubber' system user and /opt/youtube-dubber.
#   3. Copies the project there, creates a virtualenv, installs Python deps.
#   4. Pre-downloads the offline translation language packages (Argos Translate).
#   5. Installs the systemd unit (disabled -- you still need to do the
#      one-time YouTube authorization before starting it; see README.md).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (e.g. sudo bash deploy/install.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/youtube-dubber"
SERVICE_USER="dubber"

echo "==> Installing system packages (ffmpeg, python3-venv, ...)"
apt-get update -qq
apt-get install -y --no-install-recommends \
  ffmpeg python3 python3-venv python3-pip rsync ca-certificates \
  fonts-dejavu-core   # TrueType font Pillow uses for the "Versión Español" thumbnail banner

echo "==> Creating service user '${SERVICE_USER}' and ${INSTALL_DIR}"
id -u "${SERVICE_USER}" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
mkdir -p "${INSTALL_DIR}"

echo "==> Syncing project files to ${INSTALL_DIR}"
rsync -a --delete \
  --exclude '.git' --exclude '.venv' --exclude 'data' --exclude 'secrets' \
  --exclude '__pycache__' --exclude '.env' \
  "${REPO_DIR}/" "${INSTALL_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Creating Python virtualenv and installing dependencies (this can take a while)"
sudo -u "${SERVICE_USER}" python3 -m venv "${INSTALL_DIR}/.venv"
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip wheel
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo "==> Preparing config (.env) and secrets directory"
mkdir -p "${INSTALL_DIR}/secrets" "${INSTALL_DIR}/data"
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp "${INSTALL_DIR}/deploy/env.example" "${INSTALL_DIR}/.env"
  echo "    Created ${INSTALL_DIR}/.env from the example -- review and edit it."
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Pre-downloading Argos Translate language packages (free, offline MT models)"
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/python" - <<'PYEOF'
import argostranslate.package
print("Updating Argos Translate package index...")
argostranslate.package.update_package_index()
available = argostranslate.package.get_available_packages()

# Install a useful base set for routing arbitrary source languages -> Spanish:
# - direct {lang}->es packages where they exist
# - en<->es as a pivot, since Argos can chain translations through English
wanted = [
    ("en", "es"), ("es", "en"),
    ("en", "fr"), ("fr", "en"),
    ("en", "pt"), ("pt", "en"),
    ("en", "de"), ("de", "en"),
    ("en", "it"), ("it", "en"),
    ("fr", "es"), ("pt", "es"), ("de", "es"), ("it", "es"),
]
for frm, to in wanted:
    match = next((p for p in available if p.from_code == frm and p.to_code == to), None)
    if match is None:
        continue
    print(f"Installing translation package {frm} -> {to} ...")
    argostranslate.package.install_from_path(match.download())
print("Done. Add more pairs later via the same pattern, or `argospm install translate-XX_YY`.")
PYEOF

echo "==> Pre-downloading the punctuation model (optional CPU ONNX model, no torch)"
# Best-effort: warms the HuggingFace cache and verifies the model loads, so the
# first preview isn't slow. If it fails (no network, disk, etc.) the service
# still works -- the rechunker just falls back to its punctuation heuristic.
sudo -u "${SERVICE_USER}" env PYTHONPATH="${INSTALL_DIR}" "${INSTALL_DIR}/.venv/bin/python" - <<'PYEOF' \
  || echo "    (punctuation model unavailable -- rechunker will use its heuristic fallback; not fatal)"
from youtube_dubber.pipeline import punctuation_onnx
out = punctuation_onnx.restore_sentences(
    "this is a quick self test of the punctuation model okay it seems to be working"
)
print("    Punctuation model self-test:", out if out else "(unavailable -> heuristic fallback)")
PYEOF

echo "==> Installing systemd unit"
cp "${INSTALL_DIR}/deploy/youtube-dubber.service" /etc/systemd/system/youtube-dubber.service
systemctl daemon-reload

# On a re-deploy the service is already running old code from before the rsync;
# restart it so the new code/deps take effect. Skipped on a first install
# (service not yet active -- it still needs the one-time YouTube authorization
# below before it can start).
if systemctl is-active --quiet youtube-dubber; then
  echo "==> Restarting the running service to pick up the new code"
  systemctl restart youtube-dubber
fi

cat <<EOF

==============================================================================
Install complete. Remaining manual steps (see README.md for full detail):

  1. Get a free OAuth client secret from Google Cloud Console
     (YouTube Data API v3, OAuth client type "Desktop app") and place it at:
         ${INSTALL_DIR}/secrets/client_secret.json

  2. Run the ONE-TIME interactive authorization as the '${SERVICE_USER}' user
     (do this over an SSH session with a browser you can reach, e.g. via
     'ssh -L 8080:localhost:8080' port forwarding):
         cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} ./.venv/bin/python -m youtube_dubber.cli authorize

     This writes a refresh token to ${INSTALL_DIR}/secrets/token.json so the
     service can upload videos unattended afterwards.

  3. Review/edit ${INSTALL_DIR}/.env (voice, privacy status, audio mode, etc).

  4. Enable and start the service:
         sudo systemctl enable --now youtube-dubber
         sudo systemctl status youtube-dubber

  5. Submit a video for dubbing:
         curl -X POST http://127.0.0.1:8088/jobs \\
              -H 'Content-Type: application/json' \\
              -d '{"url": "https://www.youtube.com/watch?v=XXXXXXXXXXX"}'
==============================================================================
EOF
