#!/usr/bin/env bash
# pilot-sbin-check.sh -- post-install smoke (QC 107): assert every orchestrator
# script AND its $HERE-resolved siblings are actually present and executable in
# /usr/local/sbin, and that pilot-arm-fields.sh (the arm gate) behaves — a
# well-formed arm passes, an injection-bearing disarm is neutralised. Read-only;
# touches nothing on the box. Run after pilot-install.sh.
set -uo pipefail
SBIN=/usr/local/sbin
fail=0

echo "== installed orchestrator scripts =="
# Box-level carries plus the trading rail. pilot-mirror.sh and pilot-tick.sh went
# with the retired single-config rail; live-tick.sh, live-produce-and-push.sh and
# live-alert.sh are what actually run the profiles and were never checked here —
# so the installer could skip installing them and this smoke stayed green.
for f in pilot-produce-and-push.sh pilot-arm-fields.sh pilot-stop-state.sh \
         pilot-unhalt-fields.sh pilot-alert.sh pilot-sync-journal.sh \
         pilot-sync.sh live-tick.sh live-produce-and-push.sh live-alert.sh; do
  if [ -x "$SBIN/$f" ]; then echo "  ok  $f"; else echo "  MISSING/!x  $f"; fail=1; fi
done

echo "== pilot-arm-fields.sh behaviour =="
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
GN="0123456789abcdef01"; GU="2026-08-11T12:34:56.789Z"; GH=$(printf 'a%.0s' {1..64})

printf '{"armed":true,"nonce":"%s","utc":"%s","hmac":"%s"}' "$GN" "$GU" "$GH" > "$TMP/arm.json"
OUT=$("$SBIN/pilot-arm-fields.sh" "$TMP/arm.json")
[ "$OUT" = "1 $GN $GU $GH" ] && echo "  ok  well-formed arm passes" || { echo "  FAIL well-formed arm: [$OUT]"; fail=1; }

printf '{"armed":false,"nonce":"%s"}' "';reboot;'" > "$TMP/dis.json"
OUT=$("$SBIN/pilot-arm-fields.sh" "$TMP/dis.json")
[ "$OUT" = "0 - - -" ] && echo "  ok  injection-bearing disarm -> safe sentinels" || { echo "  FAIL disarm injection: [$OUT]"; fail=1; }

echo "== pilot-stop-state.sh behaviour =="
printf '{"stopPct":0.349}' > "$TMP/s.json"
OUT=$("$SBIN/pilot-stop-state.sh" "$TMP/s.json")
[ "$OUT" = "SET 0.3490000000" ] && echo "  ok  valid stop -> SET full precision" || { echo "  FAIL stop-state SET: [$OUT]"; fail=1; }
printf '{bad json' > "$TMP/c.json"
OUT=$("$SBIN/pilot-stop-state.sh" "$TMP/c.json")
[ "$OUT" = "ERROR" ] && echo "  ok  corrupt stop file -> ERROR (retain)" || { echo "  FAIL stop-state ERROR: [$OUT]"; fail=1; }

echo "----"
[ "$fail" = 0 ] && echo "SBIN CHECK: ALL PASS" || { echo "SBIN CHECK: FAILURES"; exit 1; }
