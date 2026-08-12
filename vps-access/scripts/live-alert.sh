#!/usr/bin/env bash
# live-alert.sh -- PUSH alerting for GENERALIZED setups (IMPLEMENTATION-PLAN
# 6.2; NEXT-RELEASE 16). The per-setup sibling of pilot-alert.sh, which stays
# UNTOUCHED serving the running F1 pilot (two rails, no shared state).
#
# Reads: (a) data/live/mirror.json — per-setup mirror breaks (drift detector);
#        (b) the synced journal — setup_id-tagged incident events (schema-2).
# Emails the owner on TRANSITION per (setup_id, kind), with a cooldown so a
# recurring condition pages once then hourly, not every run. Same proven SMTP
# path as pilot-alert.sh (mail guest, sender claude@); machine signal, not a
# filed message. Fail-safe: send failure -> state NOT persisted -> retried.
set -uo pipefail

JOURNAL="${1:-/opt/general-classifier/data/pilot/journal.jsonl}"
MIRROR="${LIVE_MIRROR_FILE:-/opt/general-classifier/data/live/mirror.json}"
STATE="${LIVE_ALERT_STATE:-/var/lib/claude-pilot/live-alert-state.json}"
ENVFILE="${PILOT_MAIL_ENVFILE:-/etc/deploy-control/env}"
DRYRUN="${LIVE_ALERT_DRYRUN:-0}"
mkdir -p "$(dirname "$STATE")"

JOURNAL="$JOURNAL" MIRROR="$MIRROR" STATE="$STATE" ENVFILE="$ENVFILE" DRYRUN="$DRYRUN" python3 - <<'PY'
import json, os, ssl, smtplib, time
from email.message import EmailMessage
from email.utils import formatdate

JOURNAL = os.environ["JOURNAL"]
MIRROR = os.environ["MIRROR"]
STATE = os.environ["STATE"]
ENVFILE = os.environ["ENVFILE"]
DRYRUN = os.environ.get("DRYRUN", "0") == "1"

COOLDOWN_S = 3600.0
# schema-2 incident kinds worth a page, keyed per setup. FIXED_STOP is a page
# (a protective stop fired — the owner should know), the rest are faults.
INCIDENT_EVENTS = {"KILL_PRICE_DRIFT", "FIXED_STOP", "EXIT_OVERDUE",
                   "PAPER_EXIT_DEFERRED", "INTENT_STALE"}
# INTENT_INVALID carries its reasons in `problems`; allowlist-class refusals
# are per-setup faults worth a page (a setup the control plane ships but the
# box refuses is a configuration break, invisible otherwise).
ALLOW_PROBLEMS = {"allowlist", "allowlist_symbol", "clip_cap"}

def load(f, default):
    try:
        with open(f) as fh: return json.load(fh)
    except Exception: return default

state = load(STATE, {})          # key "setup|kind" -> last paged epoch
alerts = []                      # (key, subject_frag, body_lines)

# ---- (a) mirror breaks per setup ------------------------------------------
mir = load(MIRROR, None)
if mir and isinstance(mir.get("results"), list):
    for r in mir["results"]:
        if r.get("breaks"):
            key = f'{r.get("setup_id")}|MIRROR_BREAK'
            det = "; ".join(d.get("reason", "?") for d in (r.get("details") or [])[:3])
            alerts.append((key, f'{r.get("setup_id")}: MIRROR BREAK x{r["breaks"]}',
                           [f'setup {r.get("setup_id")}: {r["breaks"]} decision(s) no longer reproduce', det]))
        if r.get("error"):
            key = f'{r.get("setup_id")}|MIRROR_ERROR'
            alerts.append((key, f'{r.get("setup_id")}: mirror error',
                           [f'mirror recompute errored: {r["error"]}']))

# ---- (b) setup-tagged journal incidents ------------------------------------
now = time.time()
try:
    with open(JOURNAL) as fh:
        for line in fh:
            line = line.strip()
            if not line: continue
            try: e = json.loads(line)
            except Exception: continue
            sid = e.get("setup_id")
            if not sid: continue                    # schema-1 events: pilot-alert's job
            ev = e.get("event", "")
            ts = e.get("ts", 0)
            if now - ts > 26 * 3600: continue       # only the last ~day matters
            if ev in INCIDENT_EVENTS:
                key = f"{sid}|{ev}"
                alerts.append((key, f"{sid}: {ev}",
                               [json.dumps({k: v for k, v in e.items() if k not in ("event",)})[:300]]))
            elif ev == "INTENT_INVALID":
                probs = set(e.get("problems") or [])
                if probs & ALLOW_PROBLEMS:
                    key = f"{sid}|INTENT_REFUSED"
                    alerts.append((key, f"{sid}: intent refused ({','.join(sorted(probs & ALLOW_PROBLEMS))})",
                                   [json.dumps(e)[:300]]))
except FileNotFoundError:
    pass

# ---- de-dup: page per key at most once per cooldown -------------------------
due = []
seen_keys = set()
for key, frag, lines in alerts:
    if key in seen_keys: continue
    seen_keys.add(key)
    last = state.get(key, 0)
    if now - last < COOLDOWN_S: continue
    due.append((key, frag, lines))

if not due:
    print("live-alert: nothing to page")
    raise SystemExit(0)

subject = "LIVE-SETUP ALERT: " + "; ".join(f for _, f, _ in due[:4]) + ("" if len(due) <= 4 else f" (+{len(due)-4} more)")
body = ["Per-setup alert from the generalized rail (live-alert.sh).", ""]
for _, frag, lines in due:
    body.append(f"* {frag}")
    body.extend(f"    {l}" for l in lines if l)
body += ["", "Screen: https://www.buitendyk.ca/classifier/livetrading.html", "-- live-alert (machine signal)"]

if DRYRUN:
    print("DRYRUN would send:", subject)
    for _, f_, _l in due: print("  -", f_)
    for k, _f, _l in due: state[k] = now
    with open(STATE, "w") as fh: json.dump(state, fh)
    raise SystemExit(0)

pw = None
try:
    with open(ENVFILE) as fh:
        for line in fh:
            if line.startswith("CLAUDE_MAIL_PASSWORD="):
                pw = line.split("=", 1)[1].strip()
except Exception:
    pass
if not pw:
    print("CLAUDE_MAIL_PASSWORD not set — cannot send; NOT persisting so we retry next run")
    raise SystemExit(1)

MAILVM = "mail.homeandofficemicro.com"
SENDER = "claude@homeandofficemicro.com"
TO = "theodore@homeandofficemicro.com"
m = EmailMessage()
m["From"] = SENDER; m["To"] = TO; m["Subject"] = subject; m["Date"] = formatdate(localtime=False)
m.set_content("\n".join(body))
ctx = ssl.create_default_context()
sent = False
for label, mode in (("587/STARTTLS", "starttls"), ("465/SMTPS", "ssl")):
    try:
        if mode == "starttls":
            s = smtplib.SMTP(MAILVM, 587, timeout=30); s.ehlo(); s.starttls(context=ctx); s.ehlo()
        else:
            s = smtplib.SMTP_SSL(MAILVM, 465, timeout=30, context=ctx); s.ehlo()
        s.login(SENDER, pw); s.send_message(m); s.quit()
        sent = True
        print(f"live-alert SENT via {label}: {subject}")
        break
    except Exception as ex:
        print(f"send via {label} failed: {ex}")
if not sent:
    print("ALL sends failed — state NOT persisted; will retry next run")
    raise SystemExit(1)
for k, _f, _l in due: state[k] = now
with open(STATE, "w") as fh: json.dump(state, fh)
PY
