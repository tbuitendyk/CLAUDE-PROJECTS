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
          // EVERY CONFIGURATION GETS ITS OWN NAME. The first version of this
          // fixture used `q${c % 6 + 1}/6`, which gave 250 configurations six
          // distinct labels — so `rank` saw six groups and the per-configuration
          // size check was measuring a fortieth of what it claimed to. A fixture
          // that collides is a test that passes on the wrong thing.
          declaredLabel: `breakout directional d0.75x t${89 + c}h trail1.5x arm0.5x q${c % 6 + 1}/6`,
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
    // This used to calibrate itself against the OLD shape by asking for
    // per-configuration example rows (detailCap) and watching them balloon.
    // Since 2026-08-25 that shape is not reachable at all: the tally ships
    // summaries and nothing else, whatever is asked for — which is the
    // stronger form of the same guarantee, and it is pinned first.
    const size = (assets, cap) => Buffer.byteLength(JSON.stringify(replication.rank(repDoc(40, assets), { detailCap: cap })));
    assert.strictEqual(size(40, 60), size(40, 0),
      'asking for example rows changed the reply — the shape that reached 99 MB is reachable again');
    const newGrowth = size(40, 0) / size(5, 0);        // what ships
    assert.ok(newGrowth < 1.25,
      `8x the rows grew the reply ${newGrowth.toFixed(2)}x; it is tracking the rows again`);
    // What creep remains is digits, not rows: a count of 5 becomes 40, and a
    // sum of 21 becomes 168.00000000000006 once forty floats have been added.

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

  // The rows are not gone — an opened line asks the saved tally for ONE
  // configuration's coins (owner go, 2026-08-26: the per-row walk is
  // retired), and that reply pages honestly and says how many there are.
  async oneConfigurationsCoinsAreReachableAndCounted() {
    const doc = repDoc(3, 40);
    const label = replication.rank(doc).scored[0].label;
    const d = replication.coins(doc, { label, limit: 10 });
    assert.strictEqual(d.rows.length, 10, 'the reply pages');
    assert.strictEqual(d.page.total, 40, 'and it says how many coins it did not send');
    assert.ok(d.rows.every((r) => r.label === label), 'another configuration\'s coins leaked into the line');
  },

  // REMOVED 2026-08-28 with the screen it named: theScreenFetchesThoseCoinsWhenALineIsOpened
  // checked that opening a line on the old Boards' ranked replication list
  // fetched that configuration's coins once, on the toggle, from
  // api/.../replication-coins rather than the retired per-row walk. That whole
  // list was on the deleted Boards. The server side of it — replication.coins
  // paging and counting honestly — is still checked by
  // oneConfigurationsCoinsAreReachableAndCounted and
  // aConfigurationsCoinsCanBeWalkedToTheEnd, above and below.

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

  // ---- every table that can grow is pageable ------------------------------
  //
  // "make it sane and pageable" (owner, 2026-08-23). Four tables grew with the
  // run and each had a different answer: one shipped everything and reached
  // 99 MB, one capped at 500 rows with no way to ask for the 501st, one capped
  // at 400, one had no limit at all.
  //
  // RE-AIMED 2026-08-28 at the surviving screens. pageBar and the four tables
  // it served were on the deleted Boards; every table on the three-stage Boards
  // pages through bPager. The property is the same one and it is checked the
  // same way: a table that grows with the run must be walkable, and a page must
  // say what it is a page of.
  async everyTableThatCanGrowHasAPagingBar() {
    for (const [key, why] of [
      ['S1', 'the stage 1 table'],
      ['S2', 'the stage 2 table'],
      ['S3R', 'the stage 3 settings, ranked'],
      ['S3C', 'every coin of every setting'],
    ]) {
      assert.ok(CX.includes(`, '${key}')`),
        `${why} has no paging bar — it is a table that grows and cannot be walked`);
    }
    // The bar is drawn on four tables, so its buttons cannot carry ids. They
    // are addressed by the key of the table they page, and one function wires
    // every one of them.
    assert.ok(/data-bpage="\$\{key\}:/.test(CX), 'the bar\'s buttons are not addressable');
    assert.ok(/function bWirePager\(/.test(CX), 'nothing listens for a page being asked for');
    assert.ok(/\$\(root\)\.querySelectorAll\('\[data-bpage\]'\)\.forEach/.test(CX),
      'the pager is wired by walking the table just drawn — a listener left on the whole page would fire '
      + 'once per redraw since load, and one click would jump several pages at once');
  },

  // A page that does not say what it is a page OF is a short list that reads as
  // a complete one. That is the whole point, so it is checked on the bar itself.
  // RUN, NOT GREPPED. Reading the source for the words it prints passes on a
  // bar that has been short-circuited to print them and nothing else — a
  // mutation planted exactly that and this test stayed green. So the shipped
  // function is executed, and what it returns is what gets checked.
  async apageAlwaysStatesTheTrueTotalOnScreen() {
    const src = CX.slice(CX.indexOf('function bPager('), CX.indexOf('// THE SORT SELECTORS'));
    assert.ok(src.length > 100, 'the paging bar is gone');
    // eslint-disable-next-line no-new-func
    const bPager = new Function(`${src}; return bPager;`)();

    // A LIST THAT FITS still says how many rows it holds — silence there reads
    // as "this is all of it".
    const small = bPager(37, 0, 100, 'S1');
    assert.ok(small.includes('37 row(s)'), `a short list must state its own size; got: ${small}`);
    assert.ok(!/data-bpage/.test(small), 'a list that fits offers page buttons, or a page to type, that go nowhere');

    // A LIST THAT DOES NOT FIT says the true total, which page this is, how
    // many there are, and offers both directions.
    const big = bPager(2500, 300, 100, 'S3C');
    assert.ok(big.includes('2,500 rows'),
      `the bar does not print the true total, so a page reads as the whole list; got: ${big}`);
    // WHICH PAGE OF HOW MANY — the page you are on now sits IN the box you
    // type the next one into (owner order, 2026-08-29), so the same control
    // both says where you are and takes you somewhere else.
    assert.ok(/data-bpageto="S3C"[^>]*value="4"/.test(big), `the box does not show which page this is; got: ${big}`);
    assert.ok(big.includes('of 25'), `the bar does not say how many pages there are; got: ${big}`);
    assert.ok(/data-bpageto="S3C"[^>]*max="25"/.test(big) && /data-bpageto="S3C"[^>]*min="1"/.test(big),
      `the box takes a page number that is not on the table; got: ${big}`);
    assert.ok(/data-bpageto="S3C"[^>]*data-bper="100"/.test(big),
      `the box does not carry how big a page is, so nothing can turn a page number into a row; got: ${big}`);
    assert.ok(big.includes('data-bpage="S3C:200"'), `prev must step back one page; got: ${big}`);
    assert.ok(big.includes('data-bpage="S3C:400"'), `next must step forward one page; got: ${big}`);

    // ...and neither end walks off the list.
    assert.ok(bPager(2500, 0, 100, 'S1').includes('data-bpage="S1:0"'), 'prev on page 1 must stay on page 1');
    assert.ok(bPager(2500, 2400, 100, 'S1').includes('data-bpage="S1:2400"'), 'next on the last page must stay there');
  },

  // REMOVED 2026-08-28 with the screens they named:
  //   * apagedBoardStillPointsAtTheRightRow — the survivor board's row handlers
  //     looked their row up by index into the WHOLE list, so paging it without
  //     making that index absolute would have opened the wrong row silently.
  //     That board was on the deleted Boards. The three-stage tables address
  //     their rows by a key built from the row's own contents (data-bkey,
  //     data-brec), never by page position, so the fault cannot recur in the
  //     shape this guarded.
  //   * theMenuGridIsNoLongerCutOffAtFourHundred — the menu grid was on the
  //     deleted Boards and has no counterpart.

  // The coins behind one configuration are reachable to the last one.
  async aConfigurationsCoinsCanBeWalkedToTheEnd() {
    const doc = repDoc(2, 250);
    const label = replication.rank(doc).scored[0].label;
    const seen = new Set();
    let offset = 0;
    let guard = 0;
    for (;;) {
      const d = replication.coins(doc, { label, offset, limit: 40 });
      assert.strictEqual(d.page.total, 250, 'a page must say how many there are in total, on every page');
      d.rows.forEach((r) => seen.add(r.trade));
      if (!d.page.more) break;
      offset += d.rows.length;
      assert.ok(++guard < 50, 'paging never reached the end — it is looping');
    }
    assert.strictEqual(seen.size, 250,
      `walked the pages and saw ${seen.size} of 250 coins — some are unreachable from the screen`);
  },

  async theRankedListCanBeWalkedToTheEnd() {
    const doc = repDoc(250, 3);
    const seen = new Set();
    let offset = 0;
    for (;;) {
      const r = replication.rank(doc, { offset, limit: 40 });
      assert.strictEqual(r.page.total, r.configs, 'the page total and the real count disagree');
      r.scored.forEach((g) => seen.add(g.label));
      if (!r.page.more) break;
      offset += r.scored.length;
    }
    assert.strictEqual(seen.size, 250, 'the ranked list cannot be walked to its end');

    // AND THE PAGE ASKED FOR IS THE PAGE RETURNED. Walking alone did not prove
    // this: 250 configurations fit inside one page, so the walk finished in a
    // single request and passed with the paging bypassed altogether.
    const mid = replication.rank(doc, { offset: 100, limit: 25 });
    assert.strictEqual(mid.scored.length, 25, 'the requested page size was ignored');
    assert.strictEqual(mid.page.offset, 100, 'the requested offset was ignored');
    const whole = replication.rank(doc, { offset: 0, limit: 1000 });
    assert.strictEqual(mid.scored[0].label, whole.scored[100].label,
      'page 5 does not start where page 5 should — the offset is not being applied to the sorted order');
  },

  async theGuardIsInstalledBeforeAnyRoute() {
    const guard = SERVER.indexOf("installPayloadGuard");
    assert.ok(guard > 0, 'nothing measures what the server sends');
    const firstRoute = SERVER.search(/\napp\.(get|post|delete)\(/);
    assert.ok(guard < firstRoute,
      'the guard is installed after some routes, so those routes are not covered — it has to be before all of them');
  },
};
