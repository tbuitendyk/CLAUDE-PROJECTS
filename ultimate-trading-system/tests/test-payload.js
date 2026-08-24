// WHAT GETS SENT TO A BROWSER (owner order, 2026-08-23: "fix that so the system
// always chunk data PROPERLY to browsers").
//
// The Construct page asked one run for its replication table and the server
// began assembling a 99 MB reply — 2,772 configurations each carrying up to 60
// example rows. The screen never showed anything; the request never finished.
// Measured, not guessed: 166,320 rows at 595 bytes.
//
// The runs picker was worse in its own way. Every saved run's parameters ride
// on its picker row, including the expanded declared set — 500 KB on that run,
// eighteen runs, and the picker is fetched on every draw of three separate
// sections. 9 MB, three times a visit, of a field no screen has ever read.
//
// THE PROPERTY THESE TESTS PIN is not "the reply is small". It is that the
// reply STOPS GROWING WITH THE DATA. A size limit chosen today is a number that
// goes stale; "doubling the rows does not change the reply" does not.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { page, installPayloadGuard, MAX_BYTES, MAX_LIMIT } = require('../lib/payload');
const replication = require('../lib/replication');
const batch = require('../lib/batch');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const CX = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

// A replication doc with `configs` configurations scored on `assets` assets,
// each with one real row and one dealt-vote copy. Rows live in the document
// itself, which is the pre-row-store shape and needs no disk.
function repDoc(configs, assets) {
  const rows = [];
  for (let c = 0; c < configs; c++) {
    for (let a = 0; a < assets; a++) {
      for (const seed of [null, 1]) {
        rows.push({
          declaredLabel: `breakout directional d0.75x t89h trail1.5x arm0.5x q${c % 6 + 1}/6`,
          nullDealSeed: seed, trade: `SYM${a}USDT`, ctx1: null, ctx2: null,
          geometry: 'daily-4d', bandPct: 1.37, windowLayout: 'reserve61', entry: 'breakout',
          quorum: 3, members: 6, pnl: 12.34, trades: 87, wins: 44, grossPerTrade: 0.41,
          holds: { alwaysLong: -5.1 }, trailMult: 1.5, armMult: 0.5,
          holdout: { pnl: seed == null ? 4.2 : 1.1, trades: 19, vsAlwaysLong: 2.1 },
        });
      }
    }
  }
  return { id: 'payload-test', replication: rows, leaders: [] };
}

// A minimal stand-in for the express app, so the guard is exercised for real
// rather than by reading its source.
function fakeApp() {
  const mw = [];
  return {
    use: (fn) => mw.push(fn),
    call(body, route = '/api/thing') {
      const req = { method: 'GET', path: route, route: { path: route } };
      let sent = null; let status = 200; const headers = {};
      const res = {
        json: (b) => { sent = b; return b; },
        status: (c) => { status = c; return res; },
        setHeader: (k, v) => { headers[k] = v; },
      };
      mw.forEach((fn) => fn(req, res, () => {}));
      res.json(body);
      return { sent, status, headers };
    },
  };
}

module.exports = {
  // ---- the shared pager ----------------------------------------------------
  async aPageAlwaysSaysHowManyThereReallyAre() {
    const rows = Array.from({ length: 2772 }, (_, i) => i);
    const p = page(rows);
    assert.strictEqual(p.total, 2772, 'a page must carry the true total, or a short list reads as a complete one');
    assert.strictEqual(p.shown, p.rows.length);
    assert.strictEqual(p.more, true);
    const last = page(rows, { offset: 2700, limit: 100 });
    assert.strictEqual(last.shown, 72);
    assert.strictEqual(last.more, false, 'the last page must not claim there is more');
    assert.strictEqual(last.total, 2772, 'and it still says how many there are');
  },

  async aHandTypedLimitCannotRebuildTheFault() {
    const rows = Array.from({ length: 5000 }, (_, i) => i);
    assert.strictEqual(page(rows, { limit: 999999 }).limit, MAX_LIMIT,
      'a caller can ask for everything again, which is the fault the paging removes');
    assert.strictEqual(page(rows, { limit: 0 }).limit, 1, 'a zero limit must not return an empty page for ever');
    assert.strictEqual(page(rows, { offset: -5 }).offset, 0);
    assert.strictEqual(page(rows, { offset: 'nonsense' }).offset, 0, 'junk falls back rather than throwing');
    assert.strictEqual(page(null).total, 0, 'nothing to page is a page of nothing, not a crash');
  },

  // ---- the guard -----------------------------------------------------------
  async everyReplyIsMeasuredAndAnAbsurdOneIsRefused() {
    const seen = [];
    const app = fakeApp();
    installPayloadGuard(app, { log: (m) => seen.push(m) });

    const small = app.call({ ok: true, rows: [1, 2, 3] });
    assert.strictEqual(small.status, 200, 'an ordinary reply must go through untouched');
    assert.deepStrictEqual(small.sent, { ok: true, rows: [1, 2, 3] });
    assert.ok(small.headers['X-Payload-Bytes'], 'every reply carries its own size, so growth is visible before it bites');
    assert.strictEqual(seen.length, 0, 'an ordinary reply must not be logged');

    const huge = app.call({ rows: new Array(400000).fill('xxxxxxxxxxxxxxxxxxxxxxxxx') }, '/api/batch/:id/replication');
    assert.strictEqual(huge.status, 500, 'a reply no browser can take was sent anyway');
    assert.ok(/over the 8 MB ceiling/.test(huge.sent.error), `the refusal must say what happened: ${huge.sent.error}`);
    assert.ok(/replication/.test(huge.sent.route), 'the refusal must name the route, or nobody knows what to page');
    assert.ok(/Nothing is wrong with your data/.test(huge.sent.error),
      'the refusal must say the data is fine — this is the screen protecting itself, not a lost result');
    assert.ok(seen.some((m) => /REFUSED/.test(m)), 'a refusal must reach the log as well as the screen');
  },

  async aReplyThatIsMerelyGettingFatIsReportedNotRefused() {
    const seen = [];
    const app = fakeApp();
    installPayloadGuard(app, { log: (m) => seen.push(m) });
    const r = app.call({ rows: new Array(60000).fill('yyyyyyyyyyyyyyyyyyyy') }, '/api/batches');
    assert.strictEqual(r.status, 200, 'a large but workable reply must still be delivered');
    assert.ok(seen.some((m) => /api\/batches/.test(m)), 'nothing said it was growing, which is how it grew');
    assert.ok(!seen.some((m) => /REFUSED/.test(m)));
  },

  // ---- the 99 MB one, as a property ---------------------------------------
  async theRankedListDoesNotGrowWithTheRowsBehindIt() {
    // 40 configurations, then the same 40 over 8x and 40x as many rows. The
    // reply is allowed to creep — `assets: 5` becomes `assets: 200` and a
    // total gains digits — but it must not TRACK the rows. Byte-for-byte
    // equality was the first version of this check and it failed on exactly
    // that creep, which is a real difference worth keeping straight: digits
    // grow like the logarithm of the data, embedded rows grow like the data.
    const at = (assets) => Buffer.byteLength(JSON.stringify(replication.rank(repDoc(40, assets))));
    const few = at(5);
    const more = at(40);      // 8x the rows
    const most = at(200);     // 40x the rows
    assert.ok(more < few * 1.1,
      `8x the rows took the reply from ${few} to ${more} bytes — it is still growing with the rows behind it, `
      + 'which is exactly how it reached 99 MB');
    assert.ok(most < few * 1.2,
      `40x the rows took the reply from ${few} to ${most} bytes; only the digits of the counts may grow`);

    // It DOES grow with the number of configurations, because that is what the
    // list is a list of. That is the bound, and it must be a sane one.
    const perConfig = Buffer.byteLength(JSON.stringify(replication.rank(repDoc(200, 20)))) / 200;
    assert.ok(perConfig < 400,
      `each configuration costs ${perConfig.toFixed(0)} bytes of reply; 2,772 of them must stay a readable payload`);

    // And the counts survive: dropping the sample rows must not drop the fact
    // of how many rows there are.
    const g = replication.rank(repDoc(3, 7)).scored[0];
    assert.strictEqual(g.reals.length, 0, 'the ranked list is shipping example rows again');
    assert.strictEqual(g.realsTotal, 7, 'the count of rows behind a configuration was lost with the rows');
  },

  // The rows are not gone — they are fetched for one configuration at a time,
  // and that reply says how many there really are.
  async oneConfigurationsRowsAreStillReachableAndStillCounted() {
    const doc = repDoc(3, 40);
    const label = replication.rank(doc).scored[0].label;
    const d = replication.detail(doc, label, { limit: 10 });
    assert.strictEqual(d.shown, 10, 'the detail reply is capped');
    assert.strictEqual(d.matched, 40, 'and it says how many it did not send');
    assert.ok(d.matched > d.shown, 'this is the case the screen must report, or a capped table reads as complete');
    assert.ok(!d.rows.some((r) => r.nullDealSeed != null), 'a dealt-vote copy is machinery and never an asset row');
  },

  async theScreenFetchesThoseRowsWhenALineIsOpened() {
    assert.ok(/class="repdetail"/.test(CX), 'the screen has nowhere to put a configuration\'s rows');
    assert.ok(/replication-detail/.test(CX), 'the screen never asks for them, so the tables are empty');
    assert.ok(/addEventListener\('toggle'/.test(CX), 'the rows are fetched up front again rather than on opening a line');
    assert.ok(/if \(box\.dataset\.loaded\) return;/.test(CX),
      'opening a line twice asks the server twice');
    assert.ok(/could not read this configuration/.test(CX),
      'a failed read leaves an empty table, and empty is not the same answer as could-not-ask');
  },

  // ---- the picker, which was fetched three times a visit -------------------
  async theRunsPickerDoesNotCarryWhatNoScreenReads() {
    const declaredSet = new Array(2772).fill({
      entry: 'breakout', gate: 'directional', dMult: 0.25, tHours: 17,
      quorumSingles: 1, label: 'q1/6 directional d0.25x t17h',
    });
    const full = { universe: ['LTCUSDT'], declared: { entry: 'breakout' }, declaredPermute: { agree: true }, declaredSet };
    const trimmed = batch.screenParams(full);

    assert.strictEqual(trimmed.declaredSet, undefined, 'the expanded set is on the picker row again');
    assert.strictEqual(trimmed.declaredSetCount, 2772,
      'the count went with the list — a screen can act on how many there are, and now cannot see either');
    assert.ok(Buffer.byteLength(JSON.stringify(trimmed)) < 500,
      'a picker row is still carrying kilobytes of settings, and the picker is fetched on every draw');

    // The settings a screen DOES read must survive, or "copy settings into the
    // form" quietly stops copying the replication boxes.
    assert.deepStrictEqual(trimmed.declared, full.declared, 'the declared config itself was trimmed away');
    assert.deepStrictEqual(trimmed.declaredPermute, full.declaredPermute, 'the permute ticks were trimmed away');
    assert.deepStrictEqual(trimmed.universe, full.universe);

    // A run that never declared anything must come back untouched, not gain a
    // field that says it declared none.
    assert.strictEqual(batch.screenParams({ universe: ['X'] }).declaredSetCount, undefined);
    assert.strictEqual(batch.screenParams(null), null, 'a run with no parameters is not a crash');
  },

  async bothThePickerAndTheRunDocumentUseTheSameTrim() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');
    assert.ok(/params: screenParams\(d\.params\)/.test(src),
      'the picker row ships the untrimmed parameters again');
    assert.ok(/params: batch\.screenParams\(doc\.params\)/.test(SERVER),
      'one run\'s document ships the untrimmed parameters — the same 500 KB by another route');
  },

  async theGuardIsInstalledBeforeAnyRoute() {
    const guard = SERVER.indexOf("installPayloadGuard");
    assert.ok(guard > 0, 'nothing measures what the server sends');
    const firstRoute = SERVER.search(/\napp\.(get|post|delete)\(/);
    assert.ok(guard < firstRoute,
      'the guard is installed after some routes, so those routes are not covered — it has to be before all of them');
  },
};
