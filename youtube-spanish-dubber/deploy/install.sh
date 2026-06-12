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
  ffmpeg python3 python3-venv python3-pip rsync ca-certificates curl psmisc \
  fonts-dejavu-core \
  libgl1 libglib2.0-0
  # psmisc: provides `fuser`, used to free port 4416 before (re)starting the
  #   PO-token provider so a stale holder can't wedge it (EADDRINUSE).
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
  --exclude 'node' --exclude 'pot-provider' --exclude 'models' \
  "${REPO_DIR}/" "${INSTALL_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Creating Python virtualenv and installing dependencies (this can take a while)"
sudo -u "${SERVICE_USER}" python3 -m venv "${INSTALL_DIR}/.venv"
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip wheel
sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/.venv/bin/pip" install -r "${INSTALL_DIR}/requirements.txt"

echo "==> Installing the latest standalone yt-dlp binary"
# yt-dlp must track YouTube's changes, but its current releases also dropped
# Python 3.9 -- so we run the self-contained yt-dlp_linux build (it bundles its
# own Python) as a subprocess (youtube_dubber/pipeline/downloader.py),
# independent of the .venv. Excluded from the rsync --delete above so it
# survives between deploys. We fetch "latest" because the PO-token provider
# (below) pairs with current yt-dlp; the token framework + plugin API move
# quickly, and an older binary won't register the provider plugin.
mkdir -p "${INSTALL_DIR}/bin"
curl -fsSL -o "${INSTALL_DIR}/bin/yt-dlp" \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x "${INSTALL_DIR}/bin/yt-dlp"
chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp"
echo "    yt-dlp $(sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp" --version)"

echo "==> Installing the Node-based PO-token provider + yt-dlp plugin"
# 2026 YouTube requires a "Proof of Origin" token for real formats; without one
# the player response is storyboards-only and the media URLs 403. A localhost
# provider mints tokens and a yt-dlp plugin hands them over. We run the
# Brainicism *Node* provider rather than the Rust build: Node bundles its own TLS
# (BoringSSL), so it runs on this box's OpenSSL 1.1 -- the Rust binary needs
# OpenSSL 3 / libssl.so.3, which Debian 11 doesn't have. Verified end to end on
# this box: provider + yt-dlp default clients + NO cookies -> full format ladder
# and clean downloads. https://github.com/Brainicism/bgutil-ytdlp-pot-provider
PROVIDER_TAG="1.3.1"

# Portable Node 20 (>=20 required by the provider). The official linux-x64 build
# needs only glibc >= 2.28 (Debian 11 has 2.31). Kept across deploys.
NODE_DIR="${INSTALL_DIR}/node"
if [ ! -x "${NODE_DIR}/bin/node" ]; then
  echo "    fetching portable Node 20"
  NODE_TARBALL="$(curl -fsSL https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt \
    | grep -oE 'node-v20[0-9.]+-linux-x64\.tar\.xz' | head -n1)"
  curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/latest-v20.x/${NODE_TARBALL}"
  rm -rf "${NODE_DIR}"; mkdir -p "${NODE_DIR}"
  tar -xJf /tmp/node.tar.xz -C "${NODE_DIR}" --strip-components=1
  rm -f /tmp/node.tar.xz
fi
echo "    node $(${NODE_DIR}/bin/node -v)"

# Build the provider server once (clone tag -> npm ci -> tsc). Kept across deploys.
PROVIDER_DIR="${INSTALL_DIR}/pot-provider"
if [ ! -f "${PROVIDER_DIR}/server/build/main.js" ]; then
  echo "    building the bgutil provider (${PROVIDER_TAG})"
  rm -rf "${PROVIDER_DIR}"
  git clone --quiet --depth 1 --single-branch --branch "${PROVIDER_TAG}" \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "${PROVIDER_DIR}"
  ( cd "${PROVIDER_DIR}/server" \
      && PATH="${NODE_DIR}/bin:${PATH}" npm ci >/dev/null 2>&1 \
      && PATH="${NODE_DIR}/bin:${PATH}" npx tsc >/dev/null 2>&1 ) \
    && echo "    provider built" || echo "    WARNING: provider build failed"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${NODE_DIR}" "${PROVIDER_DIR}"

# The matching yt-dlp plugin, in the layout the binary needs: --plugin-dirs ROOT
# searches ROOT/*/yt_dlp_plugins, so install the package UNDER a subdir (bgutil/).
# (Putting yt_dlp_plugins directly in ROOT silently loads nothing on modern yt-dlp.)
PLUGIN_DIR="${INSTALL_DIR}/yt-dlp-plugins"
rm -rf "${PLUGIN_DIR}"; mkdir -p "${PLUGIN_DIR}/bgutil"
# Run pip as root into the root-owned plugin dir (it's just files; the service
# reads them after the chown below), then hand the whole tree to the service user.
"${INSTALL_DIR}/.venv/bin/pip" install --quiet --no-deps \
  --target "${PLUGIN_DIR}/bgutil" "bgutil-ytdlp-pot-provider==${PROVIDER_TAG}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${PLUGIN_DIR}"

echo "==> Installing the speech-separation model (MDX-Net ONNX, for 'music' audio mode)"
# Removes the source-language speech from the original audio (keeping music/SFX)
# so the Spanish narration sits over a clean bed -- onnxruntime + numpy only, no
# torch (pipeline/separate.py). ~64 MB; kept across deploys (excluded from rsync
# --delete). Non-fatal: if the download fails, 'music' mode falls back to 'replace'.
MODELS_DIR="${INSTALL_DIR}/models"
SEP_MODEL="${MODELS_DIR}/uvr_mdx_inst.onnx"
mkdir -p "${MODELS_DIR}"
if [ ! -f "${SEP_MODEL}" ]; then
  if curl -fsSL -o "${SEP_MODEL}" \
      "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx"; then
    echo "    downloaded $(du -h "${SEP_MODEL}" | cut -f1)"
  else
    echo "    WARNING: separator model download failed -- 'music' mode will fall back to 'replace'"
    rm -f "${SEP_MODEL}"
  fi
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${MODELS_DIR}"

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

# The Node provider runs on this box (its own TLS), so always enable it and let
# the app use yt-dlp's default clients -- no token-exempt fallback. Remove any
# stale drop-in from the old "no provider here" era.
echo "==> Enabling the PO-token provider service"
DROPIN_DIR="/etc/systemd/system/youtube-dubber.service.d"
rm -f "${DROPIN_DIR}/10-no-pot.conf"
# Free port 4416 of any stale holder before (re)starting, or the new instance
# hits EADDRINUSE and exits. Stop our own unit, then kill anything still bound.
systemctl stop bgutil-pot >/dev/null 2>&1 || true
fuser -k 4416/tcp >/dev/null 2>&1 || true
pkill -f 'server/build/main.js --port 4416' >/dev/null 2>&1 || true
sleep 1
systemctl enable bgutil-pot >/dev/null 2>&1 || true
systemctl restart bgutil-pot || true
sleep 3
systemctl daemon-reload
if systemctl is-active --quiet bgutil-pot; then
  echo "    bgutil-pot running on 127.0.0.1:4416"
  # Non-fatal end-to-end self-test: count real (non-storyboard) formats a token
  # unlocks for a sample video. >0 means the provider chain is healthy.
  SAMPLE="https://www.youtube.com/watch?v=Dj5OYkgDtHU"
  N=$(sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp" --no-warnings \
        --plugin-dirs "${PLUGIN_DIR}" -J --skip-download "${SAMPLE}" 2>/dev/null \
        | "${INSTALL_DIR}/.venv/bin/python" -c "import sys,json;d=json.load(sys.stdin);print(sum(1 for f in d.get('formats',[]) if f.get('vcodec') not in (None,'none') or f.get('acodec') not in (None,'none')))" 2>/dev/null || echo 0)
  echo "    provider self-test: ${N:-0} real formats for the sample video (0 = problem)"
else
  echo "    WARNING: bgutil-pot inactive -- downloads will fail. See: journalctl -u bgutil-pot"
fi

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
