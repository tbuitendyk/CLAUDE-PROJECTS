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
        // A STAND-DOWN IS WRITTEN DOWN WHEN IT IS DECIDED, NOT WHEN IT IS PRICED
        // (owner, 2026-08-25: "the software used to give the stand down
        // immediately. fix that again").
        //
        // Recording used to be gated on the PRICE for every side alike. The
        // reasoning was sound as far as it went — compareDecision treated a
        // recorded null price against a recomputed real one as a divergence, so a
        // priceless record would manufacture a break the moment the entry candle
        // cached. But the price is the open of a candle an HOUR after the vote is
        // known, so the effect was that a declined day stayed invisible for that
        // whole hour while the owner watched an empty decision history.
        //
        // The gate now splits in two, because it was always answering two
        // different questions with one flag:
        //
        //   `priced`     — is there a fill price? A LONG or SHORT record claims
        //                  one, and the box rejects a priceless INTENT outright
        //                  (INTENT_INVALID problems:["decision_price"]).
        //   `recordable` — is there something true to write down? A FLAT decision
        //                  is complete without a price: no order is placed, so
        //                  there is nothing to fill and nothing to price.
        //
        // compareDecision was taught the matching rule — a recorded FLAT with no
        // price makes no price claim, so there is nothing to compare — and ONLY
        // for FLAT: a priceless LONG or SHORT record still breaks, which is the
        // protection QC 169 was written for and it is untouched.
        //
        // A FLAT is re-recorded WITH its price on the later tick that can fetch
        // one, and loadDecisions keeps the last record per period, so the record
        // is upgraded in place rather than duplicated.
        //
        // Applies identically to paper and live setups: this loop does not
        // branch on state, and `paper` is only a flag on the shipped intent.
        const priced = !!(out.actionable && out.intent && out.intent.decision_price != null);
        const recordable = priced
          || !!(out.actionable && out.intent && out.intent.side === 'FLAT');
        let recordedOk = false;
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
            recordedOk = true;
          } catch (e) {
            process.stderr.write(`live-produce(${setup.id}): decision record write FAILED, withholding intent: ${e.message}\n`);
            out = { ok: true, actionable: false, note: 'decision record write failed; intent withheld this tick' };
          }
        }
        // DO NOT RE-SHIP A PERIOD THE BOX HAS ALREADY SEEN (owner, 2026-08-25).
        //
        // actionableChunk keeps a chunk actionable for its WHOLE hold — 137h on
        // this geometry — so every hourly tick re-offered a period that was
        // already dealt with. The box defends itself (INTENT_DUPLICATE, and the
        // staleness bound), so nothing was ever double-traded; but the outbox
        // filled with re-offers, and when the box was halted on 2026-08-24 they
        // queued for fifteen hours and came out as a burst of INTENT_STALE the
        // moment the halt lifted. Noise that looks like an incident is a cost:
        // it trains the reader to skim the incident panel.
        //
        // The box's own rule is "have I already seen an INTENT for this setup
        // and period" — so mirror exactly that here, off the synced journal,
        // rather than inventing a second rule that can disagree with it. If the
        // journal is stale we ship and the box dedupes, which is the same
        // outcome as before: this can only reduce noise, never add risk.
        //
        // NOTE a FLAT intent is NOT suppressed on its first pass. It places no
        // order, and it is how a stand-down reaches the box and becomes the
        // INTENT_SEEN that the decision history renders. Dropping it would
        // silently delete every declined day from the record.
        let alreadySeen = false;
        if (out.actionable && out.intent) {
          try {
            const { readJournal, journalFile } = require('./lib/live/view');
            const { events } = readJournal(journalFile());
            alreadySeen = events.some((e) => e && e.event === 'INTENT_SEEN'
              && e.setup_id === setup.id && e.chunk_start === out.intent.chunk_start);
          } catch (_) { alreadySeen = false; }   // unreadable journal: ship, let the box dedupe
        }
        // FAIL CLOSED, FOR REAL THIS TIME. The rule above this block has always
        // said "no decision record, no shipped intent" — but it was only enforced
        // when the record WRITE threw. When the decision was simply not
        // recordable (no entry price), the intent shipped anyway, priceless, and
        // the box rejected it: INTENT_INVALID problems:["decision_price"], twice
        // today alone. A stated rule that the code does not keep is worse than no
        // rule, because the comment is what the next reader trusts.
        if (out.actionable && out.intent && !recordedOk) {
          process.stderr.write(`live-produce(${setup.id}): decision for ${out.intent.chunk_start} `
            + 'was not recorded, so no intent is shipped (fail-closed)\n');
        }
        // AND A PRICELESS INTENT IS NEVER SHIPPED, recorded or not. The record
        // and the intent have different requirements and always did: the record
        // is ours to keep, the intent is a message to the box, and the box
        // rejects one without a price. Now that a FLAT is recordable before it is
        // priced, `recordedOk` alone would let exactly the rejected message out
        // again — the fault this whole change started from.
        if (out.actionable && out.intent && recordedOk && !priced) {
          process.stderr.write(`live-produce(${setup.id}): stand-down for ${out.intent.chunk_start} `
            + 'is recorded but has no entry price yet — the intent waits for the candle\n');
        }
        if (out.actionable && out.intent && recordedOk && priced && !alreadySeen) {
          const stamp = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
          atomicWrite(path.join(OUTBOX, `intent2-${setup.id}-${stamp}.json`), JSON.stringify(out.intent) + '\n');
        } else if (alreadySeen) {
          process.stderr.write(`live-produce(${setup.id}): period ${out.intent.chunk_start} already `
            + 'recorded on the box (INTENT_SEEN) — not re-shipping\n');
        }
        // THE CALL MUST NOT EVAPORATE THE MOMENT IT MATTERS (owner, 2026-08-25).
        //
        // computePreview only previews the window between the feature close and
        // the entry hour. One second past the entry hour it reports "nothing to
        // preview" — and this used to overwrite the saved call with that, every
        // tick. So the decided call was readable from 00:00 to 01:00 and then
        // erased, leaving nothing on screen between the entry hour and the fill:
        // the exact window in which the owner is watching to see what is about
        // to happen. The screen went blank at the worst possible minute.
        //
        // So an AVAILABLE preview always overwrites; an unavailable one only
        // writes when there is nothing worth keeping. The saved call is retired
        // by SUPERSESSION instead — lib/live/view.js drops it once a decision
        // for the same window is recorded — with a one-day abandonment bound so
        // a dead producer cannot leave yesterday's call reading as today's.
        const preview = await signal.computePreview(setup, now)
          .catch((e) => ({ available: false, note: 'preview compute failed: ' + (e && e.message) }));
        const previewFile = path.join(PREVIEWS, `${setup.id}.json`);
        let keepSaved = false;
        if (!preview.available) {
          try {
            const saved = JSON.parse(fs.readFileSync(previewFile, 'utf8'));
            keepSaved = !!(saved && saved.available);
          } catch (_) { keepSaved = false; }   // nothing saved — write the reason
        }
        if (!keepSaved) {
          atomicWrite(previewFile,
            JSON.stringify({ ...preview, written_utc: new Date(now).toISOString() }));
        }
        // Say out loud when a decision was NOT written down, and why. A
        // silently unrecorded period is exactly the hole this change closes;
        // replacing it with a quieter hole would be no improvement.
        const unrecorded = out.actionable && out.intent && !recordable
          ? `decision NOT recorded yet: entry price for ${out.intent.chunk_start} is not available `
            + '(the entry candle has not cached) — it is written on a later tick this period'
          : null;
        if (unrecorded) process.stderr.write(`live-produce(${setup.id}): ${unrecorded}\n`);
        results.push({ setup: setup.id, state: setup.state, actionable: !!out.actionable,
          side: out.intent ? out.intent.side : null, recorded: !!recordedOk,
          reshipSuppressed: !!alreadySeen,
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
