#!/usr/bin/env bash
# mailvm-account-probe.sh -- READ-ONLY: what backend holds the mailbox
# passwords, and does claude@ exist yet? Needed to know whether a password can
# be rotated ON THE BOX (generated there, never in git, never in a chat) or
# whether it has to be typed in by hand.
#
# Prints SCHEMES and EXISTENCE only. No password material, no hashes.
set -uo pipefail
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 root@192.168.56.129 'bash -s' <<'R' 2>&1
echo "backend hints:"
[ -f /etc/dovecot/dovecot-pgsql.conf ] && echo "  dovecot: PostgreSQL"
[ -f /etc/dovecot/dovecot-mysql.conf ] && echo "  dovecot: MySQL"
[ -d /opt/iredmail ] && echo "  iRedMail present"
command -v doveadm >/dev/null && echo "  doveadm: $(doveadm --version 2>/dev/null | head -1)"
echo
echo "mailboxes (addresses and password SCHEME only, never the hash):"
su - postgres -c "psql -d vmail -tAc \"select username, split_part(password,'}',1)||'}' from mailbox order by username;\"" 2>/dev/null \
  | sed 's/^/  /' || echo "  (could not read vmail via postgres)"
echo
echo "does claude@ exist?"
su - postgres -c "psql -d vmail -tAc \"select count(*) from mailbox where username='claude@homeandofficemicro.com';\"" 2>/dev/null | sed 's/^/  count=/'
R
