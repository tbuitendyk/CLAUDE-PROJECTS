// WHAT GETS SENT TO A BROWSER (owner order, 2026-08-23: "fix that so the system
// always chunk data PROPERLY to browsers").
//
// The Construct page once asked the older engine for a run's replication table and the server
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

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const CX = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

// The older engine's paged replies — the replication table, the runs picker,
// one configuration's coins — went with that engine (3.97.0). What is left is
// what still grows: the three-stage tables and their paging bar, and the guard
// that measures every reply.
module.exports = {
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
  async theGuardIsInstalledBeforeAnyRoute() {
    const guard = SERVER.indexOf("installPayloadGuard");
    assert.ok(guard > 0, 'nothing measures what the server sends');
    const firstRoute = SERVER.search(/\napp\.(get|post|delete)\(/);
    assert.ok(guard < firstRoute,
      'the guard is installed after some routes, so those routes are not covered — it has to be before all of them');
  },
};
