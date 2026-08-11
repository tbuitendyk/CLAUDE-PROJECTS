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

(async () => {
  try {
    const out = await computeSignal(Date.now());
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write('pilot-produce FAILED: ' + err.message + '\n');
    process.exit(1);
  }
})();
