#!/usr/bin/env python3
# mail-verify-parse.py -- decide, per message-id, whether it is a VERIFIED owner
# submission, from the mail-log grep output the verify scripts collect over SSH.
# Single source of truth so claude-mail-recent.sh and claude-mail-check.sh agree,
# and so the rule is unit-testable without a live mail server.
#
# GAP-2 (2026-08-11 e2e review): the OLD rule pooled every queue-id that shared a
# message-id and accepted the message if ANY pooled qid carried the owner's SASL
# login. That is spoofable by MESSAGE-ID COLLISION: Message-ID is attacker-chosen
# header text, so an attacker sends mail to claude@ reusing a Message-ID the owner
# legitimately submitted (with SASL) for some OTHER message. The log lookup then
# finds the owner's SASL on the owner's unrelated queue-id and the delivery to
# claude@ on the attacker's queue-id — pooled together, the message "verifies"
# though claude@ actually received the attacker's mail.
#
# THE FIX: bind BOTH facts to the SAME queue-id. A message-id is VERIFIED only if
# ONE queue-id shows BOTH (a) a client= line with the owner's sasl_username AND
# (b) a to=<claude@...> envelope-recipient line. A genuine owner->claude message
# is an authenticated submission ADDRESSED to claude@, so its submission queue-id
# carries both. The owner's mail to someone else has the SASL but to=<other>. The
# attacker's inbound mail has to=<claude@> but no SASL. Neither passes.
#
# stdin  : the SSH grep output, blocks of:
#            MID <message-id, no angle brackets>
#              QSASL <qid> <...client log line incl sasl_username=...>
#              QTO   <qid> <...to=<claude@...> log line>
# argv[1]: owner address (e.g. theodore@homeandofficemicro.com)
# argv[2]: claude mailbox address (e.g. claude@homeandofficemicro.com)
# stdout : JSON { mid: {authed, sasl:[...], to_claude, boundQid} }
import json, re, sys

OWNER = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
MBOX = (sys.argv[2] if len(sys.argv) > 2 else "").lower()

def main():
    mids = {}          # mid -> { qid -> {"sasl": set(), "to": bool} }
    cur = None
    for raw in sys.stdin:
        line = raw.rstrip("\n")
        s = line.strip()
        if s.startswith("MID "):
            cur = s[4:].strip()
            mids.setdefault(cur, {})
        elif cur is not None and s.startswith("QSASL "):
            parts = s.split(" ", 2)
            if len(parts) < 3:
                continue
            qid, rest = parts[1], parts[2]
            d = mids[cur].setdefault(qid, {"sasl": set(), "to": False})
            m = re.search(r"sasl_username=([^,\s]+)", rest)
            if m:
                d["sasl"].add(m.group(1).lower())
        elif cur is not None and s.startswith("QTO "):
            parts = s.split(" ", 2)
            if len(parts) < 2:
                continue
            qid, rest = parts[1], (parts[2] if len(parts) > 2 else "")
            d = mids[cur].setdefault(qid, {"sasl": set(), "to": False})
            # Do NOT trust the upstream grep filter — confirm the recipient IS the
            # claude mailbox in the line itself (defense in depth): to=<claude@...>.
            if MBOX and f"to=<{MBOX}>" in rest.lower():
                d["to"] = True

    out = {}
    for mid, qmap in mids.items():
        bound = None
        for qid, d in qmap.items():
            if OWNER in d["sasl"] and d["to"]:
                bound = qid
                break
        all_sasl = sorted(set().union(*[d["sasl"] for d in qmap.values()]) if qmap else set())
        any_to = any(d["to"] for d in qmap.values())
        out[mid] = {
            "authed": bound is not None,
            "sasl": all_sasl,
            "to_claude": any_to,
            "boundQid": bound,
        }
    print(json.dumps(out))

if __name__ == "__main__":
    main()
