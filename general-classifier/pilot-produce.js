#!/usr/bin/env node
// pilot-produce.js -- emit the current F1 order-intent as JSON on stdout.
//
// Runs on the VPS inside the deployed classifier (it needs lib/pilotsignal and
// the candle cache). A VPS timer runs it, writes the JSON to a file, and ships
// that file to the Mexico box's intents/ directory (pilot-produce-and-push.sh).
// This process places NO orders and reaches only Binance's public data channel,
// exactly as the forward book does. No AI anywhere (PILOT-F1.md section 4).
//
// It refuses to invent a timestamp: "now" is real wall-clock here because the
// intent is a live decision, but the executor independently rejects any intent
// older than 30 minutes, so a stale produce cannot trade.
//
// Exit 0 with an intent, 0 with {actionable:false} when nothing is due, non-zero
// only on a real failure (no data, engine mismatch) so the caller can tell the
// difference between "nothing to do" and "broken".
const { computeSignal } = require('./lib/pilotsignal');
const mirror = require('./lib/pilotmirror');

(async () => {
  try {
    const out = await computeSignal(Date.now());
    // Persist the live decision so the mirror check has an AUTHORITATIVE record
    // of what we decided on, checked later against a fresh recompute — never
    // against a re-read that may have silently swapped data source (finding 7).
    if (out.actionable && out.intent && out.intent.side !== 'FLAT') {
      try {
        mirror.writeDecision({
          chunk_start: out.intent.chunk_start,
          side: out.intent.side,
          per_member: out.intent.per_member,
          quorum: out.intent.quorum,
          band_pct: out.intent.band_pct,
          decision_price: out.intent.decision_price,
          input_hash: out.intent.input_hash,
          config_version: out.intent.config_version,
          train_through: out.intent.train_through,
          produced_utc: out.intent.produced_utc,
          // an actionable intent required a complete feature window at decision
          // time, so if a later recompute cannot find that window the DATA
          // vanished — the mirror treats that as a break, not benign 'pending'.
          window_complete: true,
        });
      } catch (e) {
        // FAIL CLOSED (re-review): a live fill with no recorded decision has no
        // mirror twin — the exact gap the mirror exists to close. If the record
        // cannot be persisted, do NOT ship an actionable intent this tick; the
        // next tick retries and ships once the record lands.
        process.stderr.write('pilot-produce: decision record write FAILED, withholding intent: ' + e.message + '\n');
        out = { ok: true, actionable: false, note: 'decision record write failed; intent withheld this tick' };
      }
    }
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write('pilot-produce FAILED: ' + err.message + '\n');
    process.exit(1);
  }
})();
