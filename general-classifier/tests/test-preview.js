// TODAY'S CALL, VISIBLE BEFORE IT ACTS (owner, 2026-08-25).
//
// On the live daily-4d geometry the committee's feature window closes at 00:00
// UTC and the entry acts at 01:00 UTC. The call is therefore KNOWN for a full
// hour before anything happens — and live-produce.js has been writing it to
// data/live/previews/<id>.json on every tick all along.
//
// Nothing read it back. The setup status had no preview field, so the screen
// could show a call only once the entry moment turned it into a recorded
// history row. The owner sat looking at a history whose newest row was
// yesterday, while today's vote sat on disk, and asked where it was.
//
// The "what happens next" panel had the matching hole: it computed the next
// entry moment and never listed it, so it could announce the next EVALUATION a
// day out while an already-decided entry was minutes away. It also emitted its
// rows in the order the code built them, so a 23-hour item sat above a
// 17-hour one under a heading that promises what happens NEXT.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const view = require(path.join(ROOT, 'lib', 'live', 'view'));

const SETUP = {
  id: 'setup-test-1', name: 'T', state: 'live', clipUsd: 10,
  configSnapshot: { branch: { geometry: 'daily-4d' }, cell: { tHours: 137, quorum: 3 } },
};

function withPreview(obj, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcprev-'));
  const prev = process.env.GC_LIVE_PREVIEWS;
  process.env.GC_LIVE_PREVIEWS = dir;
  try {
    if (obj !== null) fs.writeFileSync(path.join(dir, `${SETUP.id}.json`), JSON.stringify(obj));
    return fn();
  } finally {
    if (prev === undefined) delete process.env.GC_LIVE_PREVIEWS;
    else process.env.GC_LIVE_PREVIEWS = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const future = () => new Date(Date.now() + 45 * 60000).toISOString();
const past = () => new Date(Date.now() - 3 * 3600000).toISOString();

function aDecidedCallIsReadableBeforeItActs() {
  const got = withPreview({
    available: true, side: 'SHORT', per_member: [-1, -1, 0, 1], quorum: 3,
    chunk_start: '2026-08-21T00:00:00.000Z', entry_utc: future(),
    computed_utc: new Date().toISOString(), written_utc: new Date().toISOString(),
  }, () => view.loadPreview(SETUP.id));
  assert.ok(got && got.available,
    'the call is on disk and its entry has not arrived — it must be readable, or the screen '
  + 'cannot show today\'s vote until an hour after the committee knew it');
  assert.strictEqual(got.side, 'SHORT');
  assert.deepStrictEqual(got.votes, [-1, -1, 0, 1], 'the member votes must come through');
}

function aCallStaysVisibleThroughItsOwnEntryHour() {
  // THE BLIND WINDOW. The first cut expired a call the instant its entry hour
  // arrived — which is when it matters most and is least visible: not filled
  // yet, no decision row yet, owner watching. The screen went blank at the
  // worst minute. A call past its entry is ACTING, not gone.
  const got = withPreview({
    available: true, side: 'LONG', per_member: [1, 1, 1, 1], quorum: 3,
    entry_utc: past(), written_utc: past(),
  }, () => view.loadPreview(SETUP.id));
  assert.strictEqual(got.available, true,
    'a call whose entry hour has arrived but has not filled must STILL be shown — '
  + 'blanking here is the blind window this panel exists to close');
  assert.strictEqual(got.acting, true, 'and it must be marked as acting, not pending');
}

function aCallAbandonedForADayIsNotTodaysCall() {
  // The bound that replaces the clock-expiry: a file left by a dead producer
  // must not read as today's call forever.
  const old = new Date(Date.now() - 30 * 3600000).toISOString();
  const got = withPreview({
    available: true, side: 'LONG', per_member: [1, 1, 1, 1], quorum: 3,
    entry_utc: old, written_utc: old,
  }, () => view.loadPreview(SETUP.id));
  assert.strictEqual(got.available, false, 'a day-old unrecorded call is abandoned, not current');
  assert.strictEqual(got.abandoned, true, 'and the reason must be nameable');
}

function aRecordedDecisionSupersedesThePreview() {
  // Once the call is on the record it IS that history row. Showing the preview
  // as well would show one decision twice, in two places, disagreeing about
  // whether it has happened. Driven through setupStatus with a real journal so
  // this tests the rule and not a fixture.
  const CHUNK = '2026-08-21T00:00:00.000Z';
  const jf = process.env.GC_LIVE_JOURNAL;
  const jpath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gcj-')), 'journal.jsonl');
  fs.writeFileSync(jpath, JSON.stringify({
    event: 'INTENT_SEEN', setup_id: SETUP.id, chunk_start: CHUNK,
    side: 'SHORT', utc: '2026-08-25T01:08:00Z',
  }) + '\n');
  process.env.GC_LIVE_JOURNAL = jpath;
  try {
    const st = withPreview({
      available: true, side: 'SHORT', per_member: [-1, -1, 0, 1], quorum: 3,
      chunk_start: CHUNK, entry_utc: future(), written_utc: new Date().toISOString(),
    }, () => view.setupStatus(SETUP));
    assert.ok((st.decisions || []).some((d) => d.chunk_start === CHUNK),
      'fixture sanity: the journal must produce a decision row for this window');
    assert.strictEqual(st.preview, null,
      'the preview must be dropped once its window has a recorded decision — otherwise the '
    + 'same call shows twice, once as pending and once as history');
  } finally {
    if (jf === undefined) delete process.env.GC_LIVE_JOURNAL;
    else process.env.GC_LIVE_JOURNAL = jf;
  }
}

function theProducersOwnReasonIsPassedThrough() {
  const got = withPreview({ available: false, note: 'feature window has not closed yet' },
    () => view.loadPreview(SETUP.id));
  assert.strictEqual(got.available, false);
  assert.ok(/feature window/.test(got.note || ''),
    'when there is no call yet the producer says why — show that, not silence');
}

function amissingPreviewFileIsAStateNotACrash() {
  assert.strictEqual(withPreview(null, () => view.loadPreview(SETUP.id)), null);
}

function theStatusEndpointActuallyCarriesThePreview() {
  // The gap this test closes: every other check here calls loadPreview() or
  // nextActivity() directly, so setupStatus() could stop attaching the preview
  // and the whole suite would still pass while the screen went blank again.
  const jf = process.env.GC_LIVE_JOURNAL;
  process.env.GC_LIVE_JOURNAL = path.join(os.tmpdir(), 'gc-no-such-journal.jsonl');
  try {
    const st = withPreview({
      available: true, side: 'SHORT', per_member: [-1, -1, 0, 1], quorum: 3,
      chunk_start: '2026-08-21T00:00:00.000Z', entry_utc: future(),
      computed_utc: new Date().toISOString(), written_utc: new Date().toISOString(),
    }, () => view.setupStatus(SETUP));
    assert.ok(st.preview, 'setupStatus must attach the preview — this is the field the screen reads');
    assert.strictEqual(st.preview.available, true);
    assert.strictEqual(st.preview.side, 'SHORT');
  } finally {
    if (jf === undefined) delete process.env.GC_LIVE_JOURNAL;
    else process.env.GC_LIVE_JOURNAL = jf;
  }
}

function whatHappensNextIsInTimeOrder() {
  const now = Date.parse('2026-08-25T00:58:00Z');
  const st = {
    state: 'live', clipUsd: 10, halted: false, preview: null,
    openPositions: [
      { side: 'LONG', exit_due_ts: Date.parse('2026-08-26T18:10:00Z') / 1000, entry_utc: '2026-08-21T01:10:00Z' },
      { side: 'LONG', exit_due_ts: Date.parse('2026-08-25T18:10:00Z') / 1000, entry_utc: '2026-08-20T01:10:00Z' },
    ],
  };
  const items = view.nextActivity(st, SETUP, now).items;
  const times = items.filter((i) => i.whenUtc).map((i) => Date.parse(i.whenUtc));
  const sorted = times.slice().sort((a, b) => a - b);
  assert.deepStrictEqual(times, sorted,
    'the panel is titled "what happens next" — an evaluation 23h out must not sit above an '
  + 'exit 17h out just because the code built it first');
}

function anAlreadyDecidedEntryIsListedAsAboutToHappen() {
  const now = Date.parse('2026-08-25T00:58:00Z');
  const st = {
    state: 'live', clipUsd: 10, halted: false, openPositions: [],
    preview: { available: true, side: 'SHORT', votes: [-1, -1, 0, 1],
               entryUtc: '2026-08-25T01:00:00.000Z' },
  };
  const items = view.nextActivity(st, SETUP, now).items;
  const row = items.find((i) => /Open a SHORT position/.test(i.what));
  assert.ok(row, 'an entry two minutes away, from a call already decided, must appear — omitting '
                + 'the next thing to happen makes the panel read as an all-clear');
  assert.strictEqual(row.whenUtc, '2026-08-25T01:00:00.000Z');
}

function aFlatCallSaysNothingOpens() {
  const now = Date.parse('2026-08-25T00:58:00Z');
  const st = {
    state: 'live', clipUsd: 10, halted: false, openPositions: [],
    preview: { available: true, side: 'FLAT', votes: [0, 0, 0, 0],
               entryUtc: '2026-08-25T01:00:00.000Z' },
  };
  const items = view.nextActivity(st, SETUP, now).items;
  assert.ok(items.some((i) => /Stand down/.test(i.what)),
    'a FLAT call must be stated, not left blank — blank reads as "not decided yet"');
}

function undatedRowsSinkToTheBottom() {
  const now = Date.parse('2026-08-25T00:58:00Z');
  const st = {
    state: 'stopped', clipUsd: 10, halted: false, preview: null,
    openPositions: [{ side: 'LONG', exit_due_ts: Date.parse('2026-08-25T18:10:00Z') / 1000,
                      entry_utc: '2026-08-20T01:10:00Z' }],
  };
  const items = view.nextActivity(st, SETUP, now).items;
  const undatedAt = items.findIndex((i) => !i.whenUtc);
  assert.ok(undatedAt === items.length - 1,
    'a state ("nothing opens, this profile is stopped") is not an event and must not take a '
  + 'place in the timeline');
}

function theProducerDoesNotEraseADecidedCall() {
  // live-produce.js is a script, not a module, so this is a source assertion
  // rather than a behavioural one — weaker, and said plainly. It exists because
  // the bug it guards was invisible for the worst possible hour: computePreview
  // reports "nothing to preview" one second past the entry hour, and writing
  // that over the saved call blanked the screen exactly when the owner was
  // watching for the entry.
  const src = fs.readFileSync(path.join(ROOT, 'live-produce.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(/keepSaved/.test(code),
    'the guard that stops an unavailable preview overwriting a decided call is gone — '
  + 'the call will vanish from the screen at its entry hour again');
  assert.ok(/if \(!keepSaved\)/.test(code),
    'the write is no longer conditional on keepSaved');
}

module.exports = {
  theProducerDoesNotEraseADecidedCall,
  aDecidedCallIsReadableBeforeItActs,
  aCallStaysVisibleThroughItsOwnEntryHour,
  aCallAbandonedForADayIsNotTodaysCall,
  aRecordedDecisionSupersedesThePreview,
  theProducersOwnReasonIsPassedThrough,
  amissingPreviewFileIsAStateNotACrash,
  theStatusEndpointActuallyCarriesThePreview,
  whatHappensNextIsInTimeOrder,
  anAlreadyDecidedEntryIsListedAsAboutToHappen,
  aFlatCallSaysNothingOpens,
  undatedRowsSinkToTheBottom,
};
