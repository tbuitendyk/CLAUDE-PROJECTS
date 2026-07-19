#!/usr/bin/env bash
# setup-mailvm-agent.sh -- install a persistent systemd ssh-agent that auto-loads
# /root/.ssh/id_ed25519 at boot using the stored passphrase, so headless
# host->mail-VM SSH works. Requires MAILVM_KEY_PASSPHRASE in /etc/deploy-control/env.
set -euo pipefail
ENVFILE=/etc/deploy-control/env
KEY=/root/.ssh/id_ed25519
SOCK=/run/mailvm-ssh-agent.sock

grep -q '^MAILVM_KEY_PASSPHRASE=' "$ENVFILE" || { echo "MAILVM_KEY_PASSPHRASE not in $ENVFILE -- add it first." >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "missing $KEY" >&2; exit 1; }

# askpass helper: prints the stored key passphrase (root-only)
cat > /usr/local/sbin/mailvm-askpass.sh <<'ASK'
#!/usr/bin/env bash
sed -n 's/^MAILVM_KEY_PASSPHRASE=//p' /etc/deploy-control/env | head -1
ASK
chmod 700 /usr/local/sbin/mailvm-askpass.sh

# loader: run by the service once the agent socket is up
cat > /usr/local/sbin/mailvm-agent-load.sh <<'LOADER'
#!/usr/bin/env bash
set -euo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
export SSH_ASKPASS=/usr/local/sbin/mailvm-askpass.sh
export SSH_ASKPASS_REQUIRE=force
for i in 1 2 3 4 5 6; do [ -S "$SSH_AUTH_SOCK" ] && break; sleep 0.5; done
ssh-add /root/.ssh/id_ed25519 </dev/null
LOADER
chmod 700 /usr/local/sbin/mailvm-agent-load.sh

cat > /etc/systemd/system/mailvm-ssh-agent.service <<'UNIT'
[Unit]
Description=Persistent ssh-agent with the mail-VM key loaded
After=network-online.target

[Service]
Type=simple
Environment=SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ExecStartPre=-/bin/rm -f /run/mailvm-ssh-agent.sock
ExecStart=/usr/bin/ssh-agent -D -a /run/mailvm-ssh-agent.sock
ExecStartPost=/usr/local/sbin/mailvm-agent-load.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now mailvm-ssh-agent.service
sleep 2
echo "=== keys loaded in the agent ==="
SSH_AUTH_SOCK="$SOCK" ssh-add -l 2>&1 || true
echo "=== test host->mail-VM SSH via the agent ==="
SSH_AUTH_SOCK="$SOCK" ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 \
  root@192.168.56.129 'echo CONNECTED_OK; id -un; (test -r /var/log/mail.log && echo LOG_READABLE || echo LOG_UNREADABLE)' 2>&1 | tail -6
