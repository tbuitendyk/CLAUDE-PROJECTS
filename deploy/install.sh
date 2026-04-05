#!/usr/bin/env bash
# KJV MCP Server — Debian 12 installer
# Run as root: bash install.sh <your-domain> [api-key]
#
# What this script does:
#   1. Installs system packages (Python 3, nginx, certbot, git)
#   2. Creates a dedicated 'kjvmcp' system user
#   3. Clones/updates the repo to /opt/kjv-mcp
#   4. Creates a Python virtualenv and installs requirements
#   5. Downloads the KJV Bible data
#   6. Writes /etc/kjv-mcp/env (environment variables)
#   7. Installs and starts the systemd service
#   8. Installs the nginx config and obtains an SSL certificate

set -euo pipefail

# ── Arguments ──────────────────────────────────────────────────────────────
DOMAIN="${1:-}"
API_KEY="${2:-}"

if [[ -z "$DOMAIN" ]]; then
    echo "Usage: bash install.sh <your-domain> [api-key]"
    echo "  e.g. bash install.sh kjv.example.com my-secret-key"
    exit 1
fi

if [[ $EUID -ne 0 ]]; then
    echo "Please run as root (sudo bash install.sh ...)"
    exit 1
fi

REPO_URL="https://github.com/tbuitendyk/Claude-1.git"
BRANCH="claude/kjv-verse-lookup-tool-uqHWx"
INSTALL_DIR="/opt/kjv-mcp"
SERVICE_USER="kjvmcp"
ENV_FILE="/etc/kjv-mcp/env"

echo "=== KJV MCP Server Installer ==="
echo "Domain  : $DOMAIN"
echo "API key : ${API_KEY:-<none — server will be open>}"
echo ""

# ── 1. System packages ──────────────────────────────────────────────────────
echo "--- Installing system packages ---"
apt-get update -qq
apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    nginx certbot python3-certbot-nginx \
    git curl

# ── 2. Dedicated system user ────────────────────────────────────────────────
echo "--- Creating system user '$SERVICE_USER' ---"
id "$SERVICE_USER" &>/dev/null || \
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"

# ── 3. Clone / update repo ──────────────────────────────────────────────────
echo "--- Deploying code to $INSTALL_DIR ---"
if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "    Updating existing clone..."
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
    echo "    Cloning fresh..."
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ── 4. Python virtualenv ────────────────────────────────────────────────────
echo "--- Setting up Python virtualenv ---"
if [[ ! -d "$INSTALL_DIR/venv" ]]; then
    python3 -m venv "$INSTALL_DIR/venv"
fi
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/venv"

# ── 5. Download KJV data ────────────────────────────────────────────────────
echo "--- Downloading KJV Bible data ---"
if [[ ! -f "$INSTALL_DIR/kjv.json" ]]; then
    sudo -u "$SERVICE_USER" "$INSTALL_DIR/venv/bin/python" \
        "$INSTALL_DIR/download_kjv.py"
else
    echo "    kjv.json already present, skipping download."
fi

# ── 6. Environment file ─────────────────────────────────────────────────────
echo "--- Writing environment file $ENV_FILE ---"
mkdir -p /etc/kjv-mcp
chmod 750 /etc/kjv-mcp
chown root:"$SERVICE_USER" /etc/kjv-mcp

cat > "$ENV_FILE" <<EOF
TRANSPORT=http
PORT=8000
BASE_URL=https://${DOMAIN}
API_KEY=${API_KEY}
EOF

chmod 640 "$ENV_FILE"
chown root:"$SERVICE_USER" "$ENV_FILE"

# ── 7. Systemd service ──────────────────────────────────────────────────────
echo "--- Installing systemd service ---"
cp "$INSTALL_DIR/deploy/kjv-mcp.service" /etc/systemd/system/kjv-mcp.service
systemctl daemon-reload
systemctl enable kjv-mcp
systemctl restart kjv-mcp
echo "    Service status:"
systemctl status kjv-mcp --no-pager -l | head -20

# ── 8. nginx + SSL ──────────────────────────────────────────────────────────
echo "--- Configuring nginx ---"
# Install config with the real domain substituted in
sed "s/YOUR_DOMAIN/${DOMAIN}/g" \
    "$INSTALL_DIR/deploy/nginx-kjv-mcp.conf" \
    > /etc/nginx/sites-available/kjv-mcp

# Disable default site if still enabled
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kjv-mcp /etc/nginx/sites-enabled/kjv-mcp

# Validate config before reloading
nginx -t
systemctl reload nginx

echo "--- Obtaining SSL certificate for $DOMAIN ---"
echo "    (Make sure DNS for $DOMAIN points to this server's public IP first!)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email \
    --redirect

systemctl reload nginx

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Installation complete ==="
echo ""
echo "MCP server URL : https://${DOMAIN}/mcp"
echo "Health check   : https://${DOMAIN}/health"
if [[ -n "$API_KEY" ]]; then
echo "API key        : $API_KEY"
fi
echo ""
echo "Useful commands:"
echo "  sudo systemctl status kjv-mcp       # service status"
echo "  sudo journalctl -u kjv-mcp -f       # live logs"
echo "  sudo systemctl restart kjv-mcp      # restart"
echo "  sudo nano /etc/kjv-mcp/env          # edit env vars"
echo ""
echo "To update to the latest code:"
echo "  sudo bash ${INSTALL_DIR}/deploy/update.sh"
