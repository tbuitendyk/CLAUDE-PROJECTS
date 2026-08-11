#!/usr/bin/env bash
# test-mail-verify-parse.sh -- watched-failing test for GAP-2 (2026-08-11 e2e
# review): the Message-ID collision spoof. mail-verify-parse.py must VERIFY only
# when ONE queue id carries BOTH the owner's SASL login AND a to=<claude@...>
# recipient — never when those two facts are pooled across DIFFERENT queue ids.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUT="$HERE/mail-verify-parse.py"
OWNER="theodore@homeandofficemicro.com"
MBOX="claude@homeandofficemicro.com"
fail=0

verdict() { # stdin = grep output; prints authed bool for the given mid ($1)
  python3 "$SUT" "$OWNER" "$MBOX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(str(d.get(sys.argv[1],{}).get('authed')).lower())" "$1"
}
check() { # <label> <expected true|false> <mid>  (grep output on stdin)
  local label="$1" want="$2" mid="$3" got
  got="$(verdict "$mid")"
  if [ "$got" = "$want" ]; then echo "ok   - $label"
  else echo "FAIL - $label (want authed=$want, got $got)"; fail=1; fi
}

# 1) GENUINE owner->claude: ONE submission queue id has BOTH sasl AND to=claude.
check "genuine owner->claude verifies" true "owner-msg" <<EOF
MID owner-msg
  QSASL Q1sub Aug 11 postfix/submission/smtpd[1]: Q1sub: client=phone[1.2.3.4], sasl_username=$OWNER
  QTO Q1sub Aug 11 postfix/smtp[2]: Q1sub: to=<$MBOX>, relay=amavis, status=sent
  QSASL Q2amavis Aug 11 postfix/smtpd[3]: Q2amavis: client=localhost[127.0.0.1]
  QTO Q2amavis Aug 11 postfix/lmtp[4]: Q2amavis: to=<$MBOX>, relay=dovecot, status=sent
EOF

# 2) THE SPOOF: owner's SASL is on Q1 (a message the owner sent ELSEWHERE), the
#    claude@ delivery is on QA (the attacker's inbound mail reusing the msg-id).
#    Two DIFFERENT queue ids -> must NOT verify.
check "message-id collision spoof is rejected" false "collide" <<EOF
MID collide
  QSASL Q1owner Aug 11 postfix/submission/smtpd[1]: Q1owner: client=phone[1.2.3.4], sasl_username=$OWNER
  QTO Q1owner Aug 11 postfix/smtp[2]: Q1owner: to=<someone-else@example.com>, status=sent
  QSASL QAin Aug 11 postfix/smtpd[3]: QAin: client=evil[9.9.9.9]
  QTO QAin Aug 11 postfix/lmtp[4]: QAin: to=<$MBOX>, relay=dovecot, status=sent
EOF

# 3) plain inbound (no SASL anywhere) delivered to claude@ -> not verified
check "unauthenticated inbound is rejected" false "inbound" <<EOF
MID inbound
  QSASL QX Aug 11 postfix/smtpd[1]: QX: client=evil[9.9.9.9]
  QTO QX Aug 11 postfix/lmtp[2]: QX: to=<$MBOX>, status=sent
EOF

# 4) owner authenticated but addressed to someone else (not claude@) -> not verified
check "owner mail to a third party is rejected" false "elsewhere" <<EOF
MID elsewhere
  QSASL Q1 Aug 11 postfix/submission/smtpd[1]: Q1: client=phone[1.2.3.4], sasl_username=$OWNER
  QTO Q1 Aug 11 postfix/smtp[2]: Q1: to=<list@example.com>, status=sent
EOF

# 5) a DIFFERENT SASL user (not the owner) to claude@ -> not verified
check "non-owner SASL is rejected" false "other-user" <<EOF
MID other-user
  QSASL Q1 Aug 11 postfix/submission/smtpd[1]: Q1: client=x[1.1.1.1], sasl_username=mallory@homeandofficemicro.com
  QTO Q1 Aug 11 postfix/smtp[2]: Q1: to=<$MBOX>, status=sent
EOF

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "FAILURES"; exit 1; }
