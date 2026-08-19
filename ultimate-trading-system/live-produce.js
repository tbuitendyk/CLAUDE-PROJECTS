#!/usr/bin/env node
// live-produce.js -- the MULTI-SETUP producer (IMPLEMENTATION-PLAN 2.4).
//
// Iterates every setup in paper/live state and, for each: computes the
// generalized signal (lib/live/signal.js), records the decision for the
// per-setup mirror BEFORE shipping (fail-closed, the pilot-produce rule),
// writes the intent to data/live/outbox/ for the push script, and refreshes
// the setup's preview. Also derives the per-box ALLOWLIST from the registry —
// the box's fail-closed twin of "which setups may trade here, at what cap".
//
// The RUNNING F1 pilot's pilot-produce.js is untouched; this is the parallel
// generalized rail. No AI anywhere (deterministic math over candles).
const fs = require('fs');
const path = require('path');
const reg = require('./lib/live/setups');
const signal = require('./lib/live/signal');
const b = require('./lib/binance');

const OUTBOX = path.join(__dirname, 'data', 'live', 'outbox');
const PREVIEWS = path.join(__dirname, 'data', 'live', 'previews');
const DECISIONS = path.join(__dirname, 'data', 'live', 'decisions');
const ALLOW_FILE = path.join(__dirname, 'data', 'live', 'setups-allow.json');

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// The allowlist the box enforces (fail-closed there): exactly the configured
// clip — the box lets a setup trade at MOST what the owner configured, so a
// tampered intent upstream cannot resize it.
function allowlistFrom(setups) {
  const allow = {};
  for (const s of setups) {
    allow[s.id] = {
      symbol: s.tradedPair,
      max_clip_usd: s.clipUsd,
      max_concurrent: Math.max(1, Math.ceil(s.configSnapshot.cell.tHours / 24)),
      // R5: the box PINS paper-vs-real and the hold from THIS allowlist, not the
      // intent's own fields — so a tampered/buggy intent can neither drive a paper
      // setup to place REAL orders nor hold a real position indefinitely. Only a
      // setup the registry says is 'live' can ever place a real order.
      state: s.state,                              // 'paper' | 'live'
      max_hold_hours: s.configSnapshot.cell.tHours,
      // WHOSE SUB-ACCOUNT this profile trades from. The box uses it to pick the
      // credentials for a real order, and refuses to place one at all if it holds
      // none for this reference — a profile's money never moves through a wallet
      // that is not its own. Absent on a paper profile, which places no orders.
      key_ref: s.keyRef || null,
    };
  }
  return allow;
}

// Append the live decision to the setup's decision log (the mirror's
// authoritative record — QC 110 semantics arrive with phase 6).
function recordDecision(setupId, dec) {
  const f = path.join(DECISIONS, `${setupId}.jsonl`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, JSON.stringify(dec) + '\n');
}

(async () => {
  try {
    let now = Date.now();
    const socks = process.env.PILOT_SOCKS;
    if (socks) {
      try { const st = b.socksServerTime(socks); if (st) now = st; }
      catch (e) { process.stderr.write('live-produce: exchange-time fetch failed, using OS clock: ' + e.message + '\n'); }
    }
    const liveOpenFetcher = async (symbol, entryTs) => {
      try {
        const rows = await b.recentKlines(symbol, entryTs);
        const row = Array.isArray(rows) ? rows.find((r) => r.ts === entryTs) : null;
        return row && row.open > 0 ? row.open : null;
      } catch (e) {
        process.stderr.write('live-produce: liveOpenFetcher failed: ' + (e && e.message) + '\n');
        return null;
      }
    };

    const active = reg.listSetups().filter((s) => s.state === 'paper' || s.state === 'live');
    // The allowlist is derived EVERY run from the registry — a retired setup
    // falls off it on the next carry, so the box stops honoring it within one
    // sync even if a stale intent lingers.
    atomicWrite(ALLOW_FILE, JSON.stringify(allowlistFrom(active), null, 1));

    const results = [];
    for (const setup of active) {
      try {
        let out = await signal.computeSignal(setup, now, { liveOpenFetcher });
        // A DAY THE COMMITTEE DECLINED IS STILL A DECISION (owner, 2026-08-19).
        //
        // Only non-FLAT calls used to be written down, so a day the members
        // voted no left nothing behind and was indistinguishable from a day
        // this tick never ran. The record also changed shape halfway through
        // its own history: the retired rail DID record declined days, and those
        // came across on migration (9-13 August sit on the profile as FLAT), so
        // the log went from complete to trade-days-only at an invisible seam.
        //
        // A FLAT call is fully reproducible — it carries the same votes, quorum,
        // band, input hash and entry price as a traded one, and the hash covers
        // `side`, so a decline that later recomputes as a trade is a real break
        // the reproduce-check will catch. Recording it strictly increases what
        // is verified.
        //
        // GATED ON THE PRICE, not on the side. compareDecision treats a recorded
        // null price against a recomputed real one as a divergence, so writing a
        // priceless record now would manufacture a break the moment the entry
        // candle caches. The entry hour stays actionable for the whole hold
        // window, so a decline whose candle has not cached yet is simply written
        // on a later tick this same period — and loadDecisions keeps the last
        // record per period, so re-recording is harmless.
        //
        // Applies identically to paper and live setups: this loop does not
        // branch on state, and `paper` is only a flag on the shipped intent.
        const recordable = out.actionable && out.intent && out.intent.decision_price != null;
        if (recordable) {
          // FAIL CLOSED: no decision record, no shipped intent (pilot rule).
          try {
            recordDecision(setup.id, {
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
              paper: out.intent.paper,
              window_complete: true,
            });
          } catch (e) {
            process.stderr.write(`live-produce(${setup.id}): decision record write FAILED, withholding intent: ${e.message}\n`);
            out = { ok: true, actionable: false, note: 'decision record write failed; intent withheld this tick' };
          }
        }
        if (out.actionable && out.intent) {
          const stamp = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
          atomicWrite(path.join(OUTBOX, `intent2-${setup.id}-${stamp}.json`), JSON.stringify(out.intent) + '\n');
        }
        const preview = await signal.computePreview(setup, now)
          .catch((e) => ({ available: false, note: 'preview compute failed: ' + (e && e.message) }));
        atomicWrite(path.join(PREVIEWS, `${setup.id}.json`),
          JSON.stringify({ ...preview, written_utc: new Date(now).toISOString() }));
        // Say out loud when a decision was NOT written down, and why. A
        // silently unrecorded period is exactly the hole this change closes;
        // replacing it with a quieter hole would be no improvement.
        const unrecorded = out.actionable && out.intent && !recordable
          ? `decision NOT recorded yet: entry price for ${out.intent.chunk_start} is not available `
            + '(the entry candle has not cached) — it is written on a later tick this period'
          : null;
        if (unrecorded) process.stderr.write(`live-produce(${setup.id}): ${unrecorded}\n`);
        results.push({ setup: setup.id, state: setup.state, actionable: !!out.actionable,
          side: out.intent ? out.intent.side : null, recorded: !!recordable,
          note: out.note || unrecorded || null });
      } catch (e) {
        results.push({ setup: setup.id, state: setup.state, error: e.message });
        process.stderr.write(`live-produce(${setup.id}): FAILED: ${e.message}\n`);
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, setups: active.length, results }) + '\n');
    // A per-setup failure is visible in results but does not fail the run;
    // a run-level failure (below) exits non-zero.
    process.exit(0);
  } catch (err) {
    process.stderr.write('live-produce FAILED: ' + err.message + '\n');
    process.exit(1);
  }
})();
