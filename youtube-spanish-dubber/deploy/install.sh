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

echo "==> Installing the standalone yt-dlp binary (pinned)"
# yt-dlp must track YouTube's changes, but its current releases also dropped
# Python 3.9 -- so we run the self-contained yt-dlp_linux build (it bundles its
# own Python) as a subprocess (youtube_dubber/pipeline/downloader.py),
# independent of the .venv. Excluded from the rsync --delete above so it
# survives between deploys.
#
# PINNED to 2025.10.14 on purpose. This provider-less box can only use the
# token-free android_vr client, and the newer build (2026.06.09) returns no
# usable android_vr formats here -> downloads fail "Requested format is not
# available". 2025.10.14 is the last version android_vr pulls cleanly with (it
# ran in production for days). The durable fix is the Debian 12 box with the
# PO-token provider, where "latest" works at full quality -- unpin it there.
YTDLP_VERSION="2025.10.14"
mkdir -p "${INSTALL_DIR}/bin"
curl -fsSL -o "${INSTALL_DIR}/bin/yt-dlp" \
  "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux"
chmod +x "${INSTALL_DIR}/bin/yt-dlp"
chown "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp"
echo "    yt-dlp $(sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/bin/yt-dlp" --version) (pinned ${YTDLP_VERSION})"

echo "==> Installing the bgutil PO-token provider + yt-dlp plugin"
# 2026 YouTube requires a "Proof of Origin" token for most formats; without one,
# downloads 403 or return no formats. A small localhost provider mints tokens and
# a yt-dlp plugin hands them over. We use the standalone Rust build (jim60105) --
# a single binary + plugin, no Node/Docker -- to match the yt-dlp binary above.
# https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs
POT_REPO="jim60105/bgutil-ytdlp-pot-provider-rs"
POT_RELEASE="https://github.com/${POT_REPO}/releases/latest/download"
POT_JSON="$(curl -fsSL "https://api.github.com/repos/${POT_REPO}/releases/latest" || true)"
echo "    available linux provider assets:"
echo "${POT_JSON}" | grep -oE '"name": *"[^"]*[Ll]inux[^"]*"' | sed -E 's/.*"name": *"([^"]*)".*/      \1/' || true
# Prefer a static musl x86_64 build: this box's OpenSSL is too old (1.1) for the
# glibc build, which needs libssl.so.3.
POT_URL="$(echo "${POT_JSON}" | grep -oE 'https://[^"]*' \
  | grep -iE 'bgutil-pot.*(x86_64|amd64).*musl|x86_64-unknown-linux-musl' | head -n1 || true)"
if [ -z "${POT_URL}" ]; then
  echo "    (no musl build found -- falling back to the glibc build, which needs libssl3)"
  POT_URL="${POT_RELEASE}/bgutil-pot-linux-x86_64"
fi
echo "    downloading: ${POT_URL}"
curl -fsSL -o "${INSTALL_DIR}/bin/bgutil-pot" "${POT_URL}"
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

# The provider's prebuilt binary needs OpenSSL 3 (libssl.so.3); older boxes
# (Debian 11) ship only 1.1 and can't run it. So adapt: if it runs, enable it and
# let the app use yt-dlp's full (token-requiring) clients; if it can't, skip it
# (no restart loop) and pin the app to the PO-token-exempt clients via a drop-in,
# so some videos still download without a provider. Debian 12+ gets the former.
echo "==> Configuring the PO-token provider"
DROPIN_DIR="/etc/systemd/system/youtube-dubber.service.d"
mkdir -p "${DROPIN_DIR}"
if sudo -u "${SERVICE_USER}" "${INSTALL_DIR}/bin/bgutil-pot" --version >/dev/null 2>&1; then
  rm -f "${DROPIN_DIR}/10-no-pot.conf"
  systemctl enable bgutil-pot >/dev/null 2>&1 || true
  systemctl restart bgutil-pot || true
  sleep 2
  systemctl is-active --quiet bgutil-pot \
    && echo "    bgutil-pot running on 127.0.0.1:4416 (full-quality clients enabled)" \
    || echo "    WARNING: bgutil-pot installed but inactive -- see: journalctl -u bgutil-pot"
else
  echo "    bgutil-pot can't run here (needs OpenSSL 3 / libssl.so.3 -- e.g. Debian 11)."
  echo "    Skipping it; restricting yt-dlp to the token-exempt 'android_vr' client instead."
  systemctl disable --now bgutil-pot >/dev/null 2>&1 || true
  # android_vr alone is the reliable token-free path on a provider-less box: it
  # needs no PO token and consistently returns a downloadable muxable format.
  # Widening this to tv,web_embedded made yt-dlp prefer their higher-quality
  # formats -- which ARE PO-token-gated here -- so it skipped them and failed
  # with "Requested format is not available". Keep it to the one client that
  # works until the provider (Debian 12 + OpenSSL 3) can mint tokens.
  printf '[Service]\nEnvironment=DUBBER_YTDLP_PLAYER_CLIENTS=android_vr\n' \
    > "${DROPIN_DIR}/10-no-pot.conf"
fi
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

# === TEMP PoC (remove after): Node-based PO-token provider, end to end ========
# Proves the whole chain on THIS box before we wire it in permanently: portable
# Node 20 -> build the Brainicism provider -> run it on :4416 -> yt-dlp mints a
# token via the plugin and actually downloads the video that 403s today. All in
# /tmp, non-fatal, cleaned up. Kept LAST so its output survives tail-truncation.
( set +e
  echo "########## [POC] Node PO-token provider end-to-end ##########"
  echo "glibc: $(ldd --version 2>&1 | head -1)"
  T=/tmp/potpoc; rm -rf "$T"; mkdir -p "$T"
  # 1) portable Node 20 (bundles its own TLS -> no system OpenSSL 3 needed)
  NT=$(curl -fsSL https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt 2>/dev/null | grep -oE 'node-v20[0-9.]+-linux-x64\.tar\.xz' | head -1)
  echo "node tarball: ${NT:-<none>}"
  curl -fsSL -o "$T/node.tar.xz" "https://nodejs.org/dist/latest-v20.x/${NT}" && tar -xJf "$T/node.tar.xz" -C "$T"
  export PATH="$T/${NT%.tar.xz}/bin:$PATH"
  echo "node: $(node -v 2>&1)  npm: $(npm -v 2>&1)"
  # 2) build the provider server (pinned tag)
  git clone --quiet --depth 1 --single-branch --branch 1.3.1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$T/prov" 2>&1 | tail -1
  ( cd "$T/prov/server" && if npm ci >"$T/npm.log" 2>&1 && npx tsc >"$T/tsc.log" 2>&1; then echo "build: OK"; else echo "build: FAILED"; tail -4 "$T/npm.log" "$T/tsc.log" 2>/dev/null | sed 's/^/   /'; fi )
  # 3) start it on 4416
  ( cd "$T/prov/server" && nohup node build/main.js --port 4416 >"$T/server.log" 2>&1 & echo $! >"$T/pid" )
  sleep 5
  echo "server log:"; tail -3 "$T/server.log" 2>/dev/null | sed 's/^/   /'
  # 4a) use the LATEST yt-dlp binary here (the pinned 2025.10.14 may be too old
  #     for the current plugin -- which is why it registered no PO provider).
  curl -fsSL -o "$T/ytdlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && chmod +x "$T/ytdlp"
  echo "yt-dlp (latest): $($T/ytdlp --version 2>&1)"
  # 4b) install the plugin, version-matched to the server (1.3.1), into a plugin dir
  "${INSTALL_DIR}/.venv/bin/pip" install --quiet --no-deps --target "$T/plugin" "bgutil-ytdlp-pot-provider==1.3.1" >"$T/pip.log" 2>&1 && echo "plugin: installed 1.3.1" || { echo "plugin: FAILED"; tail -3 "$T/pip.log" | sed 's/^/   /'; }
  echo "plugin layout: $(find "$T/plugin/yt_dlp_plugins" -name '*.py' 2>/dev/null | sed "s#$T/plugin/##" | tr '\n' ' ')"
  # 5) the real test: download the video that 403s today, default clients + token
  echo "=== yt-dlp(latest) download WITH provider (default clients) ==="
  "$T/ytdlp" -v --plugin-dirs "$T/plugin" \
     --cookies "${INSTALL_DIR}/secrets/youtube_cookies.txt" \
     -f "bv*[height<=360]+ba/b[height<=360]/w" -o "$T/out.%(ext)s" \
     "https://www.youtube.com/watch?v=Dj5OYkgDtHU" 2>&1 \
     | grep -iE 'plugin|PO Token|GetPOT|bgutil|fetching pot|403|forbidden|Downloading [0-9]+ format|Destination|Merging|ERROR|Traceback' | tail -18
  echo "RESULT FILE: $(ls -lh $T/out.* 2>/dev/null | awk '{print $5, $NF}' | tr '\n' ' ' || echo NONE)"
  kill "$(cat $T/pid 2>/dev/null)" 2>/dev/null; rm -rf "$T"
  echo "########## [POC] end ##########"
) || true
# === END TEMP PoC ============================================================
