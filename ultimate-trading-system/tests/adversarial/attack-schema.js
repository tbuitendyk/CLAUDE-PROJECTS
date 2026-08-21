// Attack 2 — the shape of what is stored.
//
// The system keeps its records as plain files. Nothing stops a file being
// half-written by a crash, edited by hand, left over from an older version of
// the code, or filled with something that is technically valid text and total
// nonsense as a trading record.
//
// The question here is never "does it crash". It is: when a stored record is
// wrong, does the system SAY SO, or does it quietly leave that record out and
// give the owner a total that looks perfectly ordinary?
//
// A refusal is a pass. Silence is a finding.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');

// A configSnapshot that really is valid, so we can spoil one field at a time
// and know the spoiling is what was caught.
function goodConfig() {
  return {
    combo: { trade: 'BTCUSDT', ctx1: 'ETHUSDT', ctx2: 'BNBUSDT', size: 3 },
    branch: { geometry: 'h1', decision: 'argmax', band: 0.5, weekdaysOnly: false },
    stage: 'slim',
    members: [{ model: 'logreg', view: 'full' }],
    cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: 1, tHours: 8, trailMult: 2, armMult: 1 },
    configVersion: 'v1',
  };
}

function run(ctx) {
  const found = [];
  const { validateConfig } = require(path.join(ROOT, 'lib', 'live', 'configschema.js'));
  const { validatePolicy, resolveFreeze } = require(path.join(ROOT, 'lib', 'live', 'trainpolicy.js'));
  const { validName } = require(path.join(ROOT, 'lib', 'live', 'greenlight.js'));
  const { readJournal, deriveSetup } = require(path.join(ROOT, 'lib', 'live', 'view.js'));

  // The geometry name has to be one the code really has, or the "good" config
  // is not good and every spoiled-field result below is meaningless.
  const { GEOMETRIES } = require(path.join(ROOT, 'lib', 'dataset.js'));
  const geom = Object.keys(GEOMETRIES)[0];
  const base = goodConfig();
  base.branch.geometry = geom;
  const baseCheck = validateConfig(base);
  if (!baseCheck.ok) {
    // Hunt your own instrument: if the control case fails, say so loudly rather
    // than reporting a wall of findings that are really one broken fixture.
    found.push(finding('schema/instrument', 'this test itself', `the known-good configuration used as the control is being rejected (${baseCheck.errors.join('; ')}) — every result from this attack is untrustworthy until that is fixed`, { instrument: true }));
    return found;
  }

  // ---- 2a. a validator must never throw, and must never accept nonsense ----

  const spoilings = [
    ['a traded symbol that is a number', (c) => { c.combo.trade = 12345; }],
    ['a traded symbol containing a slash', (c) => { c.combo.trade = '../../ETC'; }],
    ['a dormant band that is not a number', (c) => { c.branch.band = 'wide'; }],
    ['a dormant band of not-a-number', (c) => { c.branch.band = NaN; }],
    ['a dormant band of infinity', (c) => { c.branch.band = Infinity; }],
    ['a negative dormant band', (c) => { c.branch.band = -1; }],
    ['a committee with no members', (c) => { c.members = []; }],
    ['a committee member that is null', (c) => { c.members = [null]; }],
    ['a committee member naming a model that does not exist', (c) => { c.members = [{ model: 'crystalball', view: 'full' }]; }],
    ['a quorum larger than the committee', (c) => { c.cell.quorum = 99; }],
    ['a quorum of not-a-number', (c) => { c.cell.quorum = NaN; }],
    ['a holding time of infinity', (c) => { c.cell.tHours = Infinity; }],
    ['a negative holding time', (c) => { c.cell.tHours = -5; }],
    ['a stop multiplier of not-a-number', (c) => { c.cell.trailMult = NaN; }],
    ['a combination of a size other than three', (c) => { c.combo.size = 4; }],
    ['a decision rule that does not exist', (c) => { c.branch.decision = 'vibes'; }],
    ['a weekday flag that is the word yes', (c) => { c.branch.weekdaysOnly = 'yes'; }],
  ];

  for (const [label, spoil] of spoilings) {
    const cfg = goodConfig(); cfg.branch.geometry = geom; spoil(cfg);
    let out;
    try {
      out = validateConfig(cfg);
    } catch (err) {
      found.push(finding('schema/throws', 'the configuration check', `checking a configuration with ${label} threw an error instead of reporting the problem — the code says this check never throws, and callers rely on that to list every problem at once`));
      continue;
    }
    if (out && out.ok) {
      found.push(finding('schema/accepts', 'the configuration check', `a configuration with ${label} was ACCEPTED as valid — that value would go on to drive real trading arithmetic`, { severe: true }));
    }
  }

  // Nonsense that is not even an object.
  for (const junk of [null, undefined, 0, '', 'config', [], true, NaN]) {
    let out;
    try { out = validateConfig(junk); } catch (err) {
      found.push(finding('schema/throws', 'the configuration check', `checking ${JSON.stringify(junk) === undefined ? 'undefined' : JSON.stringify(junk)} threw instead of reporting a problem`));
      continue;
    }
    if (out && out.ok) found.push(finding('schema/accepts', 'the configuration check', `${JSON.stringify(junk)} was accepted as a valid configuration`, { severe: true }));
  }

  // ---- 2b. the training-window rule ----------------------------------------

  for (const [label, p] of [
    ['a mode that does not exist', { mode: 'sometimes' }],
    ['frozen with no instant named', { mode: 'frozen' }],
    ['frozen at a moment before time began', { mode: 'frozen', throughMs: -1 }],
    ['frozen at not-a-number', { mode: 'frozen', throughMs: NaN }],
    ['frozen at a fraction of a millisecond', { mode: 'frozen', throughMs: 1.5 }],
    ['rolling but also frozen at an instant', { mode: 'rolling', throughMs: 1 }],
  ]) {
    let errs;
    try { errs = validatePolicy(p); } catch (err) {
      found.push(finding('schema/throws', 'the training-window check', `${label} threw instead of being reported`));
      continue;
    }
    if (!errs || errs.length === 0) {
      found.push(finding('schema/accepts', 'the training-window check', `${label} was accepted — the deployment would train over a window nobody chose`, { severe: true }));
    }
  }

  // resolveFreeze is allowed to throw; what it must never do is hand back a
  // window built from a number that is not a real instant.
  for (const [label, setup] of [
    ['a frozen instant of infinity', { id: 'x', trainPolicy: { mode: 'frozen', throughMs: Infinity } }],
    ['a frozen instant that is text', { id: 'x', trainPolicy: { mode: 'frozen', throughMs: '1700000000000' } }],
    ['an inherited instant of not-a-number', { id: 'x', configSnapshot: { trainThrough: NaN } }],
  ]) {
    let out = null;
    try { out = resolveFreeze(setup, 1700000000000); } catch (_) { continue; } // refusing is right
    if (out && !Number.isInteger(out.throughMs)) {
      found.push(finding('schema/fabricated', 'the training-window resolver', `${label} produced a training window of ${String(out.throughMs)} instead of being refused — everything trained inside that window is meaningless`, { severe: true }));
    }
  }

  // ---- 2c. names the owner will read on screen ------------------------------

  for (const [label, name] of [
    ['a name made only of spaces', '   '],
    ['a name that is an object', {}],
    ['a name that is a number', 7],
    ['a name six thousand characters long', 'x'.repeat(6000)],
    ['a name containing a script tag', '<script>alert(1)</script>'],
    ['a name containing a newline', 'first\nsecond'],
  ]) {
    let out = null; let threw = false;
    try { out = validName(name); } catch (_) { threw = true; }
    if (threw) continue; // refusing is right
    if (label.includes('object') || label.includes('number')) {
      found.push(finding('schema/coerced', 'the name check', `${label} was quietly turned into the text "${out}" and accepted — the owner never typed that and will see it on screen as though they did`));
    }
    if (label.includes('script tag') || label.includes('newline')) {
      found.push(finding('schema/rawtext', 'the name check', `${label} was accepted unchanged; whether that is safe depends entirely on every screen that later prints it`, { soft: true }));
    }
  }

  // ---- 2d. torn and hostile stored records ---------------------------------

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-adv-schema-'));
  try {
    // A journal with a line cut in half — exactly what a crash mid-write leaves.
    const good = JSON.stringify({ t: '2026-01-01T00:00:00Z', kind: 'fill', setup_id: 's1', side: 'buy', qty: 1, price: 100 });
    const good2 = JSON.stringify({ t: '2026-01-02T00:00:00Z', kind: 'fill', setup_id: 's1', side: 'sell', qty: 1, price: 110 });
    const torn = path.join(dir, 'torn.jsonl');
    fs.writeFileSync(torn, `${good}\n{"t":"2026-01-03T00:00:00Z","kind":"fi\n${good2}\n`);
    const r = readJournal(torn);
    if (r.present && r.events.length === 2 && !r.dropped) {
      found.push(finding('schema/silentdrop', 'reading the trading journal',
        'a journal file with one line cut in half by a crash is read as if the whole line was never there. Nothing anywhere says a record was lost. Every total built on top of it — money made, money lost, number of trades — is then confidently wrong, and looks exactly like a correct answer.',
        { severe: true }));
    }

    // A journal of pure garbage reads as an empty book rather than an unreadable one.
    const junk = path.join(dir, 'junk.jsonl');
    fs.writeFileSync(junk, 'not json at all\nnor this\n{{{\n');
    const rj = readJournal(junk);
    if (rj.present && rj.events.length === 0 && !rj.dropped) {
      found.push(finding('schema/emptylooksfine', 'reading the trading journal',
        'a journal file containing nothing readable at all is reported as PRESENT with no events — which on screen is indistinguishable from a book that has genuinely never traded.',
        { severe: true }));
    }

    // Hostile records that ARE valid JSON, in the shape the code really reads.
    // (First written against invented field names, which made every one of them
    // pass by being ignored. The fields below were read out of lib/live/view.js.)
    const entry = (over = {}) => ({ event: 'ENTRY_FILL', setup_id: 's1', chunk_start: 1, side: 'long', qty: 1, price: 100, utc: '2026-01-01T00:00:00Z', ...over });
    const exit = (over = {}) => ({ event: 'EXIT_FILL', setup_id: 's1', chunk_start: 1, side: 'long', pnl: 10, utc: '2026-01-02T00:00:00Z', ...over });

    const hostile = [
      { label: 'a closed trade whose profit is the word ten', evs: [entry(), exit({ pnl: '10' })] },
      { label: 'a closed trade whose profit is a sentence', evs: [entry(), exit({ pnl: 'lots' })] },
      { label: 'a closed trade whose profit is infinity', evs: [entry(), exit({ pnl: Infinity })] },
      { label: 'a closed trade whose profit is not-a-number', evs: [entry(), exit({ pnl: NaN })] },
      { label: 'a closed trade whose profit is an object', evs: [entry(), exit({ pnl: { usd: 10 } })] },
      { label: 'an exit with no matching entry', evs: [exit()] },
      { label: 'two entries and one exit for the same period', evs: [entry(), entry(), exit()] },
      { label: 'an entry with a quantity of infinity', evs: [entry({ qty: Infinity })] },
      { label: 'an entry priced at zero', evs: [entry({ price: 0 })] },
      { label: 'an entry dated in the year nine thousand', evs: [entry({ utc: '9000-01-01T00:00:00Z' })] },
      { label: 'an entry with no date at all', evs: [entry({ utc: undefined })] },
      { label: 'a record that tries to rename every object in the program', evs: [JSON.parse('{"event":"ENTRY_FILL","setup_id":"s1","chunk_start":1,"__proto__":{"utsPolluted":true}}')] },
      { label: 'a marked price of infinity from the box', evs: [entry(), { event: 'PNL_MTM', setup_id: 'other', price: Infinity, utc: '2026-01-02T00:00:00Z' }] },
    ];
    // Control case FIRST. A perfectly ordinary entry-and-exit must come back
    // with a real money figure. If it does not, the fixture is wrong and every
    // finding below is noise — which is exactly what happened the first time
    // this was written (it looked for a field called `realized`; the field is
    // called `realizedPnl`, so it reported every case as blank).
    const control = deriveSetup([entry(), exit({ pnl: 10 })], 's1');
    if (!control || control.realizedPnl !== 10) {
      found.push(finding('schema/instrument', 'this test itself',
        `the control case — one ordinary trade opened and closed for a profit of 10 — came back as ${JSON.stringify(control && control.realizedPnl)} instead of 10. The hostile-record results below are not trustworthy until that is fixed.`,
        { instrument: true }));
      return found;
    }

    for (const h of hostile) {
      let book = null;
      try { book = deriveSetup(h.evs, 's1'); } catch (_) { continue; } // refusing is right
      const bad = [];
      (function walk(v, at) {
        if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(`${at} = ${String(v)}`); return; }
        if (typeof v === 'string' && /^[-+]?[0-9]/.test(v) && /pnl|realized|price|qty|usd|fee|cost/i.test(at)) {
          bad.push(`${at} = the TEXT "${v}" where a number belongs`);
          return;
        }
        if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
        if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k); }
      })(book, '');
      // The other way to be wrong: not a silly number, but a BLANK where a
      // money figure belongs. On screen those two are the same thing — the
      // owner cannot tell "we lost the number" from "there is nothing here".
      if (book && book.realizedPnl == null && h.evs.some((e) => e.event === 'EXIT_FILL')) {
        found.push(finding('schema/blankmoney', 'building a book from stored events',
          `${h.label} closed a trade and then reported the money made or lost as BLANK. On screen a blank reads as "nothing traded", not as "this figure could not be worked out".`,
          { severe: true }));
      }
      if (bad.length) {
        found.push(finding('schema/fabricated', 'building a book from stored events',
          `${h.label} produced a book the screen would happily show, containing ${bad.slice(0, 3).join(', ')}. That is a money figure the system computed from a record it should have refused.`,
          { severe: true }));
      }
    }
    if ({}.utsPolluted) {
      found.push(finding('schema/polluted', 'building a book from stored events', 'a stored record was able to add a field to every object in the running program — after that, every answer the system gives is suspect', { severe: true }));
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* leave it */ }
  }

  // ---- 2e. the version stamp nothing reads back ----------------------------

  // Every setup record is written with the shape-version it was made under.
  // The point of that stamp is that a later version of the code can notice a
  // record it does not fully understand. It only works if something reads it.
  const versionSrc = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'version.js'), 'utf8');
  const stamps = ['SETUP_SCHEMA_VERSION', 'CONFIG_SCHEMA_VERSION'];
  const codeFiles = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data', 'archive', 'tests'].includes(e.name)) continue;
      const q = path.join(dir, e.name);
      if (e.isDirectory()) collect(q);
      else if (/\.(js|html)$/.test(e.name)) codeFiles.push(q);
    }
  })(ROOT);
  const allCode = codeFiles.filter((f) => !f.endsWith(path.join('live', 'version.js')))
    .map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  for (const stamp of stamps) {
    if (!versionSrc.includes(stamp)) continue;
    // A COMPARISON, not merely a mention. Writing the stamp into a new record
    // is not the same as checking an old one against it.
    const compared = new RegExp(`(${stamp}\\s*(===|!==|<|>|<=|>=)|(===|!==|<|>|<=|>=)\\s*${stamp}|schema\\s*(===|!==|<|>)|\\.schema\\s*(===|!==|<|>))`).test(allCode);
    if (!compared) {
      found.push(finding('schema/versionunread', 'the shape-version stamped into every stored record',
        `every stored record is written with a ${stamp === 'SETUP_SCHEMA_VERSION' ? 'setup' : 'configuration'} shape-version, and nothing anywhere reads it back. The whole point of that stamp is that a later version of the code can notice a record it does not fully understand; as it stands, a record written by an older or newer version is treated as if it were current, silently.`,
        { severe: true }));
    }
  }

  return found;
}

module.exports = { name: 'the shape of what is stored — torn and hostile records', run };
