#!/usr/bin/env node
// live-parity.js -- THE GOLDEN PARITY GATE (IMPLEMENTATION-PLAN 2.3).
//
// F1 expressed as a TradingSetup, pushed through the GENERALIZED producer
// (lib/live/signal.js), must reproduce the existing pilotsignal decisions
// BYTE-IDENTICALLY on the real cache: same side, same per-member votes, same
// input hash, same decision price, same pending semantics, chunk by chunk.
// Any divergence means the generalized engine is a DIFFERENT instrument than
// the one the greenlight/forward evidence was measured on — and nothing built
// downstream of it can be trusted (the QC-register lesson: a broken
// instrument returns plausible numbers, not errors).
//
// Runs ON THE VPS where the real candle cache lives (scripts/
// live-parity-check.sh). Local suites use fabricated symbols instead — tests
// must never write or delete real-symbol cache files (a poisoned live cache
// is unrecoverable evidence damage).
//
// Exit 0 = parity PROVEN over the compared span. Exit 1 = divergence(s),
// each printed. Exit 2 = could not compare (no data, engine mismatch).
const pilotsignal = require('./lib/pilotsignal');
const liveSignal = require('./lib/live/signal');
const { buildCombo } = require('./lib/bracketwork');
const { BOOKS, TRAIN_THROUGH } = require('./lib/forwardbook');

const N = Number(process.env.PARITY_CHUNKS || 40); // newest N comparable chunks

(async () => {
  try {
    const F1 = BOOKS.find((b) => b.id === 'F1');
    const setup = {
      id: 'f1-parity', state: 'live', clipUsd: 10, stopPct: null,
      configSnapshot: {
        combo: { ...F1.combo }, branch: { ...F1.branch }, stage: F1.stage,
        members: F1.members.map((m) => ({ ...m })), cell: { ...F1.cell },
        trainThrough: TRAIN_THROUGH,
        configVersion: pilotsignal.CONFIG_VERSION,   // SAME version string -> hashes must collide
      },
    };

    // Candidate chunks: those with a complete feature window in today's cache,
    // newest N. Both sides get the same list; each side re-verifies its own
    // guards internally.
    const { geo, maps, chunks } = await buildCombo(F1.combo, F1.branch,
      { allLoaded: true, feePerLeg: 0, includeUnlabeled: true });
    const HOUR = 3600000;
    const complete = chunks.filter((c) => {
      const last = c.startTs + (geo.featureHours - 1) * HOUR;
      return maps.trade.get(last) && (!maps.ctx1 || maps.ctx1.get(last)) && (!maps.ctx2 || maps.ctx2.get(last));
    });
    const targets = complete.slice(-N);
    if (!targets.length) {
      console.error('PARITY: no comparable chunks in cache');
      process.exit(2);
    }

    let compared = 0;
    let divergences = 0;
    for (const t of targets) {
      const a = await pilotsignal.computeSignalForChunk(t.startTs);
      const b = await liveSignal.computeSignalForChunk(setup, t.startTs);
      if (a.found !== b.found) {
        divergences++;
        console.error(`DIVERGE ${new Date(t.startTs).toISOString()}: found ${a.found} vs ${b.found} (${a.note || ''} | ${b.note || ''})`);
        continue;
      }
      if (!a.found) continue; // both refused identically — consistent
      compared++;
      const fields = ['side', 'decision_price', 'input_hash', 'quorum', 'band_pct', 'price_pending'];
      const diffs = fields.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
      if (JSON.stringify(a.per_member) !== JSON.stringify(b.per_member)) diffs.push('per_member');
      if (diffs.length) {
        divergences++;
        console.error(`DIVERGE ${new Date(t.startTs).toISOString()}: ${diffs.join(', ')}`);
        for (const f of [...diffs]) {
          console.error(`   ${f}: pilot=${JSON.stringify(a[f === 'per_member' ? 'per_member' : f])} generalized=${JSON.stringify(b[f === 'per_member' ? 'per_member' : f])}`);
        }
      }
    }

    console.log(`PARITY: ${compared} chunks compared byte-for-byte, ${divergences} divergence(s), `
      + `${targets.length - compared - divergences} refused identically on both sides`);
    if (divergences) {
      console.error('PARITY: FAILED — the generalized engine is NOT the same instrument. Do not build on it.');
      process.exit(1);
    }
    console.log('PARITY: PASS — F1 through lib/live/signal.js reproduces pilotsignal exactly on this cache.');
    process.exit(0);
  } catch (err) {
    console.error('PARITY: could not run: ' + err.message);
    process.exit(2);
  }
})();
