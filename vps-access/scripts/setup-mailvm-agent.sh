#!/usr/bin/env bash
# setup-mailvm-agent.sh -- install a persistent systemd ssh-agent that auto-loads
# /root/.ssh/id_ed25519 at boot using the stored passphrase, so headless
# host->mail-VM SSH works. Reads the passphrase from /etc/deploy-control/env as
# MAILVM_KEY_PASSPHRASE_B64 (base64, preferred) or MAILVM_KEY_PASSPHRASE (plaintext).
# NOTE: base64 is obfuscation, not encryption -- anyone with root can still decode it.
set -euo pipefail
ENVFILE=/etc/deploy-control/env
KEY=/root/.ssh/id_ed25519
SOCK=/run/mailvm-ssh-agent.sock

grep -qE '^MAILVM_KEY_PASSPHRASE(_B64)?=' "$ENVFILE" \
  || { echo "no MAILVM_KEY_PASSPHRASE[_B64] in $ENVFILE -- add it first." >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "missing $KEY" >&2; exit 1; }

# askpass helper: prints the key passphrase (base64-decoded if the _B64 form is set)
cat > /usr/local/sbin/mailvm-askpass.sh <<'ASK'
#!/usr/bin/env bash
E=/etc/deploy-control/env
b64="$(sed -n 's/^MAILVM_KEY_PASSPHRASE_B64=//p' "$E" | head -1)"
if [ -n "$b64" ]; then
  printf '%s' "$b64" | base64 -d; echo
else
  sed -n 's/^MAILVM_KEY_PASSPHRASE=//p' "$E" | head -1
fi
ASK
chmod 700 /usr/local/sbin/mailvm-askpass.sh

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
systemctl enable mailvm-ssh-agent.service >/dev/null 2>&1 || true
systemctl restart mailvm-ssh-agent.service      # restart so a re-run reloads the askpass + re-adds the key
sleep 2
echo "=== keys loaded in the agent ==="
SSH_AUTH_SOCK="$SOCK" ssh-add -l 2>&1 || true
echo "=== test host->mail-VM SSH via the agent ==="
SSH_AUTH_SOCK="$SOCK" ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 \
  root@192.168.56.129 'echo CONNECTED_OK; id -un; (test -r /var/log/mail.log && echo LOG_READABLE || echo LOG_UNREADABLE)' 2>&1 | tail -6
