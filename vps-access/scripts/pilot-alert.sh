#!/usr/bin/env bash
# pilot-alert.sh -- PUSH alerting for the live pilot (review finding 27).
#
# Observability was entirely pull-based: the owner had to open pilot.html to see
# a HALT, a dead executor, a stalled sync, or a reconcile mismatch. "The owner
# sleeps while this runs" — so at 02:30 UTC a halt or a dead executor with an
# overdue exit riding the market reached no one until morning. This closes that
# gap: a VPS timer reads the synced journal and EMAILS the owner when the live-
# money path goes wrong, de-duped so it mails on TRANSITION, not every run.
#
# It is deliberately self-contained: it does NOT go through claude-mail-send.sh's
# outbox/git-record flow (that is for human-authored, archived messages). An
# autonomous alert reuses the same proven SMTP path (mail guest, password from
# /etc/deploy-control/env, sender claude@) so it lands in the same inbox, but it
# is a machine signal, not a filed message.
#
# Conditions (each a distinct alert key so a new one always mails):
#   halted          the box set HALT — new entries stopped (exits still run)
#   dead_heartbeat  no CLOCK_SYNC/BALANCE/RECONCILE_OK within DEAD_HB_MIN — the
#                   executor is not running; scheduled exits are NOT firing
#   stale_sync      journal not synced within STALE_SYNC_MIN — screen is blind
#   incident:<k>@ts a new RECONCILE_MISMATCH / KILL_* / EXIT_OVERDUE /
#                   MIRROR_BREAK / ORDER_REJECT since the last alert
#
# dead_heartbeat and stale_sync only fire when there is something AT RISK
# (armed, or an open position whose scheduled exit could be missed) so a
# deliberately-stopped, flat box does not page anyone. halted and incidents
# always fire — they only exist because something happened.
set -uo pipefail

JOURNAL="${1:-/opt/general-classifier/data/pilot/journal.jsonl}"
# Paths are env-overridable so the installer can relocate them and tests can
# point them at fixtures; they default to the live VPS locations.
STATE="${PILOT_ALERT_STATE:-/var/lib/claude-pilot/alert-state.json}"
ENVFILE="${PILOT_MAIL_ENVFILE:-/etc/deploy-control/env}"
DRYRUN="${PILOT_ALERT_DRYRUN:-0}"   # 1 = detect + compose + persist, never SMTP
mkdir -p "$(dirname "$STATE")"

JOURNAL="$JOURNAL" STATE="$STATE" ENVFILE="$ENVFILE" DRYRUN="$DRYRUN" python3 <<'PY'
import json, os, ssl, smtplib, time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

JOURNAL = os.environ["JOURNAL"]
STATE = os.environ["STATE"]
ENVFILE = os.environ["ENVFILE"]
DRYRUN = os.environ.get("DRYRUN", "0") == "1"

DEAD_HB_MIN = 25.0        # box exec runs every 10 min; 2.5 missed cycles = dead
STALE_SYNC_MIN = 30.0     # VPS sync runs every 5 min; 6 missed cycles = stalled
INCIDENT_EVENTS = {"RECONCILE_MISMATCH", "RECONCILE_UNREADABLE", "KILL_PRICE_DRIFT",
                   "KILL_TRANSPORT", "EXIT_OVERDUE", "MIRROR_BREAK", "ORDER_REJECT",
                   "HALT_SET", "ARM_STALE", "INTENT_STALE", "CLOCK_DRIFT"}
HEARTBEAT_EVENTS = {"CLOCK_SYNC", "BALANCE", "RECONCILE_OK"}

def now():
    return time.time()

if not os.path.exists(JOURNAL):
    # nothing running/synced yet — not an error, nothing to alert on
    raise SystemExit(0)

events = []
with open(JOURNAL) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            pass

# minimal replay: armed/halted (last RUN_STATUS), open positions, heartbeat
armed = halted = False
open_pos = {}
last_hb_ts = None
last_incident = None  # (ts, kind)
for e in events:
    ev = e.get("event")
    if ev == "RUN_STATUS":
        armed = bool(e.get("armed"))
        halted = bool(e.get("halted"))
    elif ev == "HALT_SET":
        halted = True
    elif ev == "ENTRY_FILL":
        open_pos[e.get("chunk_start")] = True
    elif ev == "EXIT_FILL":
        open_pos.pop(e.get("chunk_start"), None)
    if ev in HEARTBEAT_EVENTS:
        last_hb_ts = e.get("ts", last_hb_ts)
    if ev in INCIDENT_EVENTS:
        last_incident = (e.get("ts", 0), ev)

n_open = len(open_pos)
at_risk = armed or n_open > 0   # something a dead box could mishandle

sync_age_min = (now() - os.stat(JOURNAL).st_mtime) / 60.0
hb_age_min = (now() - last_hb_ts) / 60.0 if last_hb_ts else None

active = {}   # key -> human line
if halted:
    active["halted"] = "HALT is set on the box — new entries stopped (scheduled exits still run)."
if at_risk and (hb_age_min is None or hb_age_min > DEAD_HB_MIN):
    age = "never" if hb_age_min is None else f"{hb_age_min:.0f} min ago"
    active["dead_heartbeat"] = (f"Executor SILENT — last heartbeat {age} (runs every ~10 min). "
                                f"Scheduled exits are NOT firing; an open position can ride unhedged. "
                                f"Open positions: {n_open}.")
if at_risk and sync_age_min > STALE_SYNC_MIN:
    active["stale_sync"] = f"Journal not synced for {sync_age_min:.0f} min — the live screen is blind."
if last_incident:
    inc_ts, inc_kind = last_incident
    active[f"incident:{inc_kind}@{int(inc_ts)}"] = f"New incident: {inc_kind}."

# de-dupe on transition: load the set of keys we last alerted on
prev = {"keys": []}
try:
    with open(STATE) as f:
        prev = json.load(f)
except Exception:
    pass
prev_keys = set(prev.get("keys", []))
cur_keys = set(active.keys())

def persist():
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"keys": sorted(cur_keys), "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "armed": armed, "halted": halted, "open": n_open}, f)
    os.replace(tmp, STATE)

# fire when a NEW condition appears, or when everything clears (transition back)
new_keys = cur_keys - prev_keys
cleared = bool(prev_keys) and not cur_keys
if not new_keys and not cleared:
    persist()   # no change worth mailing (advance timestamp only)
    raise SystemExit(0)

# ---- compose ----
if cleared:
    subject = "PILOT: all clear"
    tldr = "tl;dr the pilot alert conditions have all cleared."
    lines = [tldr, "", "Previously alerting on: " + ", ".join(sorted(prev_keys)),
             f"Now: armed={armed} halted={halted} open_positions={n_open} "
             f"heartbeat={'—' if hb_age_min is None else f'{hb_age_min:.0f}m'} "
             f"sync={sync_age_min:.0f}m."]
else:
    worst = "dead_heartbeat" in active or "halted" in active
    subject = "PILOT ALERT: " + "; ".join(sorted(active.keys()))
    tldr = "tl;dr the live pilot needs attention — " + ("EXECUTOR/HALT issue." if worst else "see below.")
    lines = [tldr, ""]
    for k in sorted(active.keys()):
        lines.append("• " + active[k])
    lines += ["",
              f"State: armed={armed} halted={halted} open_positions={n_open} "
              f"heartbeat={'never' if hb_age_min is None else f'{hb_age_min:.0f} min ago'} "
              f"sync={sync_age_min:.0f} min ago.",
              "Screen: https://buitendyk.ca/classifier/pilot.html",
              "This is an automated push alert from the VPS pilot watcher."]
lines += ["", "c."]
body = "\n".join(lines)

if DRYRUN:
    print(f"[dryrun] would send: {subject}")
    print(f"[dryrun] new_keys={sorted(new_keys)} cleared={cleared} active={sorted(cur_keys)}")
    persist()
    raise SystemExit(0)

# ---- send (mirrors claude-mail-send.sh's proven SMTP block) ----
SENDER = "claude@homeandofficemicro.com"
RCPT = "theodore@homeandofficemicro.com"
MAILVM = "192.168.56.129"
pw = None
try:
    for line in open(ENVFILE):
        if line.startswith("CLAUDE_MAIL_PASSWORD="):
            pw = line.split("=", 1)[1].strip(); break
except Exception as e:
    print(f"cannot read {ENVFILE}: {e}")
if not pw:
    print("CLAUDE_MAIL_PASSWORD not set — cannot send; NOT persisting so we retry next run")
    raise SystemExit(2)

m = EmailMessage()
m["From"] = f"Claude <{SENDER}>"
m["To"] = RCPT
m["Reply-To"] = SENDER
m["Subject"] = subject
m["Date"] = formatdate(localtime=True)
m["Message-ID"] = make_msgid(domain="homeandofficemicro.com")
m.set_content(body)

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
errs = []
for label, mode in (("587/STARTTLS", "starttls"), ("465/SMTPS", "ssl")):
    try:
        if mode == "starttls":
            s = smtplib.SMTP(MAILVM, 587, timeout=30); s.ehlo(); s.starttls(context=ctx); s.ehlo()
        else:
            s = smtplib.SMTP_SSL(MAILVM, 465, timeout=30, context=ctx); s.ehlo()
        s.login(SENDER, pw); s.send_message(m); s.quit()
        print(f"SENT via {label}: {subject}")
        persist()   # only advance state after a successful send, so a transport
                    # failure re-alerts next run instead of silently swallowing it
        break
    except Exception as e:
        errs.append(f"{label}: {e}")
else:
    print("FAILED on both ports: " + " | ".join(errs) + " (will retry next run)")
    raise SystemExit(4)
PY
