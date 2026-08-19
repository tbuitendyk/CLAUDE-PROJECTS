#!/usr/bin/env bash
# live-alert.sh -- PUSH alerting for GENERALIZED setups (IMPLEMENTATION-PLAN
# 6.2; NEXT-RELEASE 16). The per-setup sibling of pilot-alert.sh, which stays
# Its sibling pilot-alert.sh pages BOX-LEVEL incidents only (dead heartbeat,
# stale sync, halt); this one pages per-profile. They deliberately share no
# state, and each ignores the other's events — see the R6 note in pilot-alert.sh.
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
# R12: mirror.json is the generalized rail's drift/health file; if the writer
# stalls it reads as "fresh" (last good content) and hides its own silence. Page
# when the file exists but has not been refreshed in this long (writer ~hourly).
MIRROR_STALE_S = 3 * 3600.0
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

now = time.time()
state = load(STATE, {})          # key "setup|kind" -> for journal incidents the last-paged
                                 # INCIDENT ts (watermark, R13); for mirror/health the last-paged wall time
# alerts: (key, subject_frag, body_lines, inc_ts). inc_ts is the incident's own ts
# for journal incidents (page on a NEWER occurrence, R13) or None for mirror/health
# (wall-clock cooldown).
alerts = []

# ---- (a) mirror breaks per setup + mirror-file HEALTH ----------------------
mir = load(MIRROR, None)
# R12: a STALLED mirror writer hides its own silence — the file reads as fresh. If
# the file EXISTS but is stale, page; absent = no live/paper setup writes it yet.
try:
    mir_age = now - os.stat(MIRROR).st_mtime
    if mir_age > MIRROR_STALE_S:
        alerts.append(("_mirror|STALE", f"mirror stale {int(mir_age // 60)}m",
                       [f"mirror.json not refreshed in {int(mir_age // 60)} min (writer runs ~hourly) — "
                        "the generalized rail's drift detector may be stalled"], None))
except FileNotFoundError:
    pass
if mir and isinstance(mir.get("results"), list):
    for r in mir["results"]:
        if r.get("breaks"):
            key = f'{r.get("setup_id")}|MIRROR_BREAK'
            det = "; ".join(d.get("reason", "?") for d in (r.get("details") or [])[:3])
            alerts.append((key, f'{r.get("setup_id")}: MIRROR BREAK x{r["breaks"]}',
                           [f'setup {r.get("setup_id")}: {r["breaks"]} decision(s) no longer reproduce', det], None))
        if r.get("error"):
            key = f'{r.get("setup_id")}|MIRROR_ERROR'
            alerts.append((key, f'{r.get("setup_id")}: mirror error',
                           [f'mirror recompute errored: {r["error"]}'], None))

# ---- (b) setup-tagged journal incidents ------------------------------------
# R13: keep the LATEST incident per (setup, kind), and page it only when its ts is
# NEWER than the watermark — so a single historical incident sitting in the 26h
# window pages ONCE, not every cooldown for the whole day. A genuinely later
# occurrence (newer ts) pages again.
latest = {}   # key -> (ts, frag, body_lines)
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
                frag = f"{sid}: {ev}"
                body_l = [json.dumps({k: v for k, v in e.items() if k not in ("event",)})[:300]]
            elif ev == "INTENT_INVALID":
                probs = set(e.get("problems") or [])
                if not (probs & ALLOW_PROBLEMS): continue
                key = f"{sid}|INTENT_REFUSED"
                frag = f"{sid}: intent refused ({','.join(sorted(probs & ALLOW_PROBLEMS))})"
                body_l = [json.dumps(e)[:300]]
            else:
                continue
            if key not in latest or ts > latest[key][0]:
                latest[key] = (ts, frag, body_l)
except FileNotFoundError:
    pass
for key, (ts, frag, body_l) in latest.items():
    alerts.append((key, frag, body_l, ts))

# ---- de-dup: journal incidents page on TRANSITION (newer ts than the
# watermark); mirror/health page at most once per wall-clock cooldown ---------
due = []
seen_keys = set()
for key, frag, lines, inc_ts in alerts:
    if key in seen_keys: continue
    seen_keys.add(key)
    if inc_ts is not None:
        if inc_ts <= state.get(key, 0): continue    # not newer than last paged (R13)
    else:
        if now - state.get(key, 0) < COOLDOWN_S: continue
    due.append((key, frag, lines, inc_ts))

if not due:
    print("live-alert: nothing to page")
    raise SystemExit(0)

subject = "LIVE-SETUP ALERT: " + "; ".join(f for _, f, _, _ in due[:4]) + ("" if len(due) <= 4 else f" (+{len(due)-4} more)")
body = ["Per-setup alert from the generalized rail (live-alert.sh).", ""]
for _, frag, lines, _ in due:
    body.append(f"* {frag}")
    body.extend(f"    {l}" for l in lines if l)
body += ["", "Screen: https://www.buitendyk.ca/classifier/livetrading.html", "-- live-alert (machine signal)"]

# record: a journal incident advances its watermark to the incident's ts (so only
# a NEWER occurrence re-pages, R13); a mirror/health alert records the wall time.
def _persist():
    for k, _f, _l, inc_ts in due:
        state[k] = inc_ts if inc_ts is not None else now
    with open(STATE, "w") as fh: json.dump(state, fh)

if DRYRUN:
    print("DRYRUN would send:", subject)
    for _, f_, _l, _t in due: print("  -", f_)
    _persist()
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
_persist()
PY
