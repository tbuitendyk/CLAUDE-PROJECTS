#!/bin/sh
# INSTALL THE TRADING PLATFORM ON THIS MACHINE (Linux with systemd).
# Shown on the Compute tab, step 2 of the platform's checklist, as:
#   curl -fsSL <this system>/engine-link/install/linux.sh | sudo sh -s -- <this system> <short name> <install code>
#
# What it does, and nothing else:
#   * Node.js from the system's own packages if it is missing (nothing upgraded);
#   * a system account of the platform's own, uts-<short name>, that cannot sign in;
#   * the engine's program in /opt/uts-engine-<short name>, its data (record,
#     lock, keys) in /var/lib/uts-engine-<short name>, readable by that account alone;
#   * a service, uts-engine-<short name>, that cannot read /home, is held to
#     300 MB of memory and half a CPU, and starts with real orders off.
# The platform then calls this system with the install code and is given a
# password of its own. Nothing is opened on this machine for anyone to come in:
# the platform calls out, and this system keeps only a fingerprint of its password.
# Run again with a new code, it replaces the program and keeps the record, the
# lock and the keys.
set -eu

BASE="${1:-}"
SHORT="${2:-}"
CODE="${3:-}"
case "$BASE" in https://*/|http://127.0.0.1:*/) ;; *) echo "the first word must be this system's address, ending in /"; exit 2 ;; esac
echo "$SHORT" | grep -Eq '^[a-z0-9][a-z0-9-]{1,29}$' || { echo "the short name must be 2 to 30 of a-z, 0-9 and -"; exit 2; }
echo "$CODE" | grep -Eq '^UTS(-[A-Z0-9]{4}){6}$' || { echo "that does not look like an install code: make a new install command on the Compute tab"; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 2; }
command -v systemctl >/dev/null 2>&1 || { echo "this machine has no systemd; this installer is for Linux with systemd"; exit 3; }
command -v curl >/dev/null 2>&1 || { echo "curl is needed"; exit 3; }

NODE=$(command -v node || true)
if [ -z "$NODE" ] && command -v apt-get >/dev/null 2>&1; then
  echo "installing Node.js from the system's own packages"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-upgrade nodejs >/dev/null
  NODE=$(command -v node || true)
fi
[ -n "$NODE" ] || { echo "Node.js is not installed and could not be installed here: install Node.js 18 or newer, then run this again"; exit 4; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 18 ] || { echo "Node.js $("$NODE" -v) is too old: 18 or newer is needed"; exit 4; }

NAME="uts-engine-$SHORT"
ACCT="uts-$SHORT"
APP="/opt/$NAME"
DATA="/var/lib/$NAME"

id "$ACCT" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$ACCT"
install -d -o "$ACCT" -g "$ACCT" -m 700 "$DATA"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "${BASE}engine-link/release" -o "$TMP/release.json"
curl -fsSL "${BASE}engine-link/package" -o "$TMP/engine.tgz"
WANT=$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha256)' "$TMP/release.json")
GOT=$(sha256sum "$TMP/engine.tgz" | cut -d' ' -f1)
[ "$WANT" = "$GOT" ] || { echo "the package did not match its fingerprint; nothing was installed"; exit 5; }
mkdir "$TMP/engine"
tar -xzf "$TMP/engine.tgz" -C "$TMP/engine"
[ -f "$TMP/engine/main.js" ] || { echo "the package has no program in it; nothing was installed"; exit 5; }
RELEASE=$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).release)' "$TMP/engine/VERSION.json")

# the program: owned by root, read by all, written by nobody else
rm -rf "$APP.new"
cp -r "$TMP/engine" "$APP.new"
chown -R root:root "$APP.new"
chmod -R u=rwX,go=rX "$APP.new"
if [ -d "$APP" ]; then rm -rf "$APP.old"; mv "$APP" "$APP.old"; fi
mv "$APP.new" "$APP"

# where to call, and the one-time code: the engine turns it into its own password on its first start
umask 077
printf '{"link":{"url":"%s","code":"%s"}}\n' "$BASE" "$CODE" > "$DATA/config.json"
rm -f "$DATA/link.json" "$DATA/link-status.json"
chown "$ACCT:$ACCT" "$DATA/config.json"
chmod 600 "$DATA/config.json"

cat > "/etc/systemd/system/$NAME.service" <<EOF
[Unit]
Description=UTS trading platform $SHORT (calls out to $BASE)
After=network-online.target
Wants=network-online.target

[Service]
User=$ACCT
Group=$ACCT
Environment=ENGINE_DATA=$DATA
ExecStart=$NODE $APP/main.js
Restart=always
RestartSec=5
Nice=5
CPUWeight=50
CPUQuota=50%
MemoryMax=300M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$NAME" >/dev/null 2>&1
systemctl restart "$NAME"

echo "release $RELEASE installed as the service $NAME; waiting for it to call in"
i=0
while [ $i -lt 30 ]; do
  if [ -f "$DATA/link-status.json" ] && grep -q '"linked":true' "$DATA/link-status.json"; then
    LOCK=$(sed -n 's/.*"lock":"\([^"]*\)".*/\1/p' "$DATA/link-status.json")
    echo "done: the platform called in and is linked to this system."
    echo "the fingerprint of its lock is $LOCK -- the Account tab shows the same beside the keys for this platform."
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done
echo "installed, but it has not called in yet. What it last said:"
cat "$DATA/link-status.json" 2>/dev/null || echo "  nothing yet -- see: journalctl -u $NAME -n 30"
exit 6
