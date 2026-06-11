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
  ffmpeg python3 python3-venv python3-pip rsync ca-certificates curl \
  fonts-dejavu-core \
  libgl1 libglib2.0-0
  # fonts-dejavu-core: TrueType font Pillow uses for the "Versión Español"
  #   thumbnail banner.
  # libgl1 + libglib2.0-0: shared libs opencv-python needs at import time (it is
  #   pulled in by rapidocr-onnxruntime for in-thumbnail text localisation; the
  #   headless server has no X11, so these provide libGL.so.1 / libgthread).

echo "==> Creating service user '${SERVICE_USER}' and ${INSTALL_DIR}"
id -u "${SERVICE_USER}" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
mkdir -p "${INSTALL_DIR}"

echo "==> Syncing project files to ${INSTALL_DIR}"
rsync -a --delete \
  --exclude '.git' --exclude '.venv' --exclude 'data' --exclude 'secrets' \
  --exclude '__pycache__' --exclude '.env' --exclude 'bin' --exclude 'yt-dlp-plugins' \
  "${REPO_DIR}/" "${INSTALL_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Creating Python virtualenv and installing dependencies (this can take a while)"
sudo -u "${SERVICE_USER}" python3 -m venv "${INSTALL_DIR}/.venv"
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip wheel
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo "==> Installing the latest standalone yt-dlp binary"
# yt-dlp must track YouTube's constant changes, but its current releases need a
# newer Python than this box runs (3.9 was dropped after EOL). The self-contained
# yt-dlp_linux build bundles its own Python, so fetch the latest on every deploy
# and run it as a subprocess (youtube_dubber/pipeline/downloader.py) -- keeping
# extraction current independent of the .venv. Excluded from the rsync --delete
# above so it survives between deploys.
mkdir -p "${INSTALL_DIR}/bin"
curl -fsSL -o "${INSTALL_DIR}/bin/yt-dlp" \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x "${INSTALL_DIR}/bin/yt-dlp"
chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp"
echo "    yt-dlp $(sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp" --version)"

echo "==> Installing the bgutil PO-token provider + yt-dlp plugin"
# 2026 YouTube requires a "Proof of Origin" token for most formats; without one,
# downloads 403 or return no formats. A small localhost provider mints tokens and
# a yt-dlp plugin hands them over. We use the standalone Rust build (jim60105) --
# a single binary + plugin, no Node/Docker -- to match the yt-dlp binary above.
# https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs
POT_RELEASE="https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download"
curl -fsSL -o "${INSTALL_DIR}/bin/bgutil-pot" "${POT_RELEASE}/bgutil-pot-linux-x86_64"
chmod +x "${INSTALL_DIR}/bin/bgutil-pot"
chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/bin/bgutil-pot"

# Plugin: extract its `yt_dlp_plugins` package directly into the plugin dir the
# app points yt-dlp at (DUBBER_YTDLP_PLUGIN_DIRS), wherever it sits in the zip.
PLUGIN_DIR="${INSTALL_DIR}/yt-dlp-plugins"
PLUGIN_TMP="$(mktemp -d)"
curl -fsSL -o "${PLUGIN_TMP}/plugin.zip" "${POT_RELEASE}/bgutil-ytdlp-pot-provider-rs.zip"
"${INSTALL_DIR}/.venv/bin/python" -c \
  "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" \
  "${PLUGIN_TMP}/plugin.zip" "${PLUGIN_TMP}/unzipped"
PKG="$(dirname "$(find "${PLUGIN_TMP}/unzipped" -type d -name yt_dlp_plugins | head -n1)")"
rm -rf "${PLUGIN_DIR}"
mkdir -p "${PLUGIN_DIR}"
cp -r "${PKG}/yt_dlp_plugins" "${PLUGIN_DIR}/"
rm -rf "${PLUGIN_TMP}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${PLUGIN_DIR}"

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

echo "==> Pre-warming the thumbnail OCR model (optional CPU ONNX model, no torch)"
# Best-effort: loads RapidOCR's bundled ONNX detection/recognition sessions so
# the first dub's thumbnail text localisation isn't slow, and verifies opencv
# imports (its libGL/glib system libs were installed above). If anything fails
# (deps, disk, etc.) the service still works -- the thumbnail just keeps its
# original text plus the banner.
sudo -u "${SERVICE_USER}" env PYTHONPATH="${INSTALL_DIR}" "${INSTALL_DIR}/.venv/bin/python" - <<'PYEOF' \
  || echo "    (thumbnail OCR unavailable -- thumbnails keep their original text; not fatal)"
from youtube_dubber.pipeline import ocr_onnx
engine = ocr_onnx._get_engine()
print("    Thumbnail OCR self-test:", "ready" if engine is not None else "(unavailable -> keep original text)")
PYEOF

echo "==> Installing systemd units"
cp "${INSTALL_DIR}/deploy/youtube-dubber.service" /etc/systemd/system/youtube-dubber.service
cp "${INSTALL_DIR}/deploy/bgutil-pot.service" /etc/systemd/system/bgutil-pot.service
systemctl daemon-reload

# The PO-token provider must be up before a dub downloads; start/restart it now
# (it has no one-time setup, unlike the dubber service below).
echo "==> Starting the PO-token provider"
systemctl enable --now bgutil-pot
systemctl restart bgutil-pot
sleep 1
systemctl is-active --quiet bgutil-pot \
  && echo "    bgutil-pot: running on 127.0.0.1:4416" \
  || echo "    WARNING: bgutil-pot failed to start -- downloads may 403 (run: journalctl -u bgutil-pot)"

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
