#!/bin/sh
# INSTALL THE TRADING ENGINE ON THIS MAC.
# Shown on the Compute tab, step 2 of the engine's checklist, as:
#   curl -fsSL <this system>/engine-link/install/mac.sh | sudo sh -s -- <this system> <short name> <install code>
#
# What it does, and nothing else:
#   * the engine's program in /usr/local/uts-engine-<short name>, its data
#     (record, lock, keys) in /usr/local/var/uts-engine-<short name>, readable by
#     your account alone;
#   * a launch daemon, uts.engine.<short name>, that starts it when the Mac starts
#     and again if it stops, running as your account, with real orders off.
# Node.js 18 or newer must already be installed (nodejs.org). The engine then
# calls this system with the install code and is given a password of its own.
# Nothing is opened on this Mac for anyone to come in: the engine calls out.
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
OWNER="${SUDO_USER:-}"
[ -n "$OWNER" ] && [ "$OWNER" != root ] || { echo "run it with sudo from your own account, so the engine runs as you"; exit 2; }

NODE=""
for n in "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$n" ] && [ -x "$n" ]; then NODE="$n"; break; fi
done
[ -n "$NODE" ] || { echo "Node.js is not installed: install Node.js 18 or newer from nodejs.org, then run this again"; exit 4; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 18 ] || { echo "Node.js $("$NODE" -v) is too old: 18 or newer is needed"; exit 4; }

NAME="uts-engine-$SHORT"
LABEL="uts.engine.$SHORT"
APP="/usr/local/$NAME"
DATA="/usr/local/var/$NAME"
PLIST="/Library/LaunchDaemons/$LABEL.plist"

mkdir -p "$DATA"
chown "$OWNER" "$DATA"
chmod 700 "$DATA"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "${BASE}engine-link/release" -o "$TMP/release.json"
curl -fsSL "${BASE}engine-link/package" -o "$TMP/engine.tgz"
WANT=$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha256)' "$TMP/release.json")
GOT=$(shasum -a 256 "$TMP/engine.tgz" | cut -d' ' -f1)
[ "$WANT" = "$GOT" ] || { echo "the package did not match its fingerprint; nothing was installed"; exit 5; }
mkdir "$TMP/engine"
tar -xzf "$TMP/engine.tgz" -C "$TMP/engine"
[ -f "$TMP/engine/main.js" ] || { echo "the package has no engine in it; nothing was installed"; exit 5; }
RELEASE=$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).release)' "$TMP/engine/VERSION.json")

rm -rf "$APP.new"
cp -R "$TMP/engine" "$APP.new"
chown -R root:wheel "$APP.new"
chmod -R u=rwX,go=rX "$APP.new"
if [ -d "$APP" ]; then rm -rf "$APP.old"; mv "$APP" "$APP.old"; fi
mv "$APP.new" "$APP"

umask 077
printf '{"link":{"url":"%s","code":"%s"}}\n' "$BASE" "$CODE" > "$DATA/config.json"
rm -f "$DATA/link.json" "$DATA/link-status.json"
chown "$OWNER" "$DATA/config.json"
chmod 600 "$DATA/config.json"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>UserName</key><string>$OWNER</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$APP/main.js</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>ENGINE_DATA</key><string>$DATA</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$DATA/engine.log</string>
  <key>StandardErrorPath</key><string>$DATA/engine.log</string>
</dict>
</plist>
EOF
chown root:wheel "$PLIST"
chmod 644 "$PLIST"
launchctl bootout "system/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap system "$PLIST"

echo "release $RELEASE installed as $LABEL; waiting for it to call in"
i=0
while [ $i -lt 30 ]; do
  if [ -f "$DATA/link-status.json" ] && grep -q '"linked":true' "$DATA/link-status.json"; then
    LOCK=$(sed -n 's/.*"lock":"\([^"]*\)".*/\1/p' "$DATA/link-status.json")
    echo "done: the engine called in and is linked to this system."
    echo "the fingerprint of its lock is $LOCK -- the Account tab shows the same beside the keys for this engine."
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done
echo "installed, but it has not called in yet. What it last said:"
cat "$DATA/link-status.json" 2>/dev/null || echo "  nothing yet -- see $DATA/engine.log"
exit 6
