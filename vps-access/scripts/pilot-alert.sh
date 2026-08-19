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
#   incident:<k>@ts a new RECONCILE_MISMATCH / KILL_* / EXIT_OVERDUE / MIRROR_BREAK
#                   / ORDER_REJECT_{ENTRY,EXIT} / ARM_{HMAC_INVALID,REPLAY_REJECTED,
#                   NO_SECRET,STALE_REQUEST} since the last alert
#
# dead_heartbeat only fires when something is AT RISK (armed, or an open position
# whose scheduled exit could be missed) so a deliberately-stopped, flat box does
# not page for box-side quiet. stale_sync fires on STALENESS ALONE (GAP-1): a
# stalled sync makes the at_risk reading itself untrustworthy, so screen-blindness
# is always worth one page. halted and incidents always fire — they only exist
# because something happened.
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
STALE_MIRROR_MIN = 90.0   # mirror runs on the hourly tick; >90 min = missed one
INCIDENT_COOLDOWN_MIN = 60.0  # re-page a recurring incident KIND at most this often,
                              # so a condition the box re-stamps every cycle pages
                              # once then hourly, not on every alert run (re-review S1)
INCIDENT_EVENTS = {"RECONCILE_MISMATCH", "RECONCILE_UNREADABLE", "KILL_PRICE_DRIFT",
                   "KILL_TRANSPORT", "EXIT_OVERDUE", "MIRROR_BREAK", "ORDER_REJECT",
                   "HALT_SET", "ARM_STALE", "INTENT_STALE", "CLOCK_DRIFT", "FIXED_STOP",
                   # ENTRY_GAVE_UP (owner 2026-08-16): the entry retry budget was
                   # spent without a fill, so the model called a trade the box never
                   # took. A missed entry is exactly as reportable as a bad one.
                   "ENTRY_GAVE_UP",
                   # ARM-REFUSAL events (GAP-4, 2026-08-11 e2e review): the box journals
                   # these when it REFUSES an arm request. A bad HMAC or a replayed nonce
                   # is a tampering/mis-config signal, and a no-secret/stale refusal means
                   # a START press silently did NOT arm — the owner presses START and
                   # nothing happens, with no page. These were invisible to the alerter.
                   "ARM_NO_SECRET", "ARM_HMAC_INVALID", "ARM_REPLAY_REJECTED",
                   "ARM_STALE_REQUEST"}
# A heartbeat must prove the executor loop ran PAST the due-exit step, not just
# its opening. CLOCK_SYNC fires before any account call, and RECONCILE_OK fires at
# step 1 — BEFORE due exits run (step 3). A box that reconciles then dies in the
# exit loop (a deterministic exception on a specific open position) keeps
# re-emitting RECONCILE_OK while scheduled exits never fire — the exact failure
# this alert exists to catch, masked by a "fresh" heartbeat (re-review liveness).
# RUN_STATUS is journaled every run immediately AFTER the exit loop (and before the
# entry-gate returns), so its presence certifies exits completed without throwing;
# BALANCE is the end-of-loop snapshot. Kept byte-identical to lib/pilotview.js.
HEARTBEAT_EVENTS = {"RUN_STATUS", "BALANCE"}
# Transport/clock incidents are transient ENVIRONMENTAL blips (a network stall to
# the exchange, a momentary clock skew) that harm nothing when nothing is on the
# line. Page for them only when something is AT RISK (armed, or a position open);
# a deliberately-stopped, flat box must not wake the owner for a passing blip
# (re-review liveness L2). Position/money incidents always page.
AT_RISK_GATED_INCIDENTS = {"KILL_TRANSPORT", "CLOCK_DRIFT"}

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
incident_latest = {}   # kind -> latest ts seen (de-dup by KIND, not per-occurrence)
for e in events:
    ev = e.get("event")
    # R6: this is the BOX-LEVEL alerter. Per-profile events (they carry a
    # carry a setup_id and share the one journal; skip them so a paper/live setup's
    # fills never inflate the box-level open-position count (a spurious at_risk)
    # and a profile's exit on a shared chunk_start never pops a box-level
    # position's key (which would silence a real at_risk page). Box-level events
    # (RUN_STATUS, heartbeats) carry no setup_id, which is what separates them.
    # The generalized rail has its OWN alerter (live-alert.sh). Byte-identical to
    # today when no schema-2 event exists.
    if e.get("setup_id") is not None:
        continue
    if ev == "RUN_STATUS":
        armed = bool(e.get("armed"))
        halted = bool(e.get("halted"))
    elif ev == "ARM_SET":
        # honor the arm/disarm EDGE events too, not only RUN_STATUS (re-review M1):
        # the box is armed by a short-lived `arm` CLI invocation that journals
        # ARM_SET but emits NO RUN_STATUS, so a box armed and then hung BEFORE its
        # next run cycle would read armed=false here and suppress every at_risk-
        # gated liveness page — a silent dead-armed box. Match lib/pilotview.js.
        armed = True
    elif ev == "ARM_CLEAR":
        armed = False
    elif ev == "HALT_SET":
        halted = True
    elif ev == "HALT_CLEAR":
        halted = False
    elif ev == "ENTRY_FILL":
        open_pos[e.get("chunk_start")] = True
    elif ev == "EXIT_FILL":
        open_pos.pop(e.get("chunk_start"), None)
    if ev in HEARTBEAT_EVENTS:
        last_hb_ts = e.get("ts", last_hb_ts)
    if ev in INCIDENT_EVENTS:
        if ev == "ORDER_REJECT":
            # split ENTRY vs EXIT into DISTINCT kinds (GAP-3b, 2026-08-11 e2e review).
            # An EXIT reject (a position that will not close, exposed to the market)
            # is far more serious than an ENTRY reject, and collapsing both to one
            # "ORDER_REJECT" kind let an EXIT reject arriving inside an ENTRY reject's
            # cooldown be swallowed. A housekeeping SWEEP reject is not a trading
            # incident and is dropped.
            action = e.get("action")
            if action in ("ENTRY", "EXIT"):
                k = f"ORDER_REJECT_{action}"
                incident_latest[k] = max(e.get("ts", 0), incident_latest.get(k, 0))
        else:
            # keep the LATEST ts per kind: a burst of the same kind collapses to a
            # single alert, and a genuinely later occurrence still re-pages (its ts
            # passes the persisted per-kind watermark below).
            incident_latest[ev] = max(e.get("ts", 0), incident_latest.get(ev, 0))

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
if sync_age_min > STALE_SYNC_MIN:
    # GAP-1 (2026-08-11 e2e review): stale_sync fires on STALENESS ALONE, NOT gated
    # on at_risk. at_risk is derived from the LAST synced RUN_STATUS — but a stalled
    # sync means that reading is itself stale, so the box could have armed and opened
    # a position AFTER the freeze and we would never see it. Gating the "I am blind"
    # alarm on the possibly-blind state is unsound. A retired, deliberately-stopped
    # pilot pages this ONCE (de-duped by condition key), an acceptable price for
    # never going silently blind on a live one. (dead_heartbeat stays at_risk-gated:
    # that reads box-side liveness, not screen blindness.)
    active["stale_sync"] = f"Journal not synced for {sync_age_min:.0f} min — the live screen is blind."
# mirror-check health (re-review): a mirror that ERRORED (ok:false) or has gone
# STALE has stopped verifying the paper twin while the box may be trading — page
# the owner so the drift detector cannot fail silent. Only when something is at
# risk (armed or a position open).
mirror_path = os.path.join(os.path.dirname(JOURNAL), "mirror.json")
if at_risk:
    if not os.path.exists(mirror_path):
        # ABSENT verdict while a position is open (re-review A2/M3): a deleted
        # mirror.json, or a detector that never ran, leaves the box trading a live
        # position with nothing verifying its paper twin — and the old code, which
        # only looked inside `if exists`, said nothing. Gate on an open position so
        # the brief first-arm window before the first hourly tick does not false-page.
        if n_open > 0:
            active["mirror_missing"] = ("Mirror verdict ABSENT while a position is open — the drift "
                                        f"detector has produced no verdict for the live trade. Open: {n_open}.")
    else:
        try:
            mj = json.load(open(mirror_path))
            mj_age_min = (now() - os.stat(mirror_path).st_mtime) / 60.0
            if mj.get("ok") is False:
                active["mirror_error"] = ("Mirror check ERRORED — the drift detector is not verifying: "
                                          + str(mj.get("error", ""))[:140])
            elif mj_age_min > STALE_MIRROR_MIN:
                active["mirror_stale"] = (f"Mirror check has not run for {mj_age_min:.0f} min "
                                          "(tick is hourly) — the drift detector may be dead.")
            elif n_open > 0 and int(mj.get("checked", 0)) == 0:
                # ok:true but it verified NOTHING while a position is open (re-review
                # M3b): a detector alive-but-checking-no-decisions reads falsely green.
                active["mirror_verified_nothing"] = ("Mirror ran but verified 0 decisions while a position "
                                                     "is open — the detector may be looking at an empty set.")
        except Exception:
            # a corrupt/unparseable verdict is a dead detector (re-review A2), not a
            # thing to skip silently — page it.
            active["mirror_error"] = "Mirror verdict UNPARSEABLE — the drift detector output is corrupt."

# de-dupe on transition: load the CONDITION keys and per-kind incident watermarks
prev = {"keys": []}
try:
    with open(STATE) as f:
        prev = json.load(f)
except Exception:
    pass
prev_keys = set(prev.get("keys", []))
cur_keys = set(active.keys())          # CONDITIONS only (halt/heartbeat/sync/mirror)
prev_inc_wm = prev.get("inc_wm", {})   # kind -> last-paged ts (box clock)
prev_inc_paged = prev.get("inc_paged_at", {})  # kind -> wall epoch we last paged it

# Incidents are edge events, de-duped by KIND via a monotonic per-kind watermark:
# a kind fires when its latest ts is strictly newer than the last ts we paged for
# that kind. This keeps incidents OUT of the condition set (so a latching incident
# cannot poison the conditions' all-clear), collapses a same-window burst to one
# alert, and still re-pages a genuinely later occurrence. Transport/clock kinds
# are suppressed entirely when nothing is at risk. A per-kind COOLDOWN then caps a
# genuinely-recurring kind (one the box re-stamps every cycle, e.g. a persistent
# RECONCILE_MISMATCH or EXIT_OVERDUE) to at most one page per cooldown window
# instead of one per alert run (re-review S1 alert-fatigue).
cur_inc_wm = dict(prev_inc_wm)
cur_inc_paged = dict(prev_inc_paged)
new_incidents = {}   # kind -> latest ts, only those newly firing this run
_now_wall = now()
_cooldown_s = INCIDENT_COOLDOWN_MIN * 60.0
for kind, ts in incident_latest.items():
    if kind in AT_RISK_GATED_INCIDENTS and not at_risk:
        continue
    if ts > prev_inc_wm.get(kind, 0):
        if _now_wall - prev_inc_paged.get(kind, 0) < _cooldown_s:
            # Suppressed by cooldown — do NOT advance the watermark (GAP-3a,
            # 2026-08-11 e2e review). Advancing it here silently SWALLOWED a
            # genuinely-distinct later occurrence: it moved the watermark past the
            # new ts without paging, so when the cooldown lifted that occurrence was
            # no longer "newer than the watermark" and never fired. Leaving the
            # watermark where it was means the newest occurrence still pages the
            # moment the cooldown elapses — delayed, never dropped.
            continue
        cur_inc_wm[kind] = ts
        new_incidents[kind] = ts
        cur_inc_paged[kind] = _now_wall

def persist():
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"keys": sorted(cur_keys), "inc_wm": cur_inc_wm,
                   "inc_paged_at": cur_inc_paged,
                   "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "armed": armed, "halted": halted, "open": n_open}, f)
    os.replace(tmp, STATE)

# fire when a NEW condition appears, a NEW incident kind fires, or when all the
# CONDITIONS clear (transition back to quiet). A cleared all-clear is about the
# ongoing conditions only — incidents are point-in-time and never "clear".
new_keys = cur_keys - prev_keys
cleared = bool(prev_keys) and not cur_keys
if not new_keys and not new_incidents and not cleared:
    persist()   # no change worth mailing (advance timestamp/watermarks only)
    raise SystemExit(0)

# ---- compose ----
# all-clear only when the ongoing CONDITIONS cleared and no new incident fired
show_all_clear = cleared and not new_incidents
if show_all_clear:
    subject = "PILOT: all clear"
    tldr = "tl;dr the pilot alert conditions have all cleared."
    lines = [tldr, "", "Previously alerting on: " + ", ".join(sorted(prev_keys)),
             f"Now: armed={armed} halted={halted} open_positions={n_open} "
             f"heartbeat={'—' if hb_age_min is None else f'{hb_age_min:.0f}m'} "
             f"sync={sync_age_min:.0f}m."]
else:
    inc_keys = [f"incident:{k}" for k in sorted(new_incidents)]
    subj_keys = sorted(active.keys()) + inc_keys
    worst = "dead_heartbeat" in active or "halted" in active
    subject = "PILOT ALERT: " + "; ".join(subj_keys)
    tldr = "tl;dr the live pilot needs attention — " + ("EXECUTOR/HALT issue." if worst else "see below.")
    lines = [tldr, ""]
    for k in sorted(active.keys()):
        lines.append("• " + active[k])
    for k in sorted(new_incidents):
        lines.append(f"• New incident: {k}.")
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
