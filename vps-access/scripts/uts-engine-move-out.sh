#!/usr/bin/env bash
# uts-engine-move-out.sh -- MOVES THE MEXICO ENGINE TO CALLING OUT (owner,
# 2026-09-25, GO NOW! for "all changes necessary for the proposed design": the
# engine connects out to our server and keeps that connection open; nothing
# ever connects in; "it ... reverses the direction of today's link").
#
# The engine on the trading box, mx-engine, is reached today through this
# machine's SSH tunnel (uts-engine-link). After this it calls this system at
# https://www.buitendyk.ca/uts/ itself, and the tunnel is stopped and removed:
#   1. refuses unless the engine holds no plan (nothing waiting, armed or open);
#   2. asks this machine's service for a one-time code for mx-engine (its
#      record stays the same record: short name, names, setups, its history);
#   3. sends the engine's program from the commit this machine last deployed to
#      /opt/uts-engine, exactly as uts-engine-deploy.sh does, and rewrites the
#      engine's settings: the tunnel's port goes, the address and code come in;
#      its fee and delay settings stay as they are;
#   4. restarts it and waits for it to call in (the service's own record says so);
#   5. stops, disables and removes the tunnel unit on this machine.
# THE OLD ORDER PROGRAM IS NOT TOUCHED: its program file's fingerprint, its env
# file (size and time only -- never read), whether its master switch file is
# there, and its timers and units are taken before and after, and the run
# fails loudly if any differ. Its data, keys and record are not touched either:
# /var/lib/uts-engine keeps its record, key store and new lock.
set -euo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
PORT=18095
ENGINE_ID=mx-engine
PUBLIC=https://www.buitendyk.ca/uts/
WEB=http://127.0.0.1:8094
SRC="$HOME/deploy-uts/ultimate-trading-system"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX")

[ -f "$SRC/engine/link.js" ] || { echo "no engine with a link at $SRC -- deploy-uts.sh has not shipped 3.266.0 or later"; exit 2; }
COMMIT=$(git -C "$HOME/deploy-uts" rev-parse HEAD)
RELEASE=$(python3 -c "import json;print(json.load(open('$SRC/package.json'))['version'])")
echo "== moving $ENGINE_ID to calling out, with the engine from ${COMMIT:0:8}, release $RELEASE =="

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

echo "== 1. the engine holds no plan =="
H=$(curl -fsS -m 8 "http://127.0.0.1:$PORT/health" || true)
[ -n "$H" ] || { echo "  the engine does not answer through the tunnel; nothing was changed"; exit 3; }
ACTIVE=$(echo "$H" | python3 -c "import json,sys; print(json.load(sys.stdin).get('plans',{}).get('active',-1))")
[ "$ACTIVE" = "0" ] || { echo "  the engine is watching $ACTIVE plan(s); moving it waits until it holds none. Nothing was changed."; exit 3; }
echo "  none waiting, armed or open"

echo "== 2. a one-time code from this machine's service =="
CODE=$(curl -fsS -m 10 -X POST -H 'Content-Type: application/json' -d '{}' "$WEB/api/live/engines/$ENGINE_ID/move" | python3 -c "import json,sys; print(json.load(sys.stdin)['code'])")
echo "$CODE" | grep -Eq '^UTS(-[A-Z0-9]{4}){6}$' || { echo "  no code came back; nothing was changed"; exit 4; }
echo "  made (shown nowhere; good for an hour, once)"

echo "== 3. the engine's program, and its settings with the address and code =="
tar -C "$SRC" -czf - engine | "${SSH[@]}" 'cat > /tmp/uts-engine.tgz'
"${SSH[@]}" "COMMIT=$COMMIT RELEASE=$RELEASE PUBLIC=$PUBLIC CODE=$CODE bash -s" <<'R'
set -euo pipefail
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
# the settings: the tunnel's port goes, the address and the code come in, the rest stays
sudo cat /var/lib/uts-engine/config.json | PUBLIC="$PUBLIC" CODE="$CODE" python3 -c "
import json, os, sys
c = json.load(sys.stdin)
c.pop('port', None)
c['liveEnabled'] = False
c['link'] = {'url': os.environ['PUBLIC'], 'code': os.environ['CODE']}
print(json.dumps(c))" | sudo -u uts-engine tee /var/lib/uts-engine/config.json.new >/dev/null
sudo -u uts-engine chmod 600 /var/lib/uts-engine/config.json.new
sudo -u uts-engine mv /var/lib/uts-engine/config.json.new /var/lib/uts-engine/config.json
sudo -u uts-engine rm -f /var/lib/uts-engine/link.json /var/lib/uts-engine/link-status.json
sudo systemctl restart uts-engine
echo "  program in place, settings rewritten, service restarted: $(systemctl is-active uts-engine)"
R

echo "== 4. waiting for it to call in =="
ok=0
for i in $(seq 1 45); do
  if curl -fsS -m 8 "$WEB/api/live/engines" | python3 -c "
import json, sys
d = json.load(sys.stdin)
e = [x for x in d.get('engines', []) if x['id'] == '$ENGINE_ID']
sys.exit(0 if e and e[0].get('linkKind') == 'calls-out' and (e[0].get('link') or {}).get('following') and e[0].get('answers') else 1)" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
if [ $ok = 1 ]; then
  curl -fsS -m 8 "$WEB/api/live/engines" | python3 -c "
import json, sys
e = [x for x in json.load(sys.stdin)['engines'] if x['id'] == '$ENGINE_ID'][0]
h = e.get('health') or {}
print(f\"  called in: release {h.get('release')} | real orders {h.get('realOrders')} | plans {h.get('plans')} | lock {(e.get('lock') or {}).get('fingerprint')} | machine {(e.get('machine') or {}).get('hostname')}\")"
else
  echo "  it has NOT called in within 90 seconds; the tunnel is left up and nothing more is changed. What it said:"
  "${SSH[@]}" 'sudo cat /var/lib/uts-engine/link-status.json 2>/dev/null; sudo journalctl -u uts-engine --no-pager -n 15 | cut -c1-200' | sed 's/^/  /'
fi

if [ $ok = 1 ]; then
  echo "== 5. the tunnel on this machine goes =="
  systemctl stop uts-engine-link 2>/dev/null || true
  systemctl disable uts-engine-link >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/uts-engine-link.service
  systemctl daemon-reload
  echo "  uts-engine-link: $(systemctl is-active uts-engine-link 2>/dev/null || true) (removed)"
fi

echo "== the old order program, after =="
AFTER=$(oldengine)
if [ "$BEFORE" = "$AFTER" ]; then
  echo "  unchanged: program fingerprint, env file, master switch, timers and units all as before"
else
  echo "  CHANGED -- before and after differ:"; diff <(echo "$BEFORE") <(echo "$AFTER") | sed 's/^/  /'; exit 5
fi
[ $ok = 1 ] || exit 6
echo "== done =="
