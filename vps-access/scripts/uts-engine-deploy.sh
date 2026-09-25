#!/usr/bin/env bash
# uts-engine-deploy.sh -- INSTALLS THE NEW TRADING ENGINE on the trading box in
# Mexico City, beside the old order program, and opens this machine's private
# link to it. Owner, 2026-09-25: "install the new engine on the trading box" --
# GO NOW! (LOOP-2026-09-25-ENGINE.md, P1).
#
# On the trading box:
#   * Node from Debian's own packages (nothing else installed, nothing upgraded);
#   * a system user of its own, uts-engine, that cannot log in;
#   * the engine's code in /opt/uts-engine, taken from the commit this machine
#     last deployed; its data (record, key store, settings) in /var/lib/uts-engine;
#   * a systemd service, uts-engine: listens on the box's own loopback address
#     only, cannot read /home (where the old program lives), runs below the old
#     program's priority with a ceiling on memory and processor, and starts with
#     real orders OFF (this release refuses to switch them on).
# On this machine:
#   * a systemd service, uts-engine-link: an SSH forward from 127.0.0.1:18095
#     here to 127.0.0.1:18095 there, with the key this machine already uses for
#     the trading box. No new key, no new account.
# THE OLD ORDER PROGRAM IS NOT TOUCHED (S1): its program file's fingerprint, its
# env file (size and time only -- never read), whether its master switch file is
# there, and its timers and units are taken before and after, and the run fails
# loudly if any differ. The master switch file is compared by presence alone
# (owner, 2026-09-25): the web box's sync rewrites it every five minutes with a
# fresh stamp inside (mx_executor.py set_arm, the dead-man keepalive), so its
# time and its contents both change on their own, and a deploy that happened to
# span a rewrite was reported as CHANGED. Whether it is there -- armed or not --
# is what a deploy could break, and that is still compared.
# Safe to run again: every step checks before it acts.
set -euo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
PORT=18095
SRC="$HOME/deploy-uts/ultimate-trading-system"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX")

[ -f "$SRC/engine/main.js" ] || { echo "no engine code at $SRC -- deploy-uts.sh has not run"; exit 2; }
COMMIT=$(git -C "$HOME/deploy-uts" rev-parse HEAD)
RELEASE=$(python3 -c "import json;print(json.load(open('$SRC/package.json'))['version'])")
echo "== the engine from ${COMMIT:0:8}, release $RELEASE =="

oldengine() {
  "${SSH[@]}" 'bash -s' <<'R'
echo "program $(sha256sum ~/mx_executor.py | cut -d' ' -f1)"
echo "env $(stat -c '%s %Y' ~/.executor-env 2>/dev/null || echo missing)"
echo "arm $([ -f ~/pilot/ARM ] && echo present || echo absent)"
systemctl list-timers --all --no-pager 2>/dev/null | grep -i -E 'pilot|exec' | awk '{print "timer "$(NF-1)" "$NF}' | sort
systemctl list-unit-files --no-pager 2>/dev/null | grep -i -E 'pilot|exec' | awk '{print "unit "$1" "$2}' | sort
R
}
BEFORE=$(oldengine)
echo "== the old order program, before =="
echo "$BEFORE" | sed 's/^/  /'

# a port on this machine that something else already holds is not taken over
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$PORT\$" && ! systemctl is-active --quiet uts-engine-link; then
  echo "port $PORT is already in use on this machine by something else; stopping"; exit 3
fi

echo "== 1. node on the trading box =="
"${SSH[@]}" 'command -v node >/dev/null || { sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-upgrade nodejs >/dev/null; }; echo "  node $(node -v) | memory free $(free -m | awk "/Mem:/{print \$7}") MB"'

echo "== 2. the engine, its user, its data, its service =="
tar -C "$SRC" -czf - engine | "${SSH[@]}" 'cat > /tmp/uts-engine.tgz'
"${SSH[@]}" "COMMIT=$COMMIT RELEASE=$RELEASE PORT=$PORT bash -s" <<'R'
set -euo pipefail
NODE_BIN=$(command -v node)
[ -n "$NODE_BIN" ] || { echo "  node is not on the trading box"; exit 5; }
id uts-engine >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/uts-engine --shell /usr/sbin/nologin uts-engine
sudo install -d -o uts-engine -g uts-engine -m 700 /var/lib/uts-engine
STAGE=$(mktemp -d)
tar -xzf /tmp/uts-engine.tgz -C "$STAGE"
printf '{"release":"%s","commit":"%s"}\n' "$RELEASE" "$COMMIT" > "$STAGE/engine/VERSION.json"
sudo rm -rf /opt/uts-engine.new /opt/uts-engine.old
sudo cp -r "$STAGE/engine" /opt/uts-engine.new
sudo chown -R root:root /opt/uts-engine.new
sudo chmod -R u=rwX,go=rX /opt/uts-engine.new
if [ -d /opt/uts-engine ]; then sudo mv /opt/uts-engine /opt/uts-engine.old; fi
sudo mv /opt/uts-engine.new /opt/uts-engine
rm -rf "$STAGE" /tmp/uts-engine.tgz
sudo test -f /var/lib/uts-engine/config.json || echo "{\"port\": $PORT, \"liveEnabled\": false}" | sudo -u uts-engine tee /var/lib/uts-engine/config.json >/dev/null
sudo tee /etc/systemd/system/uts-engine.service >/dev/null <<UNIT
[Unit]
Description=UTS trading engine: Paper Books and Live Trading for the Ultimate Trading System, beside the old order program, which it never touches
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=uts-engine
Group=uts-engine
Environment=ENGINE_DATA=/var/lib/uts-engine
WorkingDirectory=/opt/uts-engine
ExecStart=$NODE_BIN /opt/uts-engine/main.js
Restart=always
RestartSec=5
Nice=5
MemoryMax=300M
CPUQuota=50%
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/uts-engine

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable uts-engine >/dev/null 2>&1
sudo systemctl restart uts-engine
ok=0
for i in $(seq 1 25); do if curl -fsS -m 3 "http://127.0.0.1:$PORT/health" -o /tmp/uts-engine-health.json 2>/dev/null; then ok=1; break; fi; sleep 1; done
echo "  service: $(systemctl is-active uts-engine) | answers on the box: $([ $ok = 1 ] && echo yes || echo NO)"
if [ $ok = 1 ]; then
  python3 - <<'PY'
import json
h = json.load(open('/tmp/uts-engine-health.json'))
feeds = ', '.join('prices arriving' if f.get('connected') else 'prices not arriving yet' for f in h.get('feeds', [])) or 'none'
print(f"  release {h.get('release')} | commit {str(h.get('commit'))[:8]} | real orders {h.get('realOrders')} | {feeds} | plans {h.get('plans')} | keys {h.get('keys')} | key store problem {h.get('keystoreProblem')}")
PY
else
  sudo journalctl -u uts-engine --no-pager -n 20 | cut -c1-200 | sed 's/^/  /'
fi
rm -f /tmp/uts-engine-health.json
R

echo "== 3. the private link from this machine =="
cat > /etc/systemd/system/uts-engine-link.service <<UNIT
[Unit]
Description=Private link from this machine to the UTS trading engine on the trading box (127.0.0.1:$PORT here to 127.0.0.1:$PORT there)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/ssh -N -i $KEY -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -L 127.0.0.1:$PORT:127.0.0.1:$PORT $BOX
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable uts-engine-link >/dev/null 2>&1
systemctl restart uts-engine-link
ok=0
for i in $(seq 1 20); do if curl -fsS -m 3 "http://127.0.0.1:$PORT/health" -o /dev/null 2>/dev/null; then ok=1; break; fi; sleep 1; done
echo "  link: $(systemctl is-active uts-engine-link) | the engine answers from this machine: $([ $ok = 1 ] && echo yes || echo NO)"

echo "== the old order program, after =="
AFTER=$(oldengine)
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  unchanged: program fingerprint, env file, master switch, timers and units all as before"
else
  echo "  CHANGED -- before and after differ:"; diff <(echo "$BEFORE") <(echo "$AFTER") | sed 's/^/  /'; exit 4
fi
echo "== done =="
