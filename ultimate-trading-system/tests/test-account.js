// WHAT THIS ACCOUNT PAYS TO TRADE IS THE OWNER'S NUMBER (owner order,
// 2026-09-18: "the source of the FEE_PER_LEG constant that's NOT in code but
// given by the user").
//
// Until 3.166.0 the cost of getting in and out was a constant nothing on any
// screen could move, while the Coins screens measured every figure against it
// and one column -- windows paid -- made an earnings claim out of it. These
// guard the three things that must hold: the number is stored and read back,
// a percent typed where a fraction belongs is refused rather than charged, and
// nothing that has not been set pretends to have been.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');

// THE REAL FILE IS THE OWNER'S AND IS NEVER WRITTEN BY A TEST. It is moved
// aside, the test runs against a clean one, and it is put back whatever
// happens -- including when an assertion throws.
function onACleanFile(body) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  const had = fs.existsSync(SETTINGS);
  const keep = had ? fs.readFileSync(SETTINGS) : null;
  const parked = `${SETTINGS}.testparked${process.pid}`;
  if (had) fs.renameSync(SETTINGS, parked);
  delete require.cache[require.resolve('../lib/account')];
  try {
    return body(require('../lib/account'));
  } finally {
    try { fs.unlinkSync(SETTINGS); } catch (_) { /* it may not have been written */ }
    if (had) fs.renameSync(parked, SETTINGS);
    else if (keep) fs.writeFileSync(SETTINGS, keep);
    delete require.cache[require.resolve('../lib/account')];
  }
}

// NOT SET AND SET-TO-THE-BUILT-IN ARE DIFFERENT FACTS. A fresh box has no fee
// entered; the built-in stands in so nothing on the Coins screens goes blank,
// and `set: false` is what makes every screen say so instead of presenting a
// figure nobody chose as though somebody had.
function anUnsetFeeSaysItIsUnsetRatherThanLookingChosen() {
  onACleanFile((acc) => {
    const one = acc.exchanges();
    assert(one.length >= 1, 'at least one exchange is offered');
    assert(one.every((e) => e.feePerLeg === null), 'nothing is entered on a fresh box, and that reads as nothing — not as nought');
    assert(one.every((e) => !e.isDefault), 'and nothing is the system default yet');
    const f = acc.systemFee();
    assert(f.set === false, 'the reading says plainly that the owner has not set it');
    assert(Math.abs(f.feePerLeg - require('../lib/paper').FEE_PER_LEG) < 1e-12,
      'the built-in stands in, so no figure on the Coins screens goes blank while it is unset');
    assert(Math.abs(f.roundTripPct - 0.25) < 1e-12, `and that built-in is 0.25% the round trip, got ${f.roundTripPct}`);
    assert(/built-in/.test(f.from), `and it names itself so a screen can attribute it, got ${JSON.stringify(f.from)}`);
  });
}

// SET IT, AND IT IS WHAT THE SYSTEM CHARGES ITSELF. Both directions: stored
// and read back on the exchange, and reported as the one in force.
function theFeeTheOwnerEntersIsTheFeeTheSystemCharges() {
  onACleanFile((acc) => {
    const got = acc.setExchange('binance', { feePerLeg: 0.001, isDefault: true });
    assert(Math.abs(got.feePerLeg - 0.001) < 1e-12, `it is stored on the exchange, got ${got.feePerLeg}`);
    assert(got.isDefault === true, 'and it is the system default');
    assert(Math.abs(got.roundTripPct - 0.2) < 1e-12, `0.1% each way is 0.2% the round trip, got ${got.roundTripPct}`);
    const f = acc.systemFee();
    assert(f.set === true, 'the reading now says the owner set it');
    assert(Math.abs(f.roundTripPct - 0.2) < 1e-12, `and the system charges itself 0.2%, got ${f.roundTripPct}`);
    assert(f.from === 'Binance', `attributed to the venue it came from, got ${JSON.stringify(f.from)}`);
    assert(Math.abs(acc.roundTripPct() - 0.2) < 1e-12, 'and the short reader agrees with the long one');

    // CHANGING IT MOVES WHAT EVERY CLAIM IS MEASURED AGAINST, at once, with no
    // walk being run again
    acc.setExchange('binance', { feePerLeg: 0.002 });
    assert(Math.abs(acc.roundTripPct() - 0.4) < 1e-12, `a changed fee changes the round trip, got ${acc.roundTripPct()}`);
    assert(acc.systemFee().set === true, 'and it is still the owner\'s, not the built-in');

    // UNTICKING IT HANDS THE JOB BACK TO THE BUILT-IN, and says so
    acc.setExchange('binance', { isDefault: false });
    assert(acc.systemFee().set === false, 'unticked, it stops being the system default');
    assert(Math.abs(acc.exchanges()[0].feePerLeg - 0.002) < 1e-12,
      'but the fee itself is KEPT — unticking chooses not to use it, it does not throw it away');
  });
}

// A PERCENT TYPED WHERE A FRACTION BELONGS IS THE HUNDRED-TIMES MISTAKE. 0.125
// entered as 0.125 instead of 0.00125 would charge 0.125 of the position a leg
// — 12.5% — and every figure on every screen would move with it. paper.feeRate
// already refuses that and this is the guard that it is actually consulted.
function aFeeThatCouldOnlyBeATypingMistakeIsRefusedByName() {
  onACleanFile((acc) => {
    assert.throws(() => acc.setExchange('binance', { feePerLeg: 0.125 }), /12\.5%|fraction/i,
      'a tenth of the position a leg is not a fee anybody chose and is refused');
    assert.throws(() => acc.setExchange('binance', { feePerLeg: -1 }), /real fraction/i, 'nor a negative one');
    assert.throws(() => acc.setExchange('binance', { feePerLeg: Number.NaN }), /real fraction/i, 'nor one that is not a number');
    assert.throws(() => acc.setExchange('kraken', { feePerLeg: 0.001 }), /not an exchange this system knows/,
      'and an exchange this system cannot trade on is refused by name, not stored and forgotten');
    // nothing above was written
    assert(acc.exchanges().every((e) => e.feePerLeg === null), 'a refused fee is not half-stored');
    // and the edge that IS legal stays legal
    acc.setExchange('binance', { feePerLeg: 0 });
    assert(acc.exchanges()[0].feePerLeg === 0, 'nought is a real fee — a venue that charges nothing is a venue');
  });
}

// THE LIST OF EXCHANGES COMES FROM HERE, NEVER FROM THE PAGE (RULE FIVE). The
// Account tab draws one record per entry and holds no list of its own, so a
// second venue appears on the screen the day it is added here.
function theScreenFillsItselfFromTheListAndHoldsNoneOfItsOwn() {
  const acc = require('../lib/account');
  assert(Array.isArray(acc.EXCHANGES) && acc.EXCHANGES.length >= 1, 'the list is here');
  assert(acc.EXCHANGES.some((e) => e.id === 'binance' && e.label === 'Binance'),
    'and Binance is on it, which is the one venue supported today');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  assert(/aAcc\.exchanges\.map\(/.test(page), 'the page draws one record per exchange the service reports');
  assert(!/['"]Binance['"]/.test(page.replace(/<!--[\s\S]*?-->/g, '')),
    'and the page does NOT name Binance itself — a list typed on a screen is a list that goes stale');
}


// THE ACCOUNT TAB IS WHERE IT IS ENTERED, AND IT IS ENTERED IN ONE PLACE
// (owner order, 2026-09-18: "the exchange record under Account needs to
// indicate at least a basic Binance trading profile, and under that the
// Binance FEE_PER_LEG with the option to use as the system default under
// Compute").
//
// Two boxes for one number is the fault to guard here, not a missing one:
// Compute is where the system-wide settings are READ, so it shows the figure
// in force and points back at Account. If it ever grows a box of its own, the
// two can disagree and neither screen can say which is lying.
function theFeeIsTypedOnAccountAndOnlyShownOnCompute() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  const account = page.slice(page.indexOf('function drawAccount()'), page.indexOf('// ---- Compute'));
  const compute = page.slice(page.indexOf('function drawCompute()'), page.indexOf('function draw()'));
  assert(account.length > 400 && compute.length > 400, 'both panels are there to read');

  // THE EXCHANGE RECORD, with the fee and the tick under it
  assert(/id="acFee_/.test(account), 'each exchange record carries a fee box');
  assert(/fee each way, %/.test(account), 'named in the unit a venue quotes, each way');
  assert(/id="acDef_/.test(account) && /use as the system default/.test(account),
    'and the tick that makes it the one the system charges itself');
  assert(/id="acSave_/.test(account), 'and a press that saves it');
  assert(/Save '/.test(account) || /Save <\/g/.test(account) || /'Save '/.test(account),
    'the press starts with a capital letter, as every press on every screen does');

  // COMPUTE SHOWS IT AND OFFERS NO BOX
  assert(/What it costs to trade/.test(compute), 'Compute says what it costs to trade');
  assert(/cCfg\.fee/.test(compute), 'reading the figure the service reports');
  assert(/Account<\/b> tab/.test(compute), 'and pointing at where it is entered');
  assert(!/acFee_|id="cFee/.test(compute), 'and it offers NO box of its own — one number, one place to type it');

  // AND THE UNSET CASE IS SAID OUT LOUD ON BOTH, never dressed as a choice
  assert(/standing in/.test(account) && /standing in/.test(compute),
    'both screens say plainly when the built-in is standing in for a figure the owner has not entered');
}

// A TICK BOTTOM-ALIGNS TO THE FIELD BESIDE IT AND A BUTTON GETS ITS OWN ROW
// (RULE FOUR-A, owner order 2026-09-17). The caption sits above its box in
// this layout, so the pair is two lines tall; a one-line tick centred against
// it floats in the middle instead of sitting on the box's own line. And a
// button jammed onto the bottom of a text field is the thing the owner called
// ugly in the same breath.
function theAccountTicksBottomAlignAndItsButtonHasItsOwnRow() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  const account = page.slice(page.indexOf('function drawAccount()'), page.indexOf('// ---- Compute'));
  // the row holding the fee field and the tick
  const mixed = /'<div class="row" style="align-items:flex-end; margin-top:\.4rem">'[\s\S]*?acDef_/.exec(account);
  assert(mixed, 'the row that holds a tick beside a field carries flex-end, always');
  // THE PRESS IS NOT IN THAT ROW. The tick's row is closed and a new one is
  // opened for it — read as one pattern so the two halves cannot drift apart.
  assert(/use as the system default<\/label>'\s*\n\s*\+ '<\/div>'\s*\n\s*\+ '<div class="row" style="margin-top:\.5rem"><button id="acSave_/.test(account),
    'the tick row is CLOSED and the press opens a row of its own — a press stuck on the bottom of a text field is the thing the owner called ugly');
  assert(/<span id="acOut_/.test(account), 'with its message beside it, which is where saved, or why not, is said');
}


// TEXT AT DIFFERENT SIZES SITS ON ONE BASELINE (owner, 2026-09-18: "not bottom
// aligning text like this on setup | account and setup | compute looks sloppy:
// 'IN FORCE 0.250% the round trip 0.125% each way, from Binance'").
//
// .row is align-items:center. .k is .66rem, .note is .74rem and a plain <b> is
// full size, so three sizes centred sit on three different lines and none of
// them line up with any other. Baseline puts them on one. The page's own
// heading strip had already worked this out and said so in a comment; I added
// two more rows without reading it.
//
// COUNTED, NOT LOOKED AT (RULE FOUR-A). Walking every row is a few lines and
// answers in a second, so a row added tomorrow cannot quietly be wrong. A row
// holding a FORM CONTROL is a different case and keeps centre — except a tick
// beside a field, which bottom-aligns, and which the guard above covers.
function everyRowOfMixedSizeTextOnSetupSitsOnOneBaseline() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  const SIZED = [/<span class="k">/, /class="note"/, /<b[ >]/, /class="muted"/];
  const wrong = [];
  let mixed = 0;
  let i = 0;
  for (;;) {
    i = page.indexOf('<div class="row"', i + 1);
    if (i < 0) break;
    const end = page.indexOf('</div>', i);
    const body = page.slice(i, end < 0 ? i + 900 : end);
    const open = body.slice(0, body.indexOf('>') + 1);
    const inner = body.slice(open.length);
    const kinds = SIZED.filter((re) => re.test(inner)).length;
    if (kinds < 2) continue;
    if (/<input|<select|<button|<textarea/.test(body)) continue;
    mixed++;
    if (!/align-items:baseline/.test(open)) wrong.push(page.slice(0, i).split('\n').length);
  }
  assert(mixed >= 5, `there are rows of mixed-size text on this page to check — found ${mixed}`);
  assert(wrong.length === 0,
    `a row of text at different sizes must carry align-items:baseline, or the sizes sit on different lines and look sloppy. Line(s): ${wrong.join(', ')}`);
  // and the rule is written down beside .row, where the next one gets added
  assert(/A ROW OF TEXT AT DIFFERENT SIZES CARRIES align-items:baseline/.test(page),
    'the rule is stated in the stylesheet, not only in a test nobody reads while writing a row');
}

module.exports = {
  anUnsetFeeSaysItIsUnsetRatherThanLookingChosen,
  theFeeTheOwnerEntersIsTheFeeTheSystemCharges,
  aFeeThatCouldOnlyBeATypingMistakeIsRefusedByName,
  theScreenFillsItselfFromTheListAndHoldsNoneOfItsOwn,
  theFeeIsTypedOnAccountAndOnlyShownOnCompute,
  theAccountTicksBottomAlignAndItsButtonHasItsOwnRow,
  everyRowOfMixedSizeTextOnSetupSitsOnOneBaseline,
};
