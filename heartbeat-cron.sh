#!/usr/bin/env bash
# heartbeat-cron.sh — experiment arm #2: in-container "cron" heartbeat.
#
# Counterpart to the harness-level wakeup-chain loop (which writes
# heartbeat-wakeup.log). This is a plain OS process inside the session
# container: every INTERVAL_SECONDS it appends a tick line to
# heartbeat-cron.log, commits, and pushes. GitHub commit timestamps are the
# independent evidence record for both arms:
#
#   git log --format='%ci %s' -- heartbeat-cron.log heartbeat-wakeup.log
#
# WHY NOT A REAL CRONTAB: this container ships no cron daemon (no crond, no
# crontab binary), so the script daemonizes itself with setsid instead. Same
# experimental property: the process lives and dies with the container.
#
# HYPOTHESIS UNDER TEST: this process dies silently when the container is
# reclaimed/recycled, while the harness wakeup chain keeps firing. The last
# pushed "heartbeat-cron tick" is the time of death.
#
# NOT guaranteed / manual steps:
#   - Committing this file arms NOTHING. Someone must run
#     `./heartbeat-cron.sh start` from a live session shell in each container.
#   - The detached loop inherits git/proxy auth env (GH_TOKEN, GIT_ASKPASS,
#     HTTPS_PROXY, CA bundle vars) from the shell that starts it. If any of
#     that is fd-backed or gets revoked, pushes fail; check .heartbeat-cron.out.
#   - Both arms write to the same local repo roughly once an hour. Collisions
#     are unlikely and fail loudly (git index.lock), never corrupt. This
#     script serializes itself via flock on .heartbeat-cron.lock; the wakeup
#     arm does not currently take that lock.
#
# Suggested .gitignore additions (working files are dot-prefixed regardless):
#   .heartbeat-cron.pid
#   .heartbeat-cron.out
#   .heartbeat-cron.lock
#
# Usage: ./heartbeat-cron.sh {start|stop|status|tick|run}
#   start  — launch the detached scheduler loop (refuses if already running)
#   stop   — kill the loop
#   status — is it alive, last output lines, last tick
#   tick   — do exactly one heartbeat (append+commit+push), foreground
#   run    — the loop itself (internal; start launches this via setsid)

set -u

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

INTERVAL_SECONDS="${INTERVAL_SECONDS:-3600}"
BRANCH="${BRANCH:-claude/sandbox-fd3rem}"
LOG_FILE="${LOG_FILE:-heartbeat-cron.log}"
PID_FILE=".heartbeat-cron.pid"
OUT_FILE=".heartbeat-cron.out"
LOCK_FILE=".heartbeat-cron.lock"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

tick() {
  # Serialize concurrent writers. 120s wait, then skip — a missed tick is
  # data, not a crash.
  exec 9>"$LOCK_FILE"
  if ! flock -w 120 9; then
    log "tick skipped: could not acquire lock"
    return 1
  fi

  local n=1 ts
  [ -f "$LOG_FILE" ] && n=$(( $(wc -l < "$LOG_FILE") + 1 ))
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "tick $n: $ts [container:$(cut -c1-8 /proc/sys/kernel/random/boot_id)]" >> "$LOG_FILE"

  git add -- "$LOG_FILE"
  # Pathspec commit: only this file, even if something else is staged.
  if ! git commit -m "heartbeat-cron tick $n" -- "$LOG_FILE"; then
    log "tick $n: commit failed"
    return 1
  fi

  # Push with retries: 2s/4s/8s/16s backoff.
  local delay
  for delay in 0 2 4 8 16; do
    [ "$delay" -gt 0 ] && sleep "$delay"
    if git push -u origin "$BRANCH"; then
      log "tick $n: pushed ($ts)"
      return 0
    fi
    log "tick $n: push failed (will retry)"
  done
  log "tick $n: PUSH FAILED after all retries — commit exists locally only"
  return 1
}

run() {
  echo $$ > "$PID_FILE"
  log "scheduler loop up: pid=$$ interval=${INTERVAL_SECONDS}s branch=$BRANCH"
  while :; do
    tick || true
    sleep "$INTERVAL_SECONDS"
  done
}

alive() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

start() {
  if alive; then
    echo "already running (pid $(cat "$PID_FILE"))"
    exit 1
  fi
  setsid bash "$REPO_DIR/heartbeat-cron.sh" run >> "$OUT_FILE" 2>&1 < /dev/null &
  sleep 1
  if alive; then
    echo "started (pid $(cat "$PID_FILE")); ticks every ${INTERVAL_SECONDS}s; output -> $OUT_FILE"
  else
    echo "FAILED to start; see $OUT_FILE"
    exit 1
  fi
}

stop() {
  if ! alive; then
    echo "not running"
    rm -f "$PID_FILE"
    exit 0
  fi
  kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE" && echo "stopped"
}

status() {
  if alive; then
    echo "running (pid $(cat "$PID_FILE"))"
  else
    echo "NOT running"
  fi
  echo "--- last output ---"
  [ -f "$OUT_FILE" ] && tail -n 3 "$OUT_FILE"
  echo "--- last tick ---"
  [ -f "$LOG_FILE" ] && tail -n 1 "$LOG_FILE" || echo "(no ticks yet)"
}

case "${1:-}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  tick)   tick ;;
  run)    run ;;
  *) echo "usage: $0 {start|stop|status|tick|run}"; exit 2 ;;
esac
