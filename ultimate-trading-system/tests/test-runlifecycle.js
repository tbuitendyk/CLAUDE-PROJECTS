// A RUN THAT STOPS MUST SAY SO, AND A RUN THAT IS FINISHED WITH MUST BE
// REMOVABLE (owner, 2026-08-22).
//
// What happened: the owner started their first wide sweep — 123,624 units, 100
// null boards — pressed the theme button, and came back to an empty form. A few
// minutes later the job was gone. The Sweep section said "No job running.",
// which is the same thing it says when nothing was ever started.
//
// The service had died of a full JavaScript heap, five minutes in, 316 units
// through. Two things put it there and both are fixed here:
//
//   * pool.map keeps every worker result until the run ends. Every long-job
//     caller in this codebase streams its results through onSettled and never
//     looks at the array — so all six were holding one result per unit that
//     nothing would ever read. pool.forEach is the same thing without the array.
//
//   * saveBatch rewrites the WHOLE run document, pretty-printed, and the
//     per-unit callbacks called it once per unit. This run's document was 2 MB
//     (its declared set alone is 1.4 MB), so finishing would have meant
//     building a 2 MB string 123,624 times. Progress saves are throttled now;
//     anything that ENDS something still writes at once.
//
// And two things about being told:
//
//   * an interrupted run records WHERE it got to and WHY it stopped, on the
//     record, because by the time anyone looks the thing that stopped it is
//     gone from the screen;
//   * the Sweep section reports a job that ended badly instead of saying the
//     same words it says for no job at all.
//
// Watched failing 2026-08-22: reverting any one of the four fails its own test
// below; putting `saveBatch` back in the per-unit callbacks fails
// perUnitTicksDoNotRewriteTheWholeDocumentEveryTime.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

// The older sweep engine's run lifecycle — interruption, resume, deletion, the
// census rows — went with that engine (3.97.0). What is left here is what
// still runs: the pool's streaming contract, the service's heap ceiling, and
// the three-stage Sweep form's memory.
module.exports = {
  // ---------------------------------------------------------- the heap itself
  // THE defect. A streaming caller must not be handed an array it never reads.
  async forEachKeepsNothingAndMapStillCollects() {
    const { Pool } = require('../lib/pool');
    const pool = new Pool(1);            // inline lane: no worker threads in tests
    try {
      const payloads = [1, 2, 3, 4, 5].map((n) => n);
      const seen = [];
      const nothing = await pool.forEach('ping', payloads, (settled, i) => { seen.push(i); });
      assert.strictEqual(nothing, undefined,
        'forEach must return nothing — a caller who wanted the array has to find out at once, not read silent nulls');
      assert.deepStrictEqual(seen, [0, 1, 2, 3, 4], 'every payload still reaches onSettled, in order');

      const collected = await pool.map('ping', payloads);
      assert.strictEqual(collected.length, 5, 'map still hands back one slot per payload');
      for (const c of collected) assert.strictEqual(c.ok, true, 'and each slot carries its result');
    } finally { pool.abort(); }
  },
  // The ceiling the box runs under has to be the one this service is allowed,
  // not the one node picks for itself — and the three numbers that say so have
  // to stay in order. They are set in one file and mean nothing apart:
  //
  //   heap  <  MemoryHigh  <  MemoryMax
  //
  // Below MemoryHigh nothing is throttled. Between High and Max the kernel
  // reclaims hard. Above Max it kills THIS service, which is the boundary that
  // keeps a spike here from letting the kernel pick a victim elsewhere on a box
  // that also holds the owner's mail and business machines.
  //
  // A heap at or above High means the soft brake bites during ordinary work; a
  // heap above Max means the service is killed before the collector is even
  // asked to try. Raised together 1792/2G/3G -> 3072/3.5G/4G (2026-08-30), and
  // the suffix is read rather than assumed: this pinned `(\d+)G` and went red
  // the moment a number needed to be half a gigabyte.
  theServiceRunsWithAHeapCeilingThatMatchesItsAllowance() {
    const unit = fs.readFileSync(path.join(ROOT, 'deploy', 'ultimate-trading-system.service'), 'utf8');
    const mb = (name) => {
      const m = unit.match(new RegExp(`^${name}=(\\d+)([KMGT]?)$`, 'm'));
      assert.ok(m, `the unit must still declare ${name}`);
      return Number(m[1]) * ({ '': 1 / 1048576, K: 1 / 1024, M: 1, G: 1024, T: 1048576 })[m[2]];
    };
    const m = unit.match(/--max-old-space-size=(\d+)/);
    assert.ok(m, 'the unit must set a heap ceiling — node\'s own default is about 1 GB and this service is allowed more');
    const heapMb = Number(m[1]);
    const highMb = mb('MemoryHigh');
    const maxMb = mb('MemoryMax');
    assert.ok(heapMb < highMb,
      `the heap ceiling (${heapMb} MB) must sit below MemoryHigh (${highMb} MB) — node's non-heap footprint needs room too`);
    assert.ok(highMb < maxMb,
      `MemoryHigh (${highMb} MB) must sit below MemoryMax (${maxMb} MB), or the soft brake never gets a chance to work`);
    assert.ok(heapMb > 1024,
      `a ceiling of ${heapMb} MB is no better than node's own default — the sweep died at 1024 MB`);
    // AND THE NON-HEAP FOOTPRINT NEEDS REAL ROOM, not a token gap. Node's own
    // buffers, the gzip streams and the record buffers live outside the heap,
    // and this service has been measured at about 400 MB of them while working.
    assert.ok(highMb - heapMb >= 400,
      `only ${highMb - heapMb} MB sits between the heap ceiling and MemoryHigh — node's non-heap footprint has been `
      + 'measured near 400 MB while this service works, so the soft brake would bite during ordinary work');
  },
  // ------------------------------------------------------- the form remembers
  //
  // NARROWED 2026-08-28. This used to check three things at once: that the
  // boxes survive a redraw, that a RUNNING job's settings are shown in them
  // instead, and that the owner's draft is only remembered while it is the
  // owner's own. The middle two were the old Sweep's running-job mirror, which
  // went with that screen; the three-stage Sweep reports a running job on its
  // own progress line and never writes into the boxes, so there is no mirror
  // to guard and nothing for the draft to be overwritten by. What is left is
  // the property that is still live, and it is checked against the code that
  // still does it.
  theSweepFormSurvivesARedraw() {
    assert.ok(/const SWEEP_FORM_KEY = /.test(UI), 'the form must keep what is in it across a redraw');
    assert.ok(/document\.querySelectorAll\('#view \[id\^="sw"\]'\)/.test(UI),
      'the control list must be asked of the page — a list written here needs remembering when a control is added');
    assert.ok(/restoreSweepForm\(\);/.test(UI), 'nothing writes the remembered draft back into the boxes');
    assert.ok(/for \(const el of sweepControls\(\)\) \{\n\s*const onChange = \(\) => \{\n\s*rememberSweepForm\(\);/.test(UI),
      'the boxes are no longer remembered on every change');
    assert.ok(/el\.addEventListener\('change', onChange\);\n\s*el\.addEventListener\('input', onChange\);/.test(UI),
      'typing is not remembered — only leaving the box is, so a draft is lost by flipping away mid-word');
  },
};
