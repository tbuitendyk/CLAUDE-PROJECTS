// A decision is KEYED on its 96h feature-window start but ACTS 97h later. The
// screens dated rows by the window start, so on 2026-08-16 a complete, current
// record (four decisions, one per day since arming) read as "no decisions for
// the past 4 decision days" — the newest row said 2026-08-11. The owner caught
// it. These tests pin the acting stamp and pin the screens to USING it.
//
// Watched failing 2026-08-16: with entry_utc removed from the view and
// the two tables restored to `${(dec.chunk_start||'').slice(0,10)}` in the first
// cell, decisionsCarryTheMomentTheyAct and bothScreensDateRowsByTheActingEntry
// both fail; the vote-wording test fails with vtxt's 0-case back to 'aside'.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assert } = require('./helpers');
const lv = require('../lib/live/view');

const ROOT = path.join(__dirname, '..');
// Every screen that renders the daily decision history. A new one must be added
// here — an unlisted screen can silently reintroduce the window-start label.
// One screen renders the daily decision history now — the duplicate for the
// hardcoded config is gone. A NEW screen must be added here; an unlisted one
// can silently reintroduce the window-start label.
const SCREENS = ['public/trading.html'];

module.exports = {
  // The acting moment is window start + entryOffsetH, in UTC, to the hour.
  decisionEntryUtcAddsTheEntryOffset() {
    assert.strictEqual(
      lv.decisionEntryUtc('2026-08-11T00:00:00.000Z', 97),
      '2026-08-15T01:00:00.000Z',
      'a decision keyed on 2026-08-11 acts at 01:00 on 2026-08-15 (96h window + 1h)',
    );
    assert.strictEqual(
      lv.decisionEntryUtc('2026-08-08T00:00:00.000Z', 97),
      '2026-08-12T01:00:00.000Z',
      'the filled 08-08 decision acted on the 08-12 entry',
    );
  },

  // A different geometry must move the stamp — the 97 is F1's, not a universal.
  decisionEntryUtcHonoursTheSuppliedGeometry() {
    assert.strictEqual(
      lv.decisionEntryUtc('2026-08-11T00:00:00.000Z', 25),
      '2026-08-12T01:00:00.000Z',
      'a 24h-window setup acts a day later, not four',
    );
  },

  // A malformed stamp must render as "—", never silently as the window start:
  // falling back to chunk_start is exactly the confusion this fix removes.
  decisionEntryUtcRefusesAnUnusableStamp() {
    assert.strictEqual(lv.decisionEntryUtc(undefined, 97), null, 'missing stamp -> null');
    assert.strictEqual(lv.decisionEntryUtc('not-a-date', 97), null, 'unparseable stamp -> null');
    assert.strictEqual(lv.decisionEntryUtc('', 97), null, 'empty stamp -> null');
  },

  // Absent a geometry, fall back to F1's 97h rather than dropping the offset —
  // a 0 offset would put the row back on the window start.
  decisionEntryUtcFallsBackToF1RatherThanZero() {
    // An unstated offset is a missing ANSWER now, not a licence to stamp one
    // config's 97h onto another's rows.
    assert.strictEqual(
      lv.decisionEntryUtc('2026-08-11T00:00:00.000Z', undefined),
      null, 'an unstated entry offset must yield null, never a borrowed default',
    );
  },

  // status() must hand the screens the acting stamp on every decision row. Runs
  // against a SYNTHETIC journal rather than the VPS one, so the check fails in a
  // bare checkout too — a test that can only fail on the box is not a check.
  decisionsCarryTheMomentTheyAct() {
    const tmp = path.join(os.tmpdir(), `gc-decisiondate-${process.pid}.jsonl`);
    fs.writeFileSync(tmp, [
      // a filled call and a FLAT one, keyed on their window starts as the box keys them
      JSON.stringify({ event: 'INTENT_SEEN', setup_id: 'sd-1', utc: '2026-08-12T01:05:00Z', chunk_start: '2026-08-08T00:00:00.000Z', side: 'LONG', per_member: [0, 0, 1, 0], quorum: 1, decision_price: 45.55 }),
      JSON.stringify({ event: 'ENTRY_FILL', setup_id: 'sd-1', utc: '2026-08-12T01:10:16Z', chunk_start: '2026-08-08T00:00:00.000Z', side: 'LONG', qty: 0.21, price: 45.59, fee_quote: 0.01, exit_due_ts: 2e9 }),
      JSON.stringify({ event: 'INTENT_SEEN', setup_id: 'sd-1', utc: '2026-08-15T03:05:00Z', chunk_start: '2026-08-11T00:00:00.000Z', side: 'FLAT', per_member: [0, 0, 0, 0], quorum: 1, decision_price: 43.7 }),
    ].join('\n') + '\n');
    try {
      // Through the PROFILE's status now, with the geometry supplying the offset
      // rather than a constant — that is the whole point: a profile on another
      // geometry dates its rows by its own timing, not by this one's.
      const setup = {
        id: 'sd-1', name: 'date test', state: 'live', clipUsd: 10, tradedPair: 'LTCUSDT',
        configSnapshot: { branch: { geometry: 'daily-4d' }, cell: { tHours: 137 } },
      };
      const s = lv.setupStatus(setup, tmp);
      assert.strictEqual(s.journalPresent, true, 'synthetic journal must be read');
      assert.strictEqual(s.decisions.length, 2, 'both decisions are recorded');
      const byWindow = Object.fromEntries(s.decisions.map((d) => [d.chunk_start.slice(0, 10), d]));
      assert.strictEqual(
        byWindow['2026-08-08'].entry_utc, '2026-08-12T01:00:00.000Z',
        'the 08-08 window acted on the 08-12 entry',
      );
      assert.strictEqual(
        byWindow['2026-08-11'].entry_utc, '2026-08-15T01:00:00.000Z',
        'the 08-11 window acted on the 08-15 entry — NOT four days dead',
      );
      for (const d of s.decisions) {
        assert.ok(d.entry_utc > d.chunk_start, 'the acting stamp is later than the window start');
      }
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    }
  },

  // The screens must date rows by entry_utc. A first cell built from chunk_start
  // is the defect itself, so the string is banned from the history tables.
  bothScreensDateRowsByTheActingEntry() {
    for (const rel of SCREENS) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(
        /dec\.entry_utc/.test(src),
        `${rel}: decision rows must be dated from dec.entry_utc`,
      );
      // The window start may still be shown as provenance, but never as the row's
      // leading date cell — that is the exact shape that misread as four days dead.
      const leadWithWindow = /<tr><td[^>]*>\$\{\(dec\.chunk_start\|\|''\)\.slice\(0,\s*10\)\}/;
      assert.ok(
        !leadWithWindow.test(src),
        `${rel}: the row's leading date cell must not be chunk_start`,
      );
    }
  },

  // "aside" was internal shorthand for a member emitting 0. Plain words only.
  voteLabelsSayWhatTheyMean() {
    for (const rel of SCREENS) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(
        !/:\s*'aside'/.test(src),
        `${rel}: a member's 0 vote must read "no call", not "aside"`,
      );
      assert.ok(/'no call'/.test(src), `${rel}: the plain-words vote label must be present`);
    }
  },
};
