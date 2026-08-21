// Attack 6 — the data that is really there.
//
// Attacks 2 and 3 spoil records on purpose to see what the system does with
// them. This one does the opposite: it takes the data that ACTUALLY EXISTS and
// asks whether any of it is already in one of those states.
//
// It is READ ONLY. It opens files and never writes, moves or deletes one. It
// can be pointed at any data folder, so the same code that checks the working
// copy can be run against the box:
//
//   node tests/adversarial/run.js --only=attack-storeddata --data=/path/to/data
//
// Nothing here is a judgement about trading. It is a judgement about whether
// the files the system will compute from are what the system thinks they are.
const fs = require('fs');
const path = require('path');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');
const HOUR = 3600000;

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  (function go(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

// How many hours a month should hold, so "short" can be measured rather than
// guessed at. The current month is excluded — it is short because it is not
// over yet, which is not a fault.
function hoursInMonth(year, month) {
  return (Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) - Date.UTC(year, month - 1, 1)) / HOUR;
}

function run(ctx) {
  const found = [];
  const dataDir = ctx.dataDir || path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) {
    ctx.note(`no data folder at ${dataDir} — nothing stored to check`);
    return found;
  }

  const files = walkFiles(dataDir);
  ctx.note(`${files.length} stored file(s) under ${dataDir}`);
  if (!files.length) {
    ctx.note('the system is holding no data at all, so there is nothing here that could be wrong');
    return found;
  }

  // ---- 6a. every file the system will parse must actually parse ------------

  const unreadable = [];
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const parsed = new Map();
  for (const f of jsonFiles) {
    try { parsed.set(f, JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (err) {
      unreadable.push({ f: path.relative(dataDir, f), why: err.message.slice(0, 60) });
    }
  }
  if (unreadable.length) {
    found.push(finding('data/unreadable', dataDir,
      `${unreadable.length} stored file(s) cannot be read back at all — for example ${unreadable[0].f} (${unreadable[0].why}). Wherever one of these is read, the code treats an unreadable file the same as an absent one, so it will quietly count as "nothing here".`,
      { severe: true, files: unreadable.slice(0, 10) }));
  }

  const empty = jsonFiles.filter((f) => fs.statSync(f).size === 0);
  if (empty.length) {
    found.push(finding('data/empty', dataDir,
      `${empty.length} stored file(s) are zero bytes long: ${empty.slice(0, 5).map((f) => path.relative(dataDir, f)).join(', ')}. A file that exists but holds nothing is the shape a crash mid-write leaves behind.`));
  }

  // ---- 6b. the candle files, measured against what a month should hold -----

  const cacheDir = path.join(dataDir, 'cache');
  const candles = jsonFiles.filter((f) => f.startsWith(cacheDir + path.sep));
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const faults = { short: [], gap: [], dupe: [], order: [], badPrice: [], nonPositive: [], lowAboveHigh: [], notArray: [] };
  let checked = 0;

  // A pair's FIRST cached month is short because the pair had not started
  // trading yet, and its LAST is short because the month is not over. Those are
  // not faults. Counting them alongside the real ones turned 286 genuine gaps
  // into an alarming 306 and buried the distinction that matters — so the edges
  // are worked out first and excluded.
  const monthsBySymbol = {};
  const intervalsSeen = {};
  for (const f of candles) {
    const mm = /^([A-Z0-9]+)-([0-9]+[mhd])-(\d{4})-(\d{2})\.json$/.exec(path.basename(f));
    if (!mm) continue;
    intervalsSeen[mm[2]] = (intervalsSeen[mm[2]] || 0) + 1;
    if (mm[2] !== '1h') continue;
    (monthsBySymbol[mm[1]] = monthsBySymbol[mm[1]] || []).push(`${mm[3]}-${mm[4]}`);
  }
  const edges = new Set();
  for (const [sym, list] of Object.entries(monthsBySymbol)) {
    list.sort();
    edges.add(`${sym} ${list[0]}`);
    edges.add(`${sym} ${list[list.length - 1]}`);
  }

  // Candle data cached at an interval nothing in the code ever asks for is data
  // on disk that no screen can show (RULE FIVE). Worked out from what the code
  // requests, not from whether the filename happens to appear in it.
  const codeText = fs.readFileSync(path.join(ROOT, 'lib', 'binance.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
  for (const [iv, count] of Object.entries(intervalsSeen)) {
    const asked = new RegExp(`interval\\s*[=:]\\s*['"\`]${iv}['"\`]|['"\`]${iv}['"\`]\\s*\\)|monthlyKlines\\([^)]*['"\`]${iv}['"\`]`).test(codeText);
    if (!asked && iv !== '1h') {
      found.push(finding('data/unusedinterval', `the stored market data in ${path.relative(ROOT, cacheDir) || cacheDir}`,
        `${count} candle file(s) hold ${iv} data, and nothing in the code ever asks for ${iv} data — the download only ever requests 1h. These were fetched by something that is no longer here. They are on disk, they take up space, and no screen can show you they exist (RULE FIVE).`));
    }
  }

  for (const f of candles) {
    const name = path.basename(f);
    const m = /^([A-Z0-9]+)-([0-9]+[mhd])-(\d{4})-(\d{2})(?:-(\d{2}))?\.json$/.exec(name);
    if (!m || m[2] !== '1h') continue;
    const rows = parsed.get(f);
    const tag = `${m[1]} ${m[3]}-${m[4]}${m[5] ? `-${m[5]}` : ''}`;
    if (!Array.isArray(rows)) { faults.notArray.push(tag); continue; }
    checked += 1;
    const isDay = Boolean(m[5]);
    const isCurrent = `${m[3]}-${m[4]}` === thisMonth;
    const isEdge = edges.has(`${m[1]} ${m[3]}-${m[4]}`);

    const expect = isDay ? 24 : hoursInMonth(Number(m[3]), Number(m[4]));
    if (!isCurrent && !isEdge && rows.length < expect) {
      faults.short.push(`${tag} is missing ${expect - rows.length} of ${expect} hours`);
    }

    const ts = rows.map((r) => r && r.ts);
    if (new Set(ts).size !== ts.length) faults.dupe.push(tag);
    if (ts.some((t, i) => i > 0 && !(t > ts[i - 1]))) faults.order.push(tag);
    // A hole INSIDE the file: consecutive candles more than an hour apart.
    const holes = ts.filter((t, i) => i > 0 && t - ts[i - 1] > HOUR).length;
    if (holes) faults.gap.push(`${tag} (${holes} break${holes === 1 ? '' : 's'})`);

    // Check EVERY kind of fault on every file. An earlier version stopped at
    // the first one it found, so a file with a negative price AND an impossible
    // candle was only ever reported for one of them.
    let sawBadPrice = false; let sawNonPositive = false; let sawLowAboveHigh = false;
    for (const r of rows) {
      if (!r) { sawBadPrice = true; continue; }
      const vals = [r.open, r.high, r.low, r.close];
      if (vals.some((v) => !Number.isFinite(Number(v)))) { sawBadPrice = true; continue; }
      if (vals.some((v) => Number(v) <= 0)) sawNonPositive = true;
      if (Number(r.low) > Number(r.high)) sawLowAboveHigh = true;
    }
    if (sawBadPrice) faults.badPrice.push(tag);
    if (sawNonPositive) faults.nonPositive.push(tag);
    if (sawLowAboveHigh) faults.lowAboveHigh.push(tag);
  }
  ctx.note(`${checked} candle file(s) checked against what a full month should hold`);

  const CANDLE_MEANING = {
    short: 'are missing hours from the middle of a pair history — not a first or last month, which are short for ordinary reasons. A sweep over one of these is scored on less data than it appears to be, and says nothing about it',
    gap: 'have a break in the middle where hours are missing. Anything measured across the break is measured across a hole',
    dupe: 'contain the same hour more than once, so those hours are counted twice',
    order: 'have their candles out of time order, which breaks anything that walks forward through time',
    badPrice: 'contain a price that is not a number',
    nonPositive: 'contain a price of zero or below, which no traded pair ever had',
    lowAboveHigh: 'contain a candle whose low is above its high, which cannot happen',
    notArray: 'are not a list of candles at all',
  };
  for (const [k, list] of Object.entries(faults)) {
    if (!list.length) continue;
        const shown = cacheDir.startsWith(ROOT) ? path.relative(ROOT, cacheDir) : cacheDir;
    found.push(finding(`data/candles-${k}`, `the stored market data in ${shown}`,
      `${list.length} candle file(s) ${CANDLE_MEANING[k]}. For example: ${list.slice(0, 4).join('; ')}${list.length > 4 ? `, and ${list.length - 4} more` : ''}.`,
      { severe: ['badPrice', 'nonPositive', 'lowAboveHigh', 'notArray'].includes(k), files: list.slice(0, 20) }));
  }

  // ---- 6c. the live records, against the checks the system itself uses -----

  const { validateConfig } = require(path.join(ROOT, 'lib', 'live', 'configschema.js'));
  const setupsDir = path.join(dataDir, 'live', 'setups');
  const setups = jsonFiles.filter((f) => f.startsWith(setupsDir + path.sep));
  let badSetups = 0;
  for (const f of setups) {
    const s = parsed.get(f);
    if (!s) continue;
    const v = validateConfig(s.configSnapshot);
    if (!v.ok) {
      badSetups += 1;
      found.push(finding('data/badsetup', path.relative(dataDir, f),
        `this stored setup's configuration no longer passes the system's own check: ${v.errors.slice(0, 3).join('; ')}. It is on disk and will be listed on screen, but nothing that reads it can be relied on.`,
        { severe: true }));
    }
    if (s && typeof s.tradedPair !== 'string') {
      found.push(finding('data/badsetup', path.relative(dataDir, f),
        `this stored setup records its traded pair as ${JSON.stringify(s.tradedPair)} rather than as text. Everything downstream expects text.`));
    }
  }
  if (setups.length) ctx.note(`${setups.length} stored setup(s) checked, ${badSetups} failing the system's own configuration check`);

  // ---- 6d. journals: torn lines that are already on disk -------------------

  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const raw = fs.readFileSync(f, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    let torn = 0;
    for (const l of lines) { try { JSON.parse(l); } catch (_) { torn += 1; } }
    if (torn) {
      found.push(finding('data/tornjournal', path.relative(dataDir, f),
        `${torn} of ${lines.length} lines in this journal cannot be read. Every one of them is a trading event that is on disk and will be left out of every total, with nothing on any screen to say so.`,
        { severe: true }));
    }
    if (lines.length && !raw.endsWith('\n')) {
      found.push(finding('data/unterminated', path.relative(dataDir, f),
        'this journal does not end with a line break, which is what a file looks like when writing to it stopped part-way. The last event may be incomplete.'));
    }
  }

  // ---- 6e. anything stored that nothing in the code ever reads -------------

  const shipped = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data', 'archive', 'tests'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (/\.(js|html)$/.test(e.name)) shipped.push(fs.readFileSync(p, 'utf8'));
    }
  })(ROOT);
  const allCode = shipped.join('\n');
  const orphans = [...new Set(files.map((f) => path.basename(f)))]
    .filter((b) => !/^[A-Z0-9]+-1h-\d{4}-\d{2}(-\d{2})?\.json$/.test(b))
    .filter((b) => !allCode.includes(b) && !allCode.includes(b.replace(/\.jsonl?$/, '')));
  if (orphans.length) {
    found.push(finding('data/orphan', dataDir,
      `${orphans.length} stored file name(s) are never mentioned anywhere in the code: ${orphans.slice(0, 8).join(', ')}. Either they are left over from something removed, or something writes them that nothing reads — both mean data on disk that no screen can show you (RULE FIVE).`,
      { soft: true, files: orphans.slice(0, 20) }));
  }

  return found;
}

module.exports = { name: 'the data that is really there — read only, nothing written', run };
