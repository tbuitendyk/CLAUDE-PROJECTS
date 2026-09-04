// The three-stage record sets (Sweep / Boards) — plan-first orchestration
// over the pure tasks in stagework.js.
//
// A record set is written PLAN FIRST: the closed list of units, the settings,
// and the price-file manifest go to disk before any training starts, so what
// was asked can never quietly bend after answers exist. One record per unit
// (stages 1 and 2) or per setting x unit (stage 3) fills the plan in; a set
// whose records do not match its own plan reports itself incomplete rather
// than looking finished.
//
// The chain rail: a stage refuses a parent that is not done, and refuses to
// launch when the price files no longer fingerprint identically to the ones
// the parent read (lib/manifest.js, the same manifest the sweep resume
// trusts). It refuses by name — which symbols changed — and never mixes.
const fs = require('fs');
const path = require('path');

const rowstore = require('./rowstore');
const { createPool } = require('./pool');
const { stampManifest, manifestDiff } = require('./manifest');
const { GEOMETRIES } = require('./dataset');
const bracketLib = require('./bracket');
const batch = require('./batch');
const agreement = require('./agreement');
// One training per reading — read from the reading list itself, so adding a
// reading can never leave a count behind that was typed in by hand.
// HOW MANY INDEPENDENT VOICES a board really holds (owner loop, 2026-08-28).
// Members that call the same way almost every time are one voice however
// differently they were built. Measured on the TEST slice only, and recorded
// beside the member count so a reading that adds members without adding
// voices is visible instead of invisible — which is exactly how six members
// voting as three went unnoticed until the owner found it in the tables.
function voicesOf(members, nTest) {
  if (!Array.isArray(members) || !members.length || !nTest) return null;
  const calls = members.map((m) => (m.probs || []).slice(0, nTest).map(agreement.argmaxCall));
  return agreement.voiceGroups(calls, nTest).voices;
}
const trainingsPerUnit = (size) => require('./bracketwork').slimViewsFor(size === 1 ? 1 : 2).length;

// A LONG JOB SAYS WHERE IT IS, HOW FAST IT IS GOING, AND WHEN IT WILL LAND
// (owner order, 2026-08-29: "no idea if it will take 10 hours or 10 minutes to
// get to 1% ... give some useful information so long runs aren't pure
// guesswork").
//
// What they were looking at was "reading the kept votes: 10/10 units · 0% of
// 332,572,800 pricings". Three things wrong with it, all of them this function:
//
//   * THE WORDS AND THE NUMBER WERE ABOUT DIFFERENT PHASES. A stage 3 run has
//     three long ones — reading the kept votes, pricing them, totalling the
//     tables — and the percentage was always of the pricings, so during the
//     first and last phase it read 0% or 100% of something nobody was doing.
//   * ONLY THE MIDDLE PHASE ESTIMATED ANYTHING. The other two reported a bare
//     count, so the run went dark for however long they took.
//   * THE ESTIMATE WAS A DURATION, and a duration has to be added to the clock
//     by hand to be worth anything. "lands about 14:20" is the thing an owner
//     can act on.
//
// So every phase reports through here: its own name, its own done-of-total, its
// own rate measured from when THAT phase started, and a finish time of day. A
// phase that has completed nothing yet says so plainly rather than showing a
// confident 0%.
function phaseNote(doc, { phase, done, total, word, startedMs, extra = '' }) {
  const now = Date.now();
  const elapsed = Math.max(0, now - startedMs);
  const per = done > 0 ? elapsed / done : null;
  const left = per != null ? Math.round(per * Math.max(0, total - done)) : null;
  doc.perf = doc.perf || {};
  doc.perf.phase = phase;
  doc.perf.phaseDone = done;
  doc.perf.phaseTotal = total;
  doc.perf.phaseWord = word;
  doc.perf.phaseElapsedMs = elapsed;
  doc.perf.phaseEtaMs = left;
  // the wall clock, computed here so the screen never has to add a duration to
  // "now" and get it wrong across a page that has been open for an hour
  doc.perf.phaseEndsAtMs = left == null ? null : now + left;
  doc.progress = `${phase}: ${Number(done).toLocaleString()} of ${Number(total).toLocaleString()} ${word}`
    + (extra ? ` · ${extra}` : '');
  return doc.perf;
}

const ENGINE_VERSION = require('../package.json').version;
const MEASUREMENTS_VERSION = require('./features').MEASUREMENTS_VERSION;

// WHICH PART OF THE RELEASE DECIDES WHETHER TWO SETS CAN BE CHAINED
// (owner decision, 2026-08-29).
//
// The parent refusal used to compare the WHOLE release string, so any
// difference at all refused. That is too blunt, and it cost the owner real
// work: a patch release that fixed a tab that would not draw and a cost line
// that would not clear — neither of which can touch a kept vote — would have
// refused a finished stage 2 and sent them back to re-run the training.
//
// THE FIRST DIGIT IS ALREADY DEFINED AS THIS EXACT QUESTION. CLAUDE.md RULE
// ONE-C, written the same day: the third digit is a fix or a wording change;
// the second is new behaviour or a new control; the FIRST is "something already
// on disk stops being readable or comparable — a new measurement block, a
// schema change, anything that makes yesterday's records refuse."
//
// That last clause is word for word what this guard is for, so the guard reads
// the first digit and nothing else. Comparing more than that made the guard
// stricter than its own definition: a release can gain a control or fix a
// screen — second and third digit by rule — without a single kept vote meaning
// anything different, and refusing those threw away training the change could
// not possibly have affected.
//
// It fails SAFE. The day the arithmetic really does change, that is a
// first-digit release by the rule and this bites. The measurement block check
// above — the one that catches the numbers members were trained on changing —
// is untouched and runs FIRST, so the commonest reason to refuse is caught
// before this is even reached. A version that cannot be read as three numbers
// falls back to the old, strict whole-string comparison. And the full release
// of every set is still stored and still shown, so a chain says which release
// wrote each link even where they differ.
const engineLine = (v) => {
  const m = /^(\d+)\./.exec(String(v || ''));
  return m ? m[1] : null;
};
function sameEngineLine(a, b) {
  const la = engineLine(a); const lb = engineLine(b);
  if (la == null || lb == null) return String(a) === String(b);  // unreadable: the old, strict rule
  return la === lb;
}
const SETS_DIR = path.join(__dirname, '..', 'data', 'stagesets');

// ---- set documents -----------------------------------------------------------
let tmpSeq = 0;
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp${process.pid}-${++tmpSeq}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const setFile = (id) => path.join(SETS_DIR, `${String(id).replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
function saveSet(doc) { atomicWrite(setFile(doc.id), JSON.stringify(doc)); }
function getSet(id) {
  try { return JSON.parse(fs.readFileSync(setFile(id), 'utf8')); } catch (_) { return null; }
}
function listSets() {
  let files = [];
  try { files = fs.readdirSync(SETS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { files = []; }
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), 'utf8'));
      // A 'running' doc while nothing is running here is a set the service
      // restarted out from under — marked the moment it is seen, the same
      // lazy sweep the run list does, so a corpse never shows as alive.
      if (d.status === 'running' && (!activeSet || activeSet.id !== d.id)) {
        d.status = 'interrupted';
        d.progress = 'the service restarted while this set was being written';
        saveSet(d);
      }
      out.push({
        id: d.id, stage: d.stage, seq: d.seq, name: d.name, status: d.status,
        createdAt: d.createdAt, finishedAt: d.finishedAt || null, parent: d.parent || null,
        desc: d.desc || '', progress: d.progress || '', perf: d.perf || null,
        plan: { units: (d.plan || {}).units || 0, settings: (d.plan || {}).settings || 0 },
        counts: d.counts || null, params: publicParams(d),
        // how many records are picked on a stage 2 set's table -- what the
        // stage 3 set-up prices when it is told Selected records
        picked: Array.isArray(d.picked) ? d.picked.length : 0,
      });
    } catch (_) { /* an unreadable doc is skipped, never invented */ }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}
// What a listing row shows of a set's parameters — small and screen-facing.
function publicParams(d) {
  const p = d.params || {};
  return {
    windowLayout: p.windowLayout || null, nullN: p.nullN ?? null,
    orderBy: p.orderBy || null, carry: p.carry ?? null, fee: p.fee ?? null,
    // the exact records a stage 3 set selected, as a count; null when it
    // priced by carry
    selected: Array.isArray(p.selected) ? p.selected.length : null,
    campaign: p.campaign || null,
    sizes: p.sizes || null,
    // what the Sweep provenance check reads a stage 1 set by (owner order,
    // 2026-08-27: the section titles go red at the point of provenance break)
    universe: p.universe || null, geometries: p.geometries || null,
    allLoaded: p.allLoaded !== false, startMonth: p.startMonth || null, endMonth: p.endMonth || null,
  };
}

function seqFor(stage) {
  let max = 0;
  for (const s of listSets()) if (s.stage === stage && Number.isFinite(s.seq)) max = Math.max(max, s.seq);
  return max + 1;
}
// THE NAME IS THE OWNER'S (owner order, 2026-09-03: "that's my job to name
// these things and you haven't given me a control"). A launch takes the name
// from its box; an empty box takes the next free one, which is what the box
// shows greyed as a suggestion. Names are unique across every set on disk,
// whatever its stage: the pickers on Sweep and Boards offer sets by name, and
// two sets under one name cannot be told apart there. The counter behind
// "S3 #N" is still kept on every set (seq), but it is the id's business now,
// not the name's.
function nextFreeName(stage) { return `S${stage} #${seqFor(stage)}`; }
function nextNames() { return { 1: nextFreeName(1), 2: nextFreeName(2), 3: nextFreeName(3) }; }
function nameTaken(name, exceptId = null) {
  const want = String(name).trim().toLowerCase();
  return listSets().find((x) => x.id !== exceptId && String(x.name || '').trim().toLowerCase() === want) || null;
}
function nameOrRefuse(raw, stage) {
  const name = String(raw ?? '').trim().slice(0, 80);
  if (!name) return nextFreeName(stage);
  const taken = nameTaken(name);
  if (taken) throw new Error(`a record set called "${name}" already exists (${taken.id}) — pick another name, or rename that one on Boards first`);
  return name;
}
// nullRng needs a numeric seed; a set's seed is derived from its id so its
// deals are reproducible from the name alone (decision record #7).
function seedOf(id) {
  let h = 2166136261 >>> 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h || 1;
}

// ---- one heavy job at a time ---------------------------------------------------
let activeSet = null;   // the running set's doc
let activePool = null;
function stageRunning() { return activeSet ? activeSet.id : null; }
// EVERYTHING HEAVY THIS FILE OWNS, in one answer, so the other side of the box
// can ask (owner order, 2026-08-29: "fix both guards so neither can fire during
// the other").
//
// The guards were asymmetric and only one direction held. A stage launch asked
// batch.batchRunning() and refused while a sweep was going; nothing asked the
// other way, because a stage run is `activeSet` and not `activeBatch`. So the
// planted check — which regenerates the fabricated pair's candles and then
// fires a whole sweep — read the box as idle in the middle of a nine-hour stage
// 3, and Start sweep would have done the same. Two worker pools against a
// four-worker allowance, and cache writes underneath a job that is reading.
//
// Returns what is busy, in words fit to put in a refusal, or null.
function stageBusy() {
  if (activeSet) return `stage run ${activeSet.id}`;
  if (tallyRun && !tallyRun.error) return `the totalling of ${tallyRun.id}`;
  return null;
}
function claimOrRefuse() {
  if (batch.batchRunning()) {
    throw new Error('a sweep is running on this box right now — a stage run would fight it for the same workers. '
      + 'Wait for it or stop it first.');
  }
  if (activeSet) throw new Error(`stage run ${activeSet.id} is going right now — one heavy job at a time`);
  if (tallyRun && !tallyRun.error) {
    throw new Error(`the tables of ${tallyRun.id} are totalling right now — one heavy job at a time. They appear on Boards when it lands.`);
  }
}
function cancelStage(id) {
  if (!activeSet || activeSet.id !== id) return { stopped: false, why: 'that set is not running' };
  activeSet.cancelRequested = true;
  if (activePool) activePool.abort();
  return { stopped: true };
}
// Service restarts leave 'running' sets stranded; the boot sweep marks them
// so the screen never shows a corpse as alive (same contract as the sweeps).
function markInterrupted(reason) {
  for (const row of listSets()) {
    // A FILL THAT DIED IS NOT A SET THAT DIED. The kept-scramble fill writes
    // the new records BESIDE the old ones and only swaps at the very end, so a
    // service restart in the middle leaves the set exactly as it was: done, and
    // still keeping whatever it kept before. Marking it 'interrupted' would say
    // its records are suspect when they are untouched -- and, worse, the fill
    // refuses to start on a set that is not 'done', so the set would be stuck
    // in a state only a hand-edit could leave.
    if (row.status === 'filling') {
      const doc = getSet(row.id);
      if (!doc) continue;
      doc.status = 'done';
      // HOW MUCH SURVIVED, counted. "Press it again" on its own reads like
      // starting from nothing, and the whole point of saving each unit is that
      // it is not.
      let saved = 0;
      try { saved = fs.readdirSync(keptFigsDir(row.id)).filter((f) => /^unit-\d+\.bin$/.test(f)).length; } catch (_) { saved = 0; }
      doc.progress = `filling in the kept null money stopped when the service restarted${reason ? ` — ${reason}` : ''}. `
        + 'The records were not touched: they are written beside and only swapped at the end. '
        + `${saved} unit(s) are already priced and saved, and will be checked and reused — press it again and it carries on from there.`;
      saveSet(doc);
      try { rowstore.remove(`${row.id}__keptfill`); } catch (_) { /* nothing half-written to clear */ }
      continue;
    }
    if (row.status !== 'running') continue;
    const doc = getSet(row.id);
    if (!doc) continue;
    doc.status = 'interrupted';
    doc.progress = `the service restarted while this set was being written${reason ? ` — ${reason}` : ''}`;
    saveSet(doc);
  }
}

// ---- shared launch plumbing ---------------------------------------------------
const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);

function unitsFor(universe, sizes, geometries) {
  const combos = [];
  const u = universe;
  if (sizes.singles) for (const a of u) combos.push({ trade: a, ctx1: null, ctx2: null, size: 1 });
  if (sizes.doubles) for (const a of u) for (const b of u) if (b !== a) combos.push({ trade: a, ctx1: b, ctx2: null, size: 2 });
  if (sizes.triples) {
    for (const a of u) {
      const rest = u.filter((x) => x !== a);
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) combos.push({ trade: a, ctx1: rest[i], ctx2: rest[j], size: 3 });
    }
  }
  const units = [];
  for (const c of combos) for (const g of geometries) units.push({ ...c, geometry: g });
  return units;
}
const unitKeyOf = (u) => `${u.trade}|${u.ctx1 || ''}|${u.ctx2 || ''}|${u.geometry}`;

function writers(id) {
  return {
    // offThread: these four take the whole output of every unit, and packing
    // it on the thread that hands the next unit out is what held the pool to
    // two cores of its four (owner, 2026-08-29). Their closes are awaited.
    votes: rowstore.writer(id, 'votes', { offThread: true }),
    tau: rowstore.writer(id, 'tau', { offThread: true }),
    models: rowstore.writer(id, 'models', { offThread: true }),
    records: rowstore.writer(id, 'records', { offThread: true }),
  };
}
// Write one unit's stores, flushing per store so every unit owns whole
// blocks; the record carries each store's block range so the unit can be
// read back without touching any neighbour (same trick as the coin rows).
function writeUnitStores(w, u, unitIdx, res) {
  const ranges = {};
  const before = { votes: w.votes.blockCount, tau: w.tau.blockCount, models: w.models.blockCount };
  const nTest = res.ts.test.length;
  for (let i = 0; i < nTest; i++) {
    w.votes.push({ u: unitIdx, w: 0, i, ts: res.ts.test[i], y: res.labels.test[i], m: res.members.map((m) => m.probs[i]) });
  }
  for (let i = 0; i < res.ts.hold.length; i++) {
    w.votes.push({ u: unitIdx, w: 1, i, ts: res.ts.hold[i], y: res.labels.hold[i], m: res.members.map((m) => m.probs[nTest + i]) });
  }
  w.votes.flush();
  for (let mi = 0; mi < res.members.length; mi++) {
    const m = res.members[mi];
    w.tau.push({ u: unitIdx, mi, model: m.spec.model, view: m.spec.view, probs: m.tauProbs });
  }
  w.tau.flush();
  for (let mi = 0; mi < res.members.length; mi++) {
    const m = res.members[mi];
    w.models.push({ u: unitIdx, mi, model: m.spec.model, view: m.spec.view, picked: m.picked, saved: m.saved });
  }
  w.models.flush();
  ranges.votes = [before.votes, w.votes.blockCount];
  ranges.tau = [before.tau, w.tau.blockCount];
  ranges.models = [before.models, w.models.blockCount];
  return ranges;
}
// Read one unit's rows back out of a store by its recorded block range.
function unitRows(id, name, range, unitIdx) {
  if (!range) return [];
  const idxs = [];
  for (let b = range[0]; b < range[1]; b++) idxs.push(b);
  return rowstore.readBlocks(id, name, idxs).map((x) => x.row).filter((r) => r.u === unitIdx);
}

function finishFail(doc, err, pool) {
  doc.status = doc.cancelRequested ? 'cancelled' : 'error';
  doc.error = err ? String(err.message || err) : null;
  doc.finishedAt = new Date().toISOString();
  saveSet(doc);
  if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
  if (pool) pool.abort();
}

// fee % each way, as the Sweep posts it: a fraction of the position. Refused
// by sentence rather than defaulted, the rule the tau tuner set (2026-08-23).
function feeOrRefuse(raw, where) {
  const fee = Number(raw);
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.05) {
    throw new Error(`fee % each way must be a real cost between 0 and 5% — ${where}`);
  }
  return fee;
}
// A STAGE 1 OR 2 SET WRITTEN BEFORE THE TUNING-SLICE MONEY EXISTED (3.46.0) is
// behind: its records carry no money. Read from the records, never from a
// version number, so a set half-filled by a crash reads as behind too.
function tuningMoneyBehind(doc) {
  if (!doc || (doc.stage !== 1 && doc.stage !== 2)) return false;
  if (doc.status !== 'done' && doc.status !== 'incomplete') return false;
  const recs = allRecords(doc.id);
  if (!recs.length) return false;
  return recs.some((r) => !Number.isFinite(Number(r.money)));
}

// ---- FILLING IN THE TUNING-SLICE MONEY (3.46.0, RULE NINE) -----------------------
//
// A stage 1 or stage 2 set written before the money existed is brought up to
// date here, the way the kept null money is: announced on Boards, a fee
// declared by the owner because the set never had one, run once in the
// background, written BESIDE and swapped only after the copy is checked. No
// reader ever learns an older shape -- a set is either up to date, or it is
// behind and says so on its table.
function startTuningMoneyFill(id, feeRaw) {
  const busy = stageBusy();
  if (busy) throw new Error(`${busy} is running — filling in the tuning-slice money waits rather than competing for the box`);
  const doc = getSet(id);
  if (!doc || (doc.stage !== 1 && doc.stage !== 2)) throw new Error('that is not a stage 1 or stage 2 record set');
  if (doc.status !== 'done' && doc.status !== 'incomplete') throw new Error(`${doc.name} is ${doc.status} — a fill waits until the set has landed`);
  const here = require('../package.json').version;
  const there = doc.engineVersion || null;
  if (there && firstDigitOf(there) !== firstDigitOf(here)) {
    throw new Error(`${doc.name} was written by release ${there} and this box runs ${here} — `
      + 'a figure filled in now would come from a different engine than the ones beside it');
  }
  if (!tuningMoneyBehind(doc)) throw new Error(`${doc.name} already carries the tuning-slice money — there is nothing to fill in`);
  const fee = feeOrRefuse(feeRaw, 'it prices the tuning-slice $ this fill writes');
  const parent = doc.stage === 2 ? getSet((doc.parent || {}).id) : null;
  if (doc.stage === 2 && !parent) throw new Error(`${doc.name} names a parent that is no longer on disk — its null set cannot be dealt again`);
  // the deals are the parent's for a stage 2 set: same seed, same tags, the
  // orders the stage 1 members were read against (decision record #57)
  const seed = doc.stage === 2 ? parent.seed : doc.seed;
  const nullN = Math.max(0, Math.floor(num((doc.params || {}).nullN, 19)));
  const recs = allRecords(id);
  const dp = doc.params || {};
  const p = { allLoaded: dp.allLoaded !== false, startMonth: dp.startMonth, endMonth: dp.endMonth, windowLayout: dp.windowLayout };
  const was = doc.status;
  activeSet = doc;
  doc.status = 'filling';
  doc.progress = 'filling in the tuning-slice money — starting';
  saveSet(doc);
  (async () => {
    const sw = require('./stagework');
    const t0 = Date.now();
    const SPARE = 'records-moneying';
    for (const f of [rowstore.storeFile(id, SPARE), `${rowstore.storeFile(id, SPARE)}.meta.json`,
      rowstore.gzFile(id, SPARE), `${rowstore.gzFile(id, SPARE)}.meta.json`]) {
      try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
    }
    const w = rowstore.writer(id, SPARE, { offThread: true });
    let done = 0;
    const idx = (n) => Array.from({ length: n }, (_, i) => i);
    for (const rec of recs) {
      const unitKey = unitKeyOf(rec);
      // eslint-disable-next-line no-await-in-loop
      const { geo, maps, split } = await sw.unitChunks({ trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size }, rec.geometry, p);
      const tauRows = unitRows(id, 'tau', rec.blocks.tau, rec.u);
      const tauProbs = rec.specs.map((_, mi) => (tauRows.find((t) => t.mi === mi) || {}).probs || []);
      const slice = sw.tuningSliceOf(split.trainChunks, tauProbs);
      const priced = (use) => sw.moneyAgainstNull({
        chunks: slice, calls: sw.directionCalls(tauProbs, use, slice.length), tradeMap: maps.trade, geo, fee, seed, unitKey, nullN,
      });
      const tuning = priced(idx(tauProbs.length));
      const out = {
        ...rec, money: tuning.money, moneyTrades: tuning.trades, moneyChunks: tuning.chunks,
        nullMoney: tuning.nullMoney, beatMoney: tuning.beat, leadMoney: tuning.lead,
      };
      if (doc.stage === 2) {
        // the merged members' own reading against the parent's null set, in
        // place of the stage 1 numbers this record used to copy; the stage 1
        // members are the first specs (the launch writes the parent's first)
        const n3 = rec.specs.filter((sp) => sp.model === 'logreg').length;
        out.money3 = priced(idx(n3)).money;
        const votes = unitRows(id, 'votes', rec.blocks.votes, rec.u).filter((v) => v.w === 0).sort((a, b) => a.i - b.i);
        const y = votes.map((v) => v.y);
        const probs = rec.specs.map((_, mi) => votes.map((v) => v.m[mi]));
        const scoreAll = sw.forecastScore(probs, y);
        const nullScores = [];
        for (let d = 0; d < nullN; d++) nullScores.push(sw.forecastScore(probs, y, sw.dealOrder(seed, unitKey, `s1#${d}`, votes.length)));
        let beat = 0;
        for (const sc of nullScores) if (scoreAll > sc) beat++;
        out.beat = beat; out.pairs = nullN; out.lead = sw.leadOver(scoreAll, nullScores); out.nullScores = nullScores;
      }
      w.push(out);
      w.flush();
      done++;
      phaseNote(doc, { phase: 'filling in the tuning-slice money', done, total: recs.length, word: 'units', startedMs: t0 });
      saveSet(doc);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    await w.close();
    // VERIFY BEFORE ANYTHING IS REPLACED: one record per unit, every unit,
    // every one of them carrying money
    const got = rowstore.readAll(id, SPARE);
    if (got.length !== recs.length) throw new Error(`the copy holds ${got.length} records and the set has ${recs.length} — nothing was replaced`);
    if (got.some((r) => !Number.isFinite(Number(r.money)))) throw new Error('a record in the copy carries no money — nothing was replaced');
    // SWAP.
    const from = rowstore.storeFile(id, SPARE);
    const to = rowstore.storeFile(id, 'records');
    fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);
    fs.renameSync(from, to);
    recordsInHand.id = null; recordsInHand.rows = null;      // the old rows must never be served again
    doc.params = { ...(doc.params || {}), fee };
    doc.tuningMoneyAt = new Date().toISOString();
    doc.status = was;
    doc.progress = '';
    saveSet(doc);
  })().catch((err) => {
    doc.status = was;
    doc.progress = `the fill failed: ${String(err.message || err)}`;
    saveSet(doc);
  }).finally(() => {
    if (activeSet && activeSet.id === doc.id) activeSet = null;
  });
  return { id, name: doc.name, units: recs.length, fee };
}

// ---- STAGE 1 --------------------------------------------------------------------
function startStage1(params) {
  claimOrRefuse();
  const universe = Array.isArray(params.universe) && params.universe.length
    ? params.universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : batch.DEFAULT_PAIRS;
  const sizes = {
    singles: !!(params.sizes || {}).singles,
    doubles: !!(params.sizes || {}).doubles,
    triples: !!(params.sizes || {}).triples,
  };
  if (!sizes.singles && !sizes.doubles && !sizes.triples) throw new Error('tick at least one of singles / doubles / triples');
  const geometries = params.permuteGeometry
    ? Object.keys(GEOMETRIES)
    : [GEOMETRIES[params.geometry] ? params.geometry : 'daily-4d'];
  const windowLayout = ['split70', 'reserve61', 'legacy80'].includes(params.windowLayout) ? params.windowLayout : 'reserve61';
  const nullN = Math.max(0, Math.floor(num(params.nullN, 19)));
  const fee = feeOrRefuse(params.fee, 'it prices the tuning-slice $ every unit is read by');
  const p = {
    allLoaded: params.allLoaded !== false,
    startMonth: params.startMonth || '2018-01',
    endMonth: params.endMonth || '2026-06',
    windowLayout,
  };
  const units = unitsFor(universe, sizes, geometries);
  if (!units.length) throw new Error('nothing to score — the universe and sizes produced no units');

  const setName = nameOrRefuse(params.name, 1);
  const seq = seqFor(1);
  const id = `s1-${Date.now().toString(36)}-${seq}`;
  const doc = {
    id, stage: 1, seq, name: setName,
    createdAt: new Date().toISOString(),
    status: 'running', progress: 'writing the plan',
    desc: String(params.desc || ''),
    engineVersion: ENGINE_VERSION,
    measurements: MEASUREMENTS_VERSION,
    boardNull: { ...BOARD_NULL_NONE },
    // The owner's current campaign name rides on every launch, exactly as it
    // does on the sweeps (owner order, 2026-08-04; carried here 2026-08-27).
    params: { universe, sizes, geometries, windowLayout, nullN, fee, ...p, campaign: require('./campaign').getCampaign() || null },
    seed: seedOf(id),
    plan: { units: units.length, unitList: units },
    perf: {
      unitsDone: 0, unitsTotal: units.length, elapsedMs: 0, etaMs: null, workers: null,
      cyclesDone: 0, cyclesTotal: units.reduce((nn, uu) => nn + trainingsPerUnit(uu.size), 0), cyclesWord: 'trainings',
    },
    failures: [],
    counts: null,
  };
  doc.dataManifest = stampManifest(id, universe);
  activeSet = doc;
  saveSet(doc);

  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveSet(doc);
  const t0 = Date.now();
  const w = writers(id);
  (async () => {
    const payloads = units.map((u) => ({
      combo: { trade: u.trade, ctx1: u.ctx1, ctx2: u.ctx2, size: u.size },
      geometry: u.geometry, params: p, seed: doc.seed, unitKey: unitKeyOf(u), nullN, fee,
    }));
    const records = new Array(units.length).fill(null);
    await pool.forEach('s1Unit', payloads, (settled, i) => {
      if (doc.cancelRequested) return;
      const u = units[i];
      if (settled.ok && settled.value) {
        const res = settled.value;
        const ranges = writeUnitStores(w, u, i, res);
        records[i] = {
          u: i, trade: u.trade, ctx1: u.ctx1, ctx2: u.ctx2, size: u.size, geometry: u.geometry,
          bandPct: res.bandPct, counts: res.counts, reserve: res.reserve || null,
          specs: res.members.map((m) => ({ ...m.spec, picked: m.picked })),
          voices: voicesOf(res.members, (res.counts || {}).test || 0),
          score: res.score, beat: res.beat, pairs: res.pairs, lead: res.lead,
          nullScores: res.nullScores,
          // the tuning-slice money (3.46.0): the probe votes priced on the slice
          // they were cast on, and every copy of its null set in cents
          money: res.tuning.money, moneyTrades: res.tuning.trades, moneyChunks: res.tuning.chunks,
          nullMoney: res.tuning.nullMoney, beatMoney: res.tuning.beat, leadMoney: res.tuning.lead,
          blocks: ranges,
        };
        w.records.push(records[i]);
        w.records.flush();
      } else if (!settled.ok) {
        doc.failures.push({ unit: unitKeyOf(u), error: String(settled.error || 'failed') });
      }
      doc.perf.unitsDone++;
      doc.perf.elapsedMs = Date.now() - t0;
      doc.perf.etaMs = doc.perf.unitsDone ? Math.round((doc.perf.elapsedMs / doc.perf.unitsDone) * (units.length - doc.perf.unitsDone)) : null;
      doc.perf.cyclesDone += trainingsPerUnit(u.size);
      phaseNote(doc, {
        phase: 'training the LOGREG members', done: doc.perf.unitsDone, total: units.length, word: 'units', startedMs: t0,
        extra: `${doc.perf.cyclesDone.toLocaleString()} of ${doc.perf.cyclesTotal.toLocaleString()} trainings (${unitKeyOf(u)})`,
      });
      saveSet(doc);
    });
    if (doc.cancelRequested) { finishFail(doc, null, pool); return; }
    // The ordering, finalized once: beat desc, lead desc, then unit index —
    // a TOTAL order, so two runs of the same set rank identically.
    const done = records.filter(Boolean);
    done.sort((a, b) => (b.beat - a.beat) || ((b.lead ?? -1e9) - (a.lead ?? -1e9)) || (a.u - b.u));
    const rk = rowstore.writer(id, 'ranking');
    for (let r = 0; r < done.length; r++) {
      rk.push({
        rank: r + 1, u: done[r].u, beat: done[r].beat, pairs: done[r].pairs, lead: done[r].lead, score: done[r].score,
        money: done[r].money, beatMoney: done[r].beatMoney, leadMoney: done[r].leadMoney,
      });
    }
    await rk.close();
    for (const k of ['votes', 'tau', 'models', 'records']) await w[k].close();
    doc.counts = { unitsScored: done.length, failures: doc.failures.length };
    doc.status = done.length === units.length ? 'done' : 'incomplete';
    if (doc.status === 'incomplete') {
      doc.progress = `finished with ${doc.failures.length} unit(s) missing — the set does not match its own plan`;
    } else {
      doc.progress = '';
    }
    doc.finishedAt = new Date().toISOString();
    doc.perf.elapsedMs = Date.now() - t0;
    saveSet(doc);
    if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
    pool.abort();
  })().catch((err) => finishFail(doc, err, pool));
  return { id, name: doc.name, units: units.length };
}

// ---- parent checks ---------------------------------------------------------------
// the stage 1 members' tuning-slice money, read again at stage 2, against
// what the parent recorded: a sentence when they differ by a cent, else null
function moneyDriftOf(res, rec) {
  const here = res && res.tuning3 ? Number(res.tuning3.money) : NaN;
  const there = Number(rec.money);
  if (!Number.isFinite(here) || !Number.isFinite(there)) return null;
  if (Math.abs(here - there) <= 0.005) return null;
  return `the stage 1 members' tuning-slice money came out ${here.toFixed(2)} here and ${there.toFixed(2)}`;
}
function parentOrRefuse(fromId, wantStage) {
  const parent = getSet(String(fromId || ''));
  if (!parent) throw new Error(`no record set called "${fromId}"`);
  if (parent.stage !== wantStage) throw new Error(`${parent.name || parent.id} is a stage ${parent.stage} set — this launch needs a stage ${wantStage} one`);
  if (parent.status !== 'done') throw new Error(`${parent.name} is ${parent.status} — only a finished set can be read from`);
  // A set built on an older measurement block can never be a parent: its
  // members were trained on numbers that no longer exist, in positions that
  // now hold something else. Refused by name, with what to do about it.
  const pm = parent.measurements || 0;
  if (pm !== MEASUREMENTS_VERSION) {
    throw new Error(`${parent.name || parent.id} was built on measurement block ${pm || 'v2 or older'} and this box builds `
      + `${MEASUREMENTS_VERSION} — every member in it was trained on numbers that no longer exist. Start a new stage 1; `
      + 'the old set stays on disk until you delete it.');
  }
  if (parent.engineVersion && !sameEngineLine(parent.engineVersion, ENGINE_VERSION)) {
    throw new Error(`${parent.name} was written by engine ${parent.engineVersion} and this box runs ${ENGINE_VERSION} — `
      + 'votes kept by one version of the arithmetic cannot be priced by another without saying so. The first '
      + 'number is the one that means yesterday\'s records no longer compare, and it has moved.');
  }
  const fresh = stampManifest(`check-${Date.now().toString(36)}`, parent.params.universe);
  const diff = manifestDiff(parent.dataManifest, fresh);
  if (!diff) throw new Error(`${parent.name} carries no readable price-file record, so nothing can prove the data is unchanged`);
  if (!diff.same) {
    const names = [...diff.changed, ...diff.onlyA, ...diff.onlyB];
    throw new Error(`the price files changed since ${parent.name} was written (${names.join(', ')}) — a mismatch refuses, it never mixes`);
  }
  return parent;
}

const recordsInHand = { id: null, rows: null };
function allRecords(id) {
  if (recordsInHand.id === id && recordsInHand.rows) return recordsInHand.rows;
  const rows = rowstore.readAll(id, 'records');
  recordsInHand.id = id; recordsInHand.rows = rows;
  return rows;
}
function rankingOf(id) { return rowstore.readAll(id, 'ranking'); }

// ---- saved sort orders (owner order, 2026-08-27) ---------------------------------
// The stage 1 and stage 2 tables sort by up to three columns, clicked into
// first/second/third priority on Boards and SAVED ON THE RECORD SET —
// because the next stage's carry forward reads this exact order to decide
// what it takes. One closed list of what may be sorted, per stage; a key not
// on it is refused by name, never guessed.
const SORT_KEYS = {
  1: {
    trade: 's', ctx: 's', geometry: 's', members: 'n', voices: 'n', score: 'n', beat: 'share', lead: 'n',
    money: 'n', beatMoney: 'share', leadMoney: 'n',
  },
  2: {
    s1rank: 'n', trade: 's', ctx: 's', geometry: 's', members: 'n', voices: 'n',
    score3: 'n', scoreAll: 'n', helped: 'n', beat: 'share', lead: 'n',
    money3: 'n', moneyAll: 'n', beatMoney: 'share', leadMoney: 'n',
  },
  // Stage 3's ranked table (owner order, 2026-08-27): every column may be
  // picked, ONE at a time — nothing carries out of stage 3, so the sort is
  // only how the table reads. Keys are the ranked rows' own field names;
  // band % sorts numerically with auto sitting last, whichever way it points.
  3: {
    decision: 's', bandMode: 'n', weekdaysOnly: 'n', entry: 's', gate: 's',
    dMult: 'n', tHours: 'n', trailMult: 'n', armMult: 'n',
    agreeRule: 's', avgAgreed: 'n', avgRung: 'n', avgVoices: 'n', members: 'n',
    coins: 'n', avgTest: 'n', avgHold: 'n', avgTrades: 'n', avgVsLong: 'n',
    beat: 'share', avgLead: 'n', coinsInMoney: 'n', beatNoise: 'share',
  },
};
// The words the screens use for those keys, for the chain line — read the
// column headings back, never invented.
const SORT_WORDS = {
  trade: 'coin', ctx: 'alongside', geometry: 'chunk shape', score: 'forecast score',
  beat: 'beat its own null set', lead: 'lead over null set',
  s1rank: 'stage 1 order', members: 'members', voices: 'independent voices',
  score3: 'forecast score — stage 1 members', scoreAll: 'forecast score — all members',
  helped: 'fuller board helped?',
  money: 'tuning-slice $', money3: 'tuning-slice $ — stage 1 members', moneyAll: 'tuning-slice $ — all members',
  beatMoney: 'beat its own null set — tuning-slice $', leadMoney: 'lead over null set — tuning-slice $',
  decision: 'decision', bandMode: 'band', weekdaysOnly: '24/5', entry: 'entry', gate: 'gate',
  dMult: 'd', tHours: 't', trailMult: 'trail', armMult: 'arm',
  agreeRule: 'agree by', avgAgreed: 'share that agreed', avgRung: 'rung it landed on', avgVoices: 'independent voices',
  coins: 'coins', avgTest: 'avg test $', avgHold: 'avg held-back $',
  avgTrades: 'avg held-back trades', avgVsLong: 'avg vs always-long $',
  avgLead: 'lead over null set', coinsInMoney: 'coins in the money',
  beatNoise: 'beat the kept null money',
};
function sortLabel(spec) {
  return (spec || []).map((s) => `${SORT_WORDS[s.key] || s.key} ${s.dir === 'desc' ? 'high to low' : 'low to high'}`).join(', ');
}
function validateSort(stage, spec) {
  const keys = SORT_KEYS[stage];
  if (!keys) throw new Error(`stage ${stage} tables carry no saved sort`);
  if (!Array.isArray(spec)) throw new Error('the sort is a list of up to three columns');
  if (spec.length > 3) throw new Error('three sort priorities at most');
  if (stage === 3 && spec.length > 1) throw new Error('one column at a time on this table');
  const seen = new Set();
  return spec.map((s) => {
    const key = String((s || {}).key || '');
    const dir = (s || {}).dir === 'asc' ? 'asc' : ((s || {}).dir === 'desc' ? 'desc' : null);
    if (!keys[key]) throw new Error(`"${key}" is not a column these tables sort by (${Object.keys(keys).join('/')})`);
    if (!dir) throw new Error(`"${key}" needs a direction, asc or desc`);
    if (seen.has(key)) throw new Error(`"${key}" is picked twice`);
    seen.add(key);
    return { key, dir };
  });
}
// WHICH TWO FIELDS A SHARE COLUMN DIVIDES. There are two share columns now and
// sortValue used to hardcode the first one's pair, so the second would have
// been sorted by the first's numbers while looking like it worked.
const SHARE_FIELDS = {
  beat: ['beat', 'pairs'],
  beatNoise: ['beatNoise', 'noisePairs'],
  beatMoney: ['beatMoney', 'pairs'],
};
function shareNum(key) { return (SHARE_FIELDS[key] || SHARE_FIELDS.beat)[0]; }
function sortValue(kind, key, row) {
  if (kind === 's') return key === 'ctx' ? `${row.ctx1 || ''}${row.ctx2 ? ` + ${row.ctx2}` : ''}` : String(row[key] ?? '');
  if (kind === 'share') {
    const [num, den] = SHARE_FIELDS[key] || SHARE_FIELDS.beat;
    return !row[den] ? null : row[num] / row[den];
  }
  const v = row[key];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}
// A missing value sits LAST whichever way the column points, and the stage's
// own base order breaks every remaining tie — a saved sort is still a TOTAL
// order, so two reads of the same set page identically.
function applySort(stage, rows, spec, baseCmp) {
  const keys = SORT_KEYS[stage];
  const cleaned = validateSort(stage, spec || []);
  const out = rows.slice();
  out.sort((a, b) => {
    for (const { key, dir } of cleaned) {
      const kind = keys[key];
      const va = sortValue(kind, key, a);
      const vb = sortValue(kind, key, b);
      if (va == null || vb == null) {
        if (va == null && vb == null) continue;
        return va == null ? 1 : -1;
      }
      let c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      if (c === 0 && kind === 'share') { const nf = shareNum(key); c = (a[nf] || 0) - (b[nf] || 0); }
      if (c) return dir === 'desc' ? -c : c;
    }
    return baseCmp(a, b);
  });
  return out;
}
// ---- FILTERS ON THE TABLES (owner order, 2026-08-28) ----------------------
//
// One applier for all three tables. Every filter names the field it reads and
// how it reads it: text matches any part of the value, ignoring case; a floor
// keeps rows at or above a number; a ceiling keeps rows at or below one. An
// empty box filters nothing — never everything, which is the way this kind of
// control usually breaks.
const FILTER_KINDS = {
  text: (v, want) => String(v == null ? '' : v).toLowerCase().includes(String(want).toLowerCase()),
  min: (v, want) => v != null && Number.isFinite(Number(v)) && Number(v) >= Number(want),
  max: (v, want) => v != null && Number.isFinite(Number(v)) && Number(v) <= Number(want),
};
// field name -> how it is read. A key not on the list for that stage is
// refused by name rather than quietly ignored, so a screen and the service
// can never disagree about what a filter does.
const FILTER_DEFS = {
  1: {
    trade: ['trade', 'text'], ctx: ['_ctx', 'text'], geometry: ['geometry', 'text'],
    scoreMin: ['score', 'min'], beatMin: ['_beatPct', 'min'], leadMin: ['lead', 'min'],
    voicesMin: ['voices', 'min'], rankMax: ['rank', 'max'],
    moneyMin: ['money', 'min'], beatMoneyMin: ['_beatMoneyPct', 'min'], leadMoneyMin: ['leadMoney', 'min'],
  },
  2: {
    trade: ['trade', 'text'], ctx: ['_ctx', 'text'], geometry: ['geometry', 'text'],
    membersMin: ['members', 'min'], voicesMin: ['voices', 'min'],
    score3Min: ['score3', 'min'], scoreAllMin: ['scoreAll', 'min'], helpedMin: ['helped', 'min'],
    beatMin: ['_beatPct', 'min'], leadMin: ['lead', 'min'], s1rankMax: ['s1rank', 'max'], rankMax: ['rank', 'max'],
    moneyAllMin: ['moneyAll', 'min'], beatMoneyMin: ['_beatMoneyPct', 'min'], leadMoneyMin: ['leadMoney', 'min'],
  },
  3: {
    decision: ['decision', 'text'], entry: ['entry', 'text'], gate: ['_gate', 'text'],
    rule: ['agreeRule', 'text'], bar: ['_bar', 'text'],
    tMin: ['tHours', 'min'], tMax: ['tHours', 'max'],
    coinsMin: ['coins', 'min'], testMin: ['avgTest', 'min'], holdMin: ['avgHold', 'min'],
    tradesMin: ['avgTrades', 'min'], vsLongMin: ['avgVsLong', 'min'],
    beatMin: ['_beatPct', 'min'], leadMin: ['avgLead', 'min'], inMoneyMin: ['coinsInMoney', 'min'],
    voicesMin: ['avgVoices', 'min'], agreedMin: ['avgAgreed', 'min'],
    beatNoiseMin: ['_beatNoisePct', 'min'],
  },
};
// The values a filter may read that are not stored as such: the share a row
// beat of its null set, and the context coins as one piece of text. ONE
// DEFINITION, read by both the filtering and the four numbers beside each
// filter box — two copies of "what does this filter actually read" is two
// answers waiting to disagree.
const DERIVED = {
  _ctx: (r) => [r.ctx1, r.ctx2].filter(Boolean).join(' + '),
  _beatPct: (r) => (!r.pairs ? null : (r.beat / r.pairs) * 100),
  // the share of its null set a row's tuning-slice $ beat; empty on a set
  // written before the money existed
  _beatMoneyPct: (r) => (!r.pairs || r.beatMoney == null ? null : (r.beatMoney / r.pairs) * 100),
  // The share of the kept all-luck copies this row's TEST money beat. Empty,
  // not zero, on a set that kept none: a row that was never asked the question
  // has not answered it badly.
  _beatNoisePct: (r) => (!r.noisePairs ? null : ((r.beatNoise || 0) / r.noisePairs) * 100),
  // WHAT THE gate COLUMN ACTUALLY SHOWS. A setting opened at market carries a
  // gate in its record and the column prints a dash, because no gate applies
  // to it — so a filter reading the stored value would hand back rows the
  // screen says have no gate at all. This reads what is on the screen.
  _gate: (r) => (r.entry === 'market' ? 'does not apply' : String(r.gate || '')),
  // WHICH BAR A ROW USED, in the words the screen shows rather than the word
  // the record stores. Nothing is interpreted here: a record says which bar it
  // used because it was migrated to say so.
  _bar: (r) => (r.agreeBar === 'own' ? 'its own history' : 'all of them'),
  _sharePct: (r) => (r.share == null ? null : r.share * 100),
};
const readsField = (field) => DERIVED[field] || ((r) => r[field]);
function withDerived(r) {
  const out = { ...r };
  for (const [name, read] of Object.entries(DERIVED)) out[name] = read(r);
  return out;
}

// THE FOUR NUMBERS BESIDE EVERY FILTER BOX (owner order, 2026-08-29): the
// smallest, the middle, the average and the largest value that column holds.
//
// They are worked out over the rows the table is HOLDING — the same rows its
// count reports, after every filter in force — so setting the next floor is a
// reading rather than a guess-and-re-ask. A filter that takes words rather
// than a number gets nothing, and its four cells stay empty so the grid still
// lines up.
//
// The middle value needs the column sorted, which is the expensive half. The
// values go into one Float64Array per column and are sorted in place there:
// no per-row objects, and a typed array sorts numerically without a
// comparator. On the 329,280-row table that is a few hundred milliseconds,
// which is too much to repeat on every page turn — so the answer is kept
// against the filters that produced it, and a page turn does not change those.
const SPREAD_CACHE = new Map();
const SPREAD_CACHE_MAX = 8;
function spreadOf(rows, defs) {
  const cols = new Map();
  for (const [key, [field, kind]] of Object.entries(defs)) {
    if (kind === 'text') continue;
    if (!cols.has(field)) cols.set(field, []);
    cols.get(field).push(key);
  }
  const out = {};
  for (const [field, keys] of cols) {
    const read = readsField(field);
    const vals = new Float64Array(rows.length);
    let n = 0;
    let sum = 0;
    for (const r of rows) {
      // `Number(null)` is 0, not NaN — a row that HAS no value would otherwise
      // be counted as a row worth zero, which drags the average and puts a
      // floor of 0 in the minimum column of a column that is entirely empty.
      const raw = read(r);
      if (raw == null || raw === '') continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      vals[n] = v; n++; sum += v;
    }
    let stat = null;
    if (n) {
      const use = vals.subarray(0, n);
      use.sort();
      stat = {
        n,
        min: use[0],
        median: n % 2 ? use[(n - 1) / 2] : (use[n / 2 - 1] + use[n / 2]) / 2,
        avg: sum / n,
        max: use[n - 1],
      };
    }
    for (const k of keys) out[k] = stat;
  }
  return out;
}
function cachedSpread(key, make) {
  const hit = SPREAD_CACHE.get(key);
  if (hit) return hit;
  const out = make();
  SPREAD_CACHE.set(key, out);
  while (SPREAD_CACHE.size > SPREAD_CACHE_MAX) SPREAD_CACHE.delete(SPREAD_CACHE.keys().next().value);
  return out;
}
function applyFilters(stage, rows, filters) {
  const defs = FILTER_DEFS[stage] || {};
  const active = [];
  for (const [key, raw] of Object.entries(filters || {})) {
    if (raw === '' || raw == null) continue;
    const def = defs[key];
    if (!def) throw new Error(`"${key}" is not a filter on the stage ${stage} table (${Object.keys(defs).join('/')})`);
    const [field, kind] = def;
    if (kind !== 'text' && !Number.isFinite(Number(raw))) throw new Error(`the ${key} filter needs a number, not "${raw}"`);
    active.push([field, FILTER_KINDS[kind], raw]);
  }
  if (!active.length) return rows;
  return rows.filter((r) => {
    const d = withDerived(r);
    return active.every(([field, test, want]) => test(d[field], want));
  });
}

// Saving the sort, the same contract notes have: refused while the set is
// being written; an empty list puts the saved sort away.
function setSetSort(id, spec) {
  const doc = getSet(String(id || ''));
  if (!doc) throw new Error('unknown record set');
  if (doc.status === 'running') throw new Error('the record set is still being written — the sort saves after it finishes');
  doc.sort = validateSort(doc.stage, Array.isArray(spec) ? spec : []);
  saveSet(doc);
  return { id: doc.id, sort: doc.sort };
}

// PICKING RECORDS ON THE STAGE 2 TABLE (owner order, 2026-09-02). The ticks
// save on the record set exactly as the sort does, because they are what the
// stage 3 set-up prices when it is told Selected records. A record is named
// by its own number on the set (u); a number the set does not hold is refused
// rather than dropped, so a stale page cannot quietly pick nothing.
function setSetPicked(id, list) {
  const doc = getSet(String(id || ''));
  if (!doc) throw new Error('unknown record set');
  if (doc.stage !== 2) throw new Error(`${doc.name || doc.id} is a stage ${doc.stage} set — records are picked on a stage 2 table`);
  if (doc.status === 'running') throw new Error('the record set is still being written — picks save after it finishes');
  const have = new Set(allRecords(doc.id).map((r) => r.u));
  const picked = [...new Set((Array.isArray(list) ? list : []).map((u) => Math.floor(Number(u))))].sort((a, b) => a - b);
  const unknown = picked.filter((u) => !Number.isFinite(u) || !have.has(u));
  if (unknown.length) throw new Error(`no record numbered ${unknown[0]} on ${doc.name || doc.id}`);
  doc.picked = picked;
  saveSet(doc);
  return { id: doc.id, picked: doc.picked };
}
const pickedOf = (doc) => (Array.isArray((doc || {}).picked) ? doc.picked.map(Number) : []);

// ---- STAGE 2 --------------------------------------------------------------------
function startStage2(params) {
  claimOrRefuse();
  if (params.orderBy !== undefined) {
    throw new Error('order by is gone — the carry follows the sort saved on the parent record set\'s table '
      + '(the fixed rule when none is saved). Pick the sort on Boards.');
  }
  const parent = parentOrRefuse(params.from, 1);
  const carry = Math.max(0, Math.floor(num(params.carry, 0)));
  const ranking = rankingOf(parent.id);
  if (!ranking.length) throw new Error(`${parent.name} holds no ranking — nothing to carry`);
  const parentRecords = new Map(allRecords(parent.id).map((r) => [r.u, r]));
  // A PARENT WITHOUT THE TUNING-SLICE MONEY IS BROUGHT UP TO DATE FIRST (RULE
  // NINE): stage 2 deals the parent's null set again and checks its stage 1
  // members' money against the parent's, and a set written before the money
  // existed has nothing to check against.
  if (tuningMoneyBehind(parent)) {
    throw new Error(`${parent.name} was written before the tuning-slice money existed — open it on Boards and press `
      + 'fill in the tuning-slice money, then launch');
  }
  const parentFee = Number((parent.params || {}).fee);
  if (!Number.isFinite(parentFee)) throw new Error(`${parent.name} declares no fee % each way, so its tuning-slice $ cannot be read again here`);
  const parentNullN = Math.max(0, Math.floor(num((parent.params || {}).nullN, 19)));
  // The carry takes the parent's table in ITS OWN saved order — the exact
  // order the owner sees on Boards — and the fixed rule (the recorded
  // ranking) when no sort is saved.
  const saved = Array.isArray(parent.sort) && parent.sort.length ? parent.sort : null;
  let ordered = ranking.slice();
  if (saved) {
    const merged = ranking.map((row, i) => {
      const r = parentRecords.get(row.u) || {};
      return {
        _i: i, u: row.u, beat: row.beat, pairs: row.pairs, lead: row.lead, score: row.score,
        money: r.money, beatMoney: r.beatMoney, leadMoney: r.leadMoney,
        trade: r.trade, ctx1: r.ctx1, ctx2: r.ctx2, geometry: r.geometry,
      };
    });
    ordered = applySort(1, merged, saved, (a, b) => a._i - b._i);
  }
  const carried = carry > 0 ? ordered.slice(0, carry) : ordered;

  const setName = nameOrRefuse(params.name, 2);
  const seq = seqFor(2);
  const id = `s2-${Date.now().toString(36)}-${seq}`;
  const doc = {
    id, stage: 2, seq, name: setName,
    createdAt: new Date().toISOString(),
    status: 'running', progress: 'writing the plan',
    desc: String(params.desc || ''),
    engineVersion: ENGINE_VERSION,
    measurements: MEASUREMENTS_VERSION,
    boardNull: { ...BOARD_NULL_NONE },
    parent: {
      id: parent.id, name: parent.name, carry: carried.length, of: ranking.length,
      sortedBy: saved ? sortLabel(saved) : 'the fixed rule',
    },
    // ...parent.params carries the parent's campaign in; the campaign in use
    // AT THIS LAUNCH wins, the same rule every other launch follows.
    params: { ...parent.params, carry: carried.length, from: parent.id, campaign: require('./campaign').getCampaign() || null },
    seed: seedOf(id),
    plan: { units: carried.length },
    perf: {
      unitsDone: 0, unitsTotal: carried.length, elapsedMs: 0, etaMs: null, workers: null,
      cyclesDone: 0, cyclesTotal: carried.reduce((nn, row) => nn + trainingsPerUnit((parentRecords.get(row.u) || {}).size), 0), cyclesWord: 'trainings',
    },
    failures: [],
    counts: null,
  };
  doc.dataManifest = stampManifest(id, parent.params.universe);
  activeSet = doc;
  saveSet(doc);

  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveSet(doc);
  const t0 = Date.now();
  const w = writers(id);
  const p = {
    allLoaded: parent.params.allLoaded, startMonth: parent.params.startMonth,
    endMonth: parent.params.endMonth, windowLayout: parent.params.windowLayout,
  };
  (async () => {
    const payloads = [];
    for (const row of carried) {
      const rec = parentRecords.get(row.u);
      if (!rec) throw new Error(`the parent's record for unit ${row.u} is missing — the set does not match its own ranking`);
      const votes = unitRows(parent.id, 'votes', rec.blocks.votes, rec.u);
      const tauRows = unitRows(parent.id, 'tau', rec.blocks.tau, rec.u);
      const nTest = votes.filter((v) => v.w === 0).length;
      const probs = rec.specs.map((_, mi) => votes.map((v) => v.m[mi]));
      payloads.push({
        combo: { trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size },
        geometry: rec.geometry, params: p,
        s1: {
          probs,
          // the stage 1 members' votes on the tuning slice, so their money
          // can be read again here and held against the parent's record
          tauProbs: rec.specs.map((_, mi) => (tauRows.find((t) => t.mi === mi) || {}).probs || []),
          ts: { test: votes.filter((v) => v.w === 0).map((v) => v.ts), hold: votes.filter((v) => v.w === 1).map((v) => v.ts) }, nTest,
        },
        // ONE NULL SET, DECLARED AT STAGE 1 AND DEALT AGAIN HERE (3.46.0): the
        // parent's seed and size, so every member faces the copies the stage 1
        // members faced
        seed: parent.seed, unitKey: unitKeyOf(rec), nullN: parentNullN, fee: parentFee,
        rec: { u: rec.u },
      });
    }
    await pool.forEach('s2Unit', payloads.map(({ rec, ...pl }) => pl), (settled, i) => {
      if (doc.cancelRequested) return;
      const row = carried[i];
      const rec = parentRecords.get(row.u);
      if (settled.ok && settled.value && moneyDriftOf(settled.value, rec)) {
        // THE STAGE 1 MEMBERS' MONEY MUST COME OUT AS THE PARENT RECORDED IT:
        // same votes, same slice, same fee, same deals. A cent of difference
        // means the votes or the price files changed underneath the set, and
        // the unit is refused rather than written -- the timestamp check's mould.
        doc.failures.push({ unit: `${rec.trade}|${rec.geometry}`, error: `${moneyDriftOf(settled.value, rec)} on ${parent.name}` });
      } else if (settled.ok && settled.value) {
        const res = settled.value;
        // Self-contained set (decision record #4): parent's logreg members are
        // copied beside the new boost ones, votes, tau votes and models alike.
        const votes = unitRows(parent.id, 'votes', rec.blocks.votes, rec.u);
        const tau = unitRows(parent.id, 'tau', rec.blocks.tau, rec.u);
        const models = unitRows(parent.id, 'models', rec.blocks.models, rec.u);
        const nTest = votes.filter((v) => v.w === 0).length;
        const merged = {
          bandPct: rec.bandPct,
          reserve: rec.reserve,
          counts: rec.counts,
          ts: { test: votes.filter((v) => v.w === 0).map((v) => v.ts), hold: votes.filter((v) => v.w === 1).map((v) => v.ts) },
          labels: { test: votes.filter((v) => v.w === 0).map((v) => v.y), hold: votes.filter((v) => v.w === 1).map((v) => v.y) },
          members: [
            ...rec.specs.map((spec, mi) => ({
              spec: { model: spec.model, view: spec.view }, picked: spec.picked,
              saved: (models.find((m) => m.mi === mi) || {}).saved,
              tauProbs: (tau.find((t) => t.mi === mi) || {}).probs || [],
              probs: votes.map((v) => v.m[mi]),
            })),
            ...res.members,
          ],
        };
        const ranges = writeUnitStores(w, rec, i, merged);
        const record = {
          u: i, s1u: rec.u, s1rank: ranking.find((r) => r.u === rec.u)?.rank ?? null,
          carriedRank: i + 1,
          trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size, geometry: rec.geometry,
          bandPct: rec.bandPct, counts: rec.counts,
          // THE SEALED BOUNDS RIDE ON THE RECORD (3.51.0): a stage 3 set's
          // units are these records, and the sealed window is read off them
          reserve: rec.reserve || null,
          specs: merged.members.map((m) => ({ ...m.spec, picked: m.picked })),
          voices: voicesOf(merged.members, merged.ts.test.length),
          voices3: voicesOf(merged.members.slice(0, rec.specs.length), merged.ts.test.length),
          score3: res.score3, scoreAll: res.scoreAll, helped: res.helped,
          // every member's own reading against the parent's null set (3.46.0),
          // no longer the stage 1 numbers copied across
          beat: res.beat, pairs: res.pairs, lead: res.lead, nullScores: res.nullScores,
          money3: res.tuning3.money, money: res.tuning.money, moneyTrades: res.tuning.trades, moneyChunks: res.tuning.chunks,
          nullMoney: res.tuning.nullMoney, beatMoney: res.tuning.beat, leadMoney: res.tuning.lead,
          blocks: ranges,
        };
        w.records.push(record);
        w.records.flush();
      } else if (!settled.ok) {
        doc.failures.push({ unit: `${rec.trade}|${rec.geometry}`, error: String(settled.error || 'failed') });
      }
      doc.perf.unitsDone++;
      doc.perf.elapsedMs = Date.now() - t0;
      doc.perf.etaMs = doc.perf.unitsDone ? Math.round((doc.perf.elapsedMs / doc.perf.unitsDone) * (carried.length - doc.perf.unitsDone)) : null;
      doc.perf.cyclesDone += trainingsPerUnit(rec.size);
      phaseNote(doc, {
        phase: 'training the BOOST members', done: doc.perf.unitsDone, total: carried.length, word: 'units', startedMs: t0,
        extra: `${doc.perf.cyclesDone.toLocaleString()} of ${doc.perf.cyclesTotal.toLocaleString()} trainings`,
      });
      saveSet(doc);
    });
    if (doc.cancelRequested) { finishFail(doc, null, pool); return; }
    for (const k of ['votes', 'tau', 'models', 'records']) await w[k].close();
    const okN = carried.length - doc.failures.length;
    doc.counts = { unitsScored: okN, failures: doc.failures.length };
    doc.status = okN === carried.length ? 'done' : 'incomplete';
    doc.progress = doc.status === 'incomplete' ? `finished with ${doc.failures.length} unit(s) missing — the set does not match its own plan` : '';
    doc.finishedAt = new Date().toISOString();
    saveSet(doc);
    if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
    pool.abort();
  })().catch((err) => finishFail(doc, err, pool));
  return { id, name: doc.name, units: carried.length };
}

// ---- STAGE 3 --------------------------------------------------------------------
// ---- THE AGREEMENT DIAL (owner loop, 2026-08-28) --------------------------
//
// The old dial was a COUNT, and it needed one number per committee size —
// which is why settings were named things like "q3/6+4/8": two bars, one of
// which never applied. The dial is now a SHARE OF THE COMMITTEE, so one
// number means the same thing whether a coin's committee holds 8 members or
// 32, and no committee size appears in any name ever again.
//
// The menu is chosen so that every whole rung of an 8-member and of a
// 10-member committee is reachable; shares that land on the same rung for
// every unit in a run are dropped at launch rather than priced twice.
const AGREE_PCTS = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
const PERSISTS = [0, 1, 2];

// How many members and how many kinds of evidence a unit of this size holds.
// A coin judged on its own is read four ways; one read alongside others has
// a fifth reading, the cross-coin one.
const readingsForSize = (size) => (size === 1 ? 4 : 5);
const membersForSize = (size) => readingsForSize(size) * 2;
// The rung a share lands on for a committee of this many.
const rungFor = (pct, n) => Math.max(1, Math.min(n, Math.ceil((pct / 100) * n)));

// THE gate BACK OUT OF A SHAPE'S NAME. shapeLabel writes it as the first word
// (or `market`, which has no gate), and this reads it back — kept against the
// writer, with a test that walks every gate through both, because Table 3.B
// knows a setting only by its name. Nothing else about the name is parsed.
// The trade shape's name, without any agreement in it.
function shapeLabel(cell) {
  const trailBit = cell.trailMult == null ? '' : ` trail${cell.trailMult}x/arm${cell.armMult}x`;
  return cell.entry === 'market'
    ? `market t${cell.tHours}h`
    : `${cell.gate} d${cell.dMult}x t${cell.tHours}h${trailBit}`;
}
// A QUORUM'S NAME. The bar is in it because the same share means two different
// things under the two bars — 75% of what exists, or the strongest 25% of what
// this committee reaches — and a name that hid the difference would put two
// unlike settings under one heading.
function agreeLabel(a) {
  // the one-voice threshold rides the name only where it can change anything —
  // no other way of weighing reads it, and a name that carried it everywhere
  // would say two settings differ when they are the same trade.
  return `${a.rule} ${a.pct}%${a.bar === 'own' ? ' own' : ''}${a.rule === 'voices' ? ` +voice${a.copy}` : ''}${a.bothModels ? ' +both' : ''}${a.persist ? ` +hold${a.persist}` : ''}`;
}

// Every quorum the block declares, with the shares that cannot be told apart on
// THIS run's units removed.
//
// A share is only comparable up front when its bar is a share of what EXISTS
// and that count is known from the committee's size — count, conviction and
// families against the all bar. Against the own history bar, and for voices
// whichever bar it uses, the bar resolves against each unit's own data at
// pricing time, so every share stands.
function agreementsFor(params, sizes) {
  const rules = params.agreePermuteRule
    ? agreement.AGREE_RULES.slice()
    : [agreement.AGREE_RULES.includes(params.agreeRule) ? params.agreeRule : 'count'];
  const bars = params.agreePermuteBar
    ? agreement.AGREE_BARS.slice()
    : [agreement.AGREE_BARS.includes(params.agreeBar) ? params.agreeBar : 'all'];
  const copies = params.agreePermuteCopy
    ? agreement.COPY_PCTS.slice()
    : [agreement.COPY_PCTS.includes(Number(params.agreeCopy)) ? Number(params.agreeCopy) : agreement.COPY_DEFAULT];
  const pcts = params.agreePermutePct ? AGREE_PCTS.slice() : [Number(params.agreePct) || 50];
  for (const p of pcts) if (!Number.isFinite(p) || p <= 0 || p > 100) throw new Error(`agreement share must be a percent above 0, not "${p}"`);
  const boths = params.agreePermuteBoth ? [false, true] : [!!params.agreeBothModels];
  const persists = params.agreePermutePersist ? PERSISTS.slice() : [Math.max(0, Math.floor(Number(params.agreePersist) || 0))];
  const seenSizes = (sizes && sizes.length ? sizes : [1]);
  const out = [];
  const seen = new Set();
  for (const rule of rules) {
    // ONLY THE VOICES WAY OF WEIGHING READS THE ONE-VOICE THRESHOLD. Sweeping
    // it for the others would pay for identical settings under different
    // names — the same fold the shares already get, applied one dial along.
    for (const copy of (rule === 'voices' ? copies : copies.slice(0, 1))) {
      for (const bar of bars) {
        for (const pct of pcts) {
          // the rungs this share lands on, one per committee size in the run
          let key = null;
          if (bar === 'all' && (rule === 'count' || rule === 'conviction')) {
            key = `${rule}|${seenSizes.map((z) => rungFor(pct, membersForSize(z))).join(',')}`;
          } else if (bar === 'all' && rule === 'families') {
            key = `${rule}|${seenSizes.map((z) => rungFor(pct, readingsForSize(z))).join(',')}`;
          }
          for (const bothModels of boths) {
            for (const persist of persists) {
              const k = key === null ? null : `${key}|${bothModels}|${persist}`;
              if (k !== null) { if (seen.has(k)) continue; seen.add(k); }
              out.push({ rule, bar, pct, copy, bothModels, persist });
            }
          }
        }
      }
    }
  }
  return out;
}

// The settings block: (decision x band x 24/5) x (the trade shape) x (the
// agreement). The trade shape is still expanded and validated by the SAME
// enumerator the sweep launcher uses, so a block here can never contain a
// trade the old path would refuse; the agreement dimension is this stage's
// own, because the old path cannot express any of it.
// TWO SETTINGS THAT PRICE THE SAME TRADE ARE ONE SETTING (owner order,
// 2026-08-29, after asking whether band % and d were producing duplicates).
//
// They were not — on today's menus all 195 band-and-d-and-trail-and-arm
// combinations come out distinct — but only by luck of the numbers, and
// nothing checked. The band is NOT an independent dimension at pricing time:
// simCell uses it for exactly three things and nothing else —
//
//     dPct = dMult x band     trailPct = trailMult x band     armPct = armMult x band
//
// — so it is the UNIT those three are measured in. Two settings whose three
// products match place identical orders and would be paid for twice: once in
// compute, and again in a ranked table listing the same trade under two names.
// Add 0.6 to the distance menu tomorrow and 5% x 0.6 becomes 3% x 1.0.
//
// AND `auto` IS THE CASE THAT CANNOT BE SEEN ON THE MENUS AT ALL. It resolves
// per unit to that unit's own measured band, so an auto setting is the same
// trade as a fixed 5% one for every coin whose band happens to be 5. The
// records carry each unit's band, so the launch resolves it and compares the
// whole run — the same rule the agreement shares already follow: settings that
// come out identical FOR EVERY UNIT are one setting; if they differ on even one
// coin they are two, and both run.
//
// HOW CLOSE IS THE SAME. A relative tolerance, because these are percentages
// of price and an auto band is a measured number that will never land exactly
// on 5. The menus' own finest deliberate distinction is 6.7% apart (3.75
// against 4.0 as rail distances), so a 1% tolerance cannot merge two choices
// the menus meant to keep separate, while it does merge an auto band that has
// landed on one of them. Being a tolerance it is not transitive — a long enough
// chain of near-matches could fold two ends that are 2% apart — so matching is
// greedy against a representative rather than clustered, which bounds it, and
// the number folded is always reported rather than absorbed.
const SAME_TRADE_TOLERANCE = 0.01;
const sameShape = (a, b) => {
  if (a == null || b == null) return a == null && b == null;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? true : Math.abs(a - b) <= SAME_TRADE_TOLERANCE * scale;
};

// The band each unit would price this setting at: a number is itself, `auto`
// is that unit's own measured band.
function bandsAcross(band, records) {
  if (band !== 'auto') { const n = Math.abs(Number(band)); return records.map(() => n); }
  return records.map((r) => Math.abs(Number(r.bandPct)) || 0);
}

// Fold a declared block down to the settings that actually price different
// trades. Returns the kept settings and what was folded into what, so the
// screen can say so.
// WHICH SHAPES PRICE THE SAME TRADE ON EVERY UNIT OF THIS RUN. Only the band
// and the three multipliers decide the priced geometry, and a block holds a
// handful of those combinations however many settings it has — so equivalence
// is worked out once per combination, not once per setting. ONE pass, read by
// the fold the launch runs and by the count the Sweep cost line asks for, so
// the two can never disagree about what is the same trade.
const shapeKeyOf = (st) => [st.band, st.dMult ?? null, st.trailMult ?? null, st.armMult ?? null].join('|');
function shapeRepsFor(shapes, records) {
  const bandCache = new Map();
  const across = (band) => {
    if (!bandCache.has(band)) bandCache.set(band, bandsAcross(band, records));
    return bandCache.get(band);
  };
  const reps = [];                      // { key, vecs }
  const repOf = new Map();              // shapeKey -> representative index
  for (const st of shapes) {
    const k = shapeKeyOf(st);
    if (repOf.has(k)) continue;
    const bands = across(st.band);
    const vecs = [st.dMult ?? null, st.trailMult ?? null, st.armMult ?? null]
      .map((m) => (m == null ? null : bands.map((bp) => m * bp)));
    let at = reps.findIndex((r) => r.vecs.every((v, i) => {
      const w = vecs[i];
      if (v == null || w == null) return v == null && w == null;
      return v.every((x, j) => sameShape(x, w[j]));
    }));
    if (at < 0) { at = reps.length; reps.push({ key: k, vecs }); }
    repOf.set(k, at);
  }
  return repOf;
}
// THE FOLD IS PER UNIT (3.52.0, owner order 2026-09-04: "OBVIOUSLY the system
// should not permute 24/5 on any weekly shape. Ever."). Two settings are one
// setting ON A UNIT when they place the same orders there: the same resolved
// geometry (a band 'auto' and a fixed band can land on one geometry on this
// unit and two on another), the same effective 24/5 (a shape with no weekday
// version -- weekly-8d -- prices both values of 24/5 identically), and the
// same everything else. Each unit keeps the first of its duplicates in block
// order and prices nothing else. A setting no unit keeps is not in the block
// at all, which is exactly the fold that used to be the whole rule.
//
// THE BAR IS PART OF WHAT MAKES A SETTING ITSELF: the same way of weighing at
// the same share against the two different bars is two settings, because the
// bar changes when the committee is judged to have spoken.
function weekdaysApplyTo(rec) { return require('./dataset').weekdaysApply(rec.geometry); }
function foldKeyRest(st, wk) {
  return [st.decision, wk ? 1 : 0, st.entry, st.gate, st.tHours,
    st.agreeRule, st.agreeBar, st.agreePct, st.agreeRule === 'voices' ? st.agreeCopy : 0,
    st.agreeBoth, st.agreePersist].join('|');
}
// heldOn[u]: the settings unit u prices, as indexes into `settings`, in block order
function heldOnFor(settings, records) {
  const heldOn = [];
  for (const rec of records) {
    const repOf = shapeRepsFor(settings, [rec]);          // one unit's own geometry classes
    const wkApplies = weekdaysApplyTo(rec);
    const seen = new Set();
    const mine = [];
    for (let i = 0; i < settings.length; i++) {
      const st = settings[i];
      const key = `${repOf.get(shapeKeyOf(st))}|${foldKeyRest(st, wkApplies ? !!st.weekdaysOnly : false)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mine.push(i);
    }
    heldOn.push(mine);
  }
  return heldOn;
}
function foldSameTradeSettings(settings, records) {
  if (!Array.isArray(records) || !records.length) return { kept: settings, folded: [], heldOn: [], unitFolded: [] };
  const heldOn = heldOnFor(settings, records);
  const keptOnAny = new Uint8Array(settings.length);
  for (const list of heldOn) for (const i of list) keptOnAny[i] = 1;
  const kept = [];
  const folded = [];
  const newIndex = new Int32Array(settings.length).fill(-1);
  // what a dropped setting was folded INTO: the setting unit 0 keeps for its key
  const firstOn0 = new Map();
  if (heldOn.length) {
    const repOf = shapeRepsFor(settings, [records[0]]);
    const wk0 = weekdaysApplyTo(records[0]);
    for (const i of heldOn[0]) firstOn0.set(`${repOf.get(shapeKeyOf(settings[i]))}|${foldKeyRest(settings[i], wk0 ? !!settings[i].weekdaysOnly : false)}`, settings[i].label);
    for (let i = 0; i < settings.length; i++) {
      if (keptOnAny[i]) continue;
      const st = settings[i];
      folded.push({ dropped: st.label, kept: firstOn0.get(`${repOf.get(shapeKeyOf(st))}|${foldKeyRest(st, wk0 ? !!st.weekdaysOnly : false)}`) || null });
    }
  }
  for (let i = 0; i < settings.length; i++) {
    if (!keptOnAny[i]) continue;
    newIndex[i] = kept.length;
    kept.push(settings[i]);
  }
  const held = heldOn.map((list) => list.map((i) => newIndex[i]));
  return { kept, folded, heldOn: held, unitFolded: held.map((list) => kept.length - list.length) };
}
// what a set's units hold, summed: the pricings its records stand for; null
// until the set says so (a set behind on the per-unit fold does not)
function pricingsOf(doc) {
  const us = ((doc || {}).plan || {}).unitSettings;
  if (!Array.isArray(us)) return null;
  return us.reduce((a, x) => a + (Number(x.held) || 0), 0);
}

// The trade shapes a block declares — the SAME enumerator the sweep launcher
// uses, so a block here can never contain a trade the old path would refuse.
function shapeCellsFor(params) {
  const grid = {
    dMults: bracketLib.D_MULTS, tHours: bracketLib.T_HOURS, gates: bracketLib.GATES,
    entries: bracketLib.ENTRIES, trailMults: bracketLib.TRAIL_MULTS, armMults: bracketLib.ARM_MULTS,
  };
  // the shape side only — the agreement never travels through the old
  // enumerator, so its 'agree' permute is switched off here by construction
  const shapeCell = { ...(params.cell || {}) };
  delete shapeCell.quorumSingles;
  delete shapeCell.quorumContexts;
  delete shapeCell.quorumRatio;
  shapeCell.quorum = 1;
  const shapePermute = { ...(params.cellPermute || {}) };
  delete shapePermute.agree;
  return batch.expandDeclared(shapeCell, shapePermute, grid);
}
// The three plain axes of a block: decision, band and 24/5.
function blockAxesFor(params) {
  const decisions = params.permuteDecision ? ['argmax', 'directional'] : [params.decision === 'directional' ? 'directional' : 'argmax'];
  const BAND_MENU = ['auto', 3, 5, 8];
  const bands = params.permuteBand ? BAND_MENU : [params.band === 'auto' || params.band === undefined || params.band === '' ? 'auto' : Number(params.band)];
  for (const b of bands) if (b !== 'auto' && !(Number.isFinite(b) && b > 0)) throw new Error(`band must be auto or a positive percent, not "${b}"`);
  const weekdays = params.permuteWeekdays ? [false, true] : [!!params.weekdaysOnly];
  return { decisions, bands, weekdays };
}
function settingsFor(params, sizes = null) {
  const cells = shapeCellsFor(params);
  const agrees = agreementsFor(params, sizes);
  const { decisions, bands, weekdays } = blockAxesFor(params);
  const out = [];
  for (const decision of decisions) {
    for (const band of bands) {
      for (const wk of weekdays) {
        for (const cell of cells) {
          for (const a of agrees) {
            out.push({
              ...cell, quorum: undefined,
              agreeRule: a.rule, agreeBar: a.bar, agreePct: a.pct, agreeCopy: a.copy,
              agreeBoth: a.bothModels, agreePersist: a.persist,
              decision, band, weekdaysOnly: wk,
              label: `${agreeLabel(a)} ${shapeLabel(cell)} \u00b7 ${decision} ${band === 'auto' ? 'auto' : `${band}%`} ${wk ? '24/5' : '24/7'}`,
            });
          }
        }
      }
    }
  }
  return out;
}

// the units a stage 3 launch will actually price: every carried record, or
// the top of the parent's table in the SAME order its table shows — the
// sort saved on it, or forecast score with all members when none is saved,
// ties by carry position either way — cut to the carry count.
function stage3UnitsFor(parent, carry, selected = null) {
  let records = allRecords(parent.id);
  const savedS2 = Array.isArray(parent.sort) && parent.sort.length ? parent.sort : null;
  // SELECTED RECORDS (owner order, 2026-09-02): exactly the records picked on
  // the parent's table, in the parent's own record order; the carry count
  // does not apply. Anything else is the carry: every record, or the top of
  // the table.
  if (Array.isArray(selected)) {
    const want = new Set(selected.map(Number));
    records = records.filter((r) => want.has(r.u));
    return { records, savedS2, selected: records.map((r) => r.u) };
  }
  if (carry > 0) {
    let ordered;
    if (savedS2) {
      ordered = applySort(2,
        records.map((r) => ({ ...r, members: (r.specs || []).length })),
        savedS2, (a, b) => a.carriedRank - b.carriedRank);
    } else {
      ordered = records.slice()
        .sort((a, b) => ((b.scoreAll ?? -1e9) - (a.scoreAll ?? -1e9)) || (a.carriedRank - b.carriedRank));
    }
    records = ordered.slice(0, carry);
  }
  return { records, savedS2, selected: null };
}
// HOW A STAGE 3 SET SAYS WHICH OF ITS PARENT'S RECORDS IT PRICED: the exact
// list it selected, or its carry count. One reader for every place that
// resolves a set's units again (RULE NINE: the record says what it is).
function unitsChoiceOf(params) {
  const p = params || {};
  const selected = Array.isArray(p.selected) ? p.selected.map(Number) : null;
  return { carry: selected ? 0 : Math.max(0, Math.floor(num(p.carry, 0))), selected };
}
// what the stage 3 set-up's `records to price` offers, and all it accepts --
// the screen draws its dropdown from this through the vocabulary, so the
// words on the screen and the values the launch takes are one list
const PICK_CHOICES = ['count', 'selected'];
const PICK_LABELS = Object.freeze({ count: 'N records', selected: 'Selected records' });
// THE RECORDS A STAGE 3 LAUNCH PRICES, from what the set-up asked: `count`
// takes the carry (0 = all, N = the top of the parent's table); `selected`
// takes the records picked on the parent's stage 2 table, and refuses when
// none are picked rather than pricing nothing or everything.
function stage3RecordsFor(parent, params) {
  const p = params || {};
  const pick = p.pick == null || p.pick === '' ? 'count' : String(p.pick);
  if (!PICK_CHOICES.includes(pick)) throw new Error(`records to price must be N records or Selected records — not "${pick}"`);
  if (pick === 'selected') {
    const picked = pickedOf(parent);
    if (!picked.length) throw new Error(`nothing is picked on ${parent.name || parent.id} — tick records on its stage 2 table on Boards, or price N records`);
    return { pick, carry: 0, ...stage3UnitsFor(parent, 0, picked) };
  }
  const carry = Math.max(0, Math.floor(num(p.carry, 0)));
  return { pick, carry, ...stage3UnitsFor(parent, carry) };
}

// THE SEALED WINDOW IS ALREADY ON DISK, ONE LEVEL UP (Funnel build, 2026-08-31).
// FUNNEL-DESIGN.md said stage 3 must stamp it and a migration must backfill it.
// Neither is needed and both were wrong: unitChunks seals the final 13% under
// reserve61, stage 1 writes it on every record (`reserve: res.reserve || null`)
// and stage 2 copies it forward (`reserve: rec.reserve`). A stage 3 set's UNITS
// ARE its parent's records, so the bounds are a read, not a migration.
//
// It is resolved through stage3UnitsFor with the set's OWN stored carry, which
// is the same resolution the launch ran — so the units this returns are the
// units that were priced, in the same order, and not a re-derivation that could
// disagree with them.
function sealedWindowOf(doc) {
  const layout = ((doc || {}).params || {}).windowLayout || null;
  const none = (why) => ({ layout, sealed: false, units: [], missing: 0, why });
  if (layout !== 'reserve61') {
    return none(`this set's window layout is ${layout || 'unrecorded'} — only reserve61 seals a final window`);
  }
  const parentId = ((doc.parent || {}).id) || ((doc.params || {}).from) || null;
  if (!parentId) return none('this set names no parent to read the sealed window from');
  const parent = getSet(parentId);
  if (!parent) return none(`its parent ${parentId} is gone, so the sealed window cannot be read back`);
  let records;
  // with the set's OWN stored choice of records -- the exact list it
  // selected, or its carry -- or it resolves a different set of units
  const choice = unitsChoiceOf(doc.params || {});
  try {
    ({ records } = stage3UnitsFor(parent, choice.carry, choice.selected));
  } catch (err) {
    return none(`its parent's records would not resolve: ${err.message}`);
  }
  const units = records.map((r) => ({
    u: r.u, trade: r.trade, ctx1: r.ctx1 ?? null, ctx2: r.ctx2 ?? null,
    geometry: r.geometry, reserve: r.reserve || null,
  }));
  return sealedFromUnits(layout, units);
}

// The verdict, pure — no set document, no filesystem, so it is testable without
// writing anything into the owner's record store.
//
// A PARTLY sealed set is NOT a sealed set. One unit with no reserve means the
// one-touch grade would quietly grade fewer coins than the board holds, and
// quietly is the whole problem.
function sealedFromUnits(layout, units) {
  if (!Array.isArray(units) || !units.length) {
    return { layout, sealed: false, units: [], missing: 0, why: 'there are no units to seal' };
  }
  const missing = units.filter((x) => !x || !x.reserve).length;
  return {
    layout,
    sealed: missing === 0,
    units,
    missing,
    why: missing ? `${missing} of ${units.length} units carry no sealed window` : null,
  };
}

// WHAT THE STEP 6 LIMITS ARE LIMITS ON (3.57.0, owner order 2026-09-04: "more
// context is needed to set the worst losing streak allowed and fewest trades
// ... how much are we trading per trade? how much can be on the table at once
// maximum? ... fewest trades? over what time period?").
//
// THE STAKE is one number in the engine and is not a choice: every trade is
// priced on a NOTIONAL position, so every money figure on every screen is
// dollars at that stake.
//
// ON THE TABLE AT ONCE: NOT one stake per coin (owner, 2026-09-04: "which is
// of course not true. in the case of the weekly shape it's true"). A unit
// starts a new chunk every stepHours and holds a position for tHours, so the
// positions OVERLAP whenever the hold outruns the step: a daily shape steps 24
// hours and a hold of 137 leaves six open at once, six stakes on that coin. A
// weekly shape steps 168 and holds at most 161, so it really does hold one at
// a time -- which is why the single-position reading looked right. The most on
// the table is worked out per unit, from the unit's OWN step and the longest
// hold the rule still allows, and summed over the units the reading covers.
//
// THE WINDOW the trades are counted over is the test window, and its bounds
// are DERIVED, never typed: a reserve61 run seals the last 13% of a unit's
// chunks and records those bounds on the record (3.51.0), so the work window
// ends where the sealed one begins; of the work window the last 15% is held
// back and the 15% before that is the test window. The chunk step is the
// unit's own (a daily shape steps a day, a weekly one a week), and the sealed
// record says how many chunks it holds, so the work window's length is read
// off the same arithmetic the run split on rather than guessed from months.
const TEST_SHARE = 0.15;         // of the work window, the same split the run used
const HOLD_SHARE = 0.15;         // held back after it
const RESERVE_SHARE = 0.13;      // sealed off the whole, before the work window
function testWindowOfUnit(unit) {
  const res = unit && unit.reserve;
  // WHAT A RECORD ACTUALLY CARRIES (owner, 2026-09-04: "'The window the trades
  // were counted over cannot be worked out' ... i don't believe you"). Right:
  // the record holds `chunks` and `fromTs` and NO end timestamp, and this
  // demanded one, so every set on the box said the window could not be worked
  // out. It never needed one -- the step comes from the shape, and where the
  // sealed window BEGINS is where the work window ended, which is the only
  // anchor the arithmetic below uses.
  if (!res || !res.fromTs || !res.chunks) return null;
  const geo = (require('./dataset').GEOMETRIES || {})[unit.geometry] || null;
  const stepMs = geo && geo.stepHours ? geo.stepHours * 3600 * 1000
    : (res.toTs ? (res.toTs - res.fromTs) / res.chunks : 0);
  if (!(stepMs > 0)) return null;
  const whole = Math.round(res.chunks / RESERVE_SHARE);      // the sealed part is that share of it
  const work = Math.max(1, whole - res.chunks);
  const nHold = Math.max(2, Math.round(work * HOLD_SHARE));
  const nTest = Math.max(2, Math.round(work * TEST_SHARE));
  const workEnd = res.fromTs;                                // the sealed window starts where work ended
  const toTs = workEnd - nHold * stepMs;
  const fromTs = toTs - nTest * stepMs;
  const days = (toTs - fromTs) / 86400000;
  return { fromTs, toTs, chunks: nTest, days, weeks: days / 7, perYearFactor: days > 0 ? 365.25 / days : null };
}
// the same, for every unit a reading covers: the window each was tested over,
// and the stake that can be on the table at once across them
function exposureOf(doc, units, opts = {}) {
  const { NOTIONAL } = require('./paper');
  const GEO = require('./dataset').GEOMETRIES || {};
  // the longest hold still allowed: read off the settings on screen, so it
  // narrows as the rule does rather than standing at the block's widest
  const holdHours = Number.isFinite(Number(opts.holdHours)) && Number(opts.holdHours) > 0 ? Number(opts.holdHours) : null;
  const list = (units || []).map((u) => {
    const stepHours = (GEO[u.geometry] || {}).stepHours || null;
    // how many can be open at once on this unit: a new start every step, each
    // held for the hold, so the hold divided by the step, rounded up
    const atOnce = stepHours && holdHours ? Math.max(1, Math.ceil(holdHours / stepHours)) : (stepHours ? 1 : null);
    return { ...u, window: testWindowOfUnit(u), stepHours, atOnce, mostAtOnce: atOnce == null ? null : NOTIONAL * atOnce };
  });
  const coins = new Set(list.map((u) => u.trade).filter(Boolean)).size;
  const windows = list.map((u) => u.window).filter(Boolean);
  const from = windows.length ? Math.min(...windows.map((w) => w.fromTs)) : null;
  const to = windows.length ? Math.max(...windows.map((w) => w.toTs)) : null;
  const days = windows.length ? Math.max(...windows.map((w) => w.days)) : null;
  const known = list.filter((u) => u.mostAtOnce != null);
  return {
    stake: NOTIONAL,
    coins,
    units: list.length,
    holdHours,
    perUnit: list.map((u) => ({ name: unitNameOf(u), geometry: u.geometry, stepHours: u.stepHours, atOnce: u.atOnce, mostAtOnce: u.mostAtOnce })),
    // the most on the table across this reading: every unit's own overlap,
    // added up, and null when a unit's step is not known rather than guessed
    mostAtOnce: known.length === list.length && list.length ? known.reduce((a, u) => a + u.mostAtOnce, 0) : null,
    window: from && to ? { fromTs: from, toTs: to, days, weeks: days / 7, perYearFactor: days > 0 ? 365.25 / days : null } : null,
    why: windows.length ? null : (((doc || {}).params || {}).windowLayout === 'reserve61'
      ? 'the units carry no sealed window, so the window they were tested over cannot be worked out'
      : `this set's window layout is ${((doc || {}).params || {}).windowLayout || 'unrecorded'} — only reserve61 records the bounds this is worked out from`),
  };
}

// ---- FILLING IN THE SEALED WINDOW (3.51.0, RULE NINE) ------------------------
// A stage 2 set whose records carry no sealed bounds is behind: its units are
// its parent's, and the parent's records carry the bounds for each of them.
// It is filled in from the parent by unit, written BESIDE and swapped only
// after the copy is checked; announced on the Funnel and run once in the
// background, the way the totalling is. A parent that carries no bounds
// itself cannot fill anything, and the set says so rather than guessing.
function sealedBehind(doc) {
  if (!doc || doc.stage !== 2) return null;
  if (doc.status !== 'done' && doc.status !== 'incomplete') return null;
  const recs = allRecords(doc.id);
  if (!recs.length || recs.every((r) => r.reserve)) return null;
  const parent = getSet((doc.parent || {}).id);
  if (!parent) return { fillable: false, parent: null, why: `${doc.name} names a parent that is no longer on disk, so its sealed window cannot be filled in` };
  const from = allRecords(parent.id);
  const source = (r) => from.find((x) => x.u === r.s1u && unitKeyOf(x) === unitKeyOf(r)) || null;
  const missing = recs.filter((r) => !(source(r) || {}).reserve).length;
  if (missing) return { fillable: false, parent, why: `${parent.name} carries no sealed window for ${missing} of ${recs.length} units, so ${doc.name} cannot be filled in from it` };
  return { fillable: true, parent, why: null };
}
const sealedFills = new Map();   // set id -> the fill going, so a read never starts a second
function startSealedFill(id) {
  if (sealedFills.has(id)) return sealedFills.get(id);
  const doc = getSet(id);
  const behind = sealedBehind(doc);
  if (!behind) throw new Error(`${(doc || {}).name || id} carries its sealed window — there is nothing to fill in`);
  if (!behind.fillable) throw new Error(behind.why);
  const busy = stageBusy();
  if (busy) throw new Error(`${busy} is running — filling in the sealed window waits rather than competing for the box`);
  const recs = allRecords(id);
  const from = allRecords(behind.parent.id);
  const was = doc.status;
  activeSet = doc;
  doc.status = 'filling';
  doc.progress = `filling in the sealed window from ${behind.parent.name}`;
  saveSet(doc);
  const run = { id, done: 0, total: recs.length, error: null, promise: null };
  run.promise = (async () => {
    const SPARE = 'records-sealing';
    for (const f of [rowstore.storeFile(id, SPARE), `${rowstore.storeFile(id, SPARE)}.meta.json`,
      rowstore.gzFile(id, SPARE), `${rowstore.gzFile(id, SPARE)}.meta.json`]) {
      try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
    }
    const w = rowstore.writer(id, SPARE, { offThread: true });
    for (const rec of recs) {
      const src = from.find((x) => x.u === rec.s1u && unitKeyOf(x) === unitKeyOf(rec));
      w.push({ ...rec, reserve: src.reserve });
      w.flush();
      run.done++;
      doc.progress = `filling in the sealed window from ${behind.parent.name}: ${run.done} of ${run.total} records`;
      saveSet(doc);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    await w.close();
    // VERIFY BEFORE ANYTHING IS REPLACED: the same records in the same order,
    // every one of them carrying the bounds
    const got = rowstore.readAll(id, SPARE);
    if (got.length !== recs.length) throw new Error(`the copy holds ${got.length} records and the set has ${recs.length} — nothing was replaced`);
    if (got.some((r, i) => !r.reserve || r.u !== recs[i].u)) throw new Error('a record in the copy carries no sealed window, or the order moved — nothing was replaced');
    // SWAP.
    const fromFile = rowstore.storeFile(id, SPARE);
    const to = rowstore.storeFile(id, 'records');
    fs.renameSync(`${fromFile}.meta.json`, `${to}.meta.json`);
    fs.renameSync(fromFile, to);
    recordsInHand.id = null; recordsInHand.rows = null;      // the old rows must never be served again
    doc.sealedFilledAt = new Date().toISOString();
    doc.status = was;
    doc.progress = '';
    saveSet(doc);
  })().catch((err) => {
    run.error = String((err && err.message) || err);
    doc.status = was;
    doc.progress = `the sealed-window fill failed: ${run.error}`;
    saveSet(doc);
  }).finally(() => {
    if (activeSet && activeSet.id === doc.id) activeSet = null;
    sealedFills.delete(id);
  });
  sealedFills.set(id, run);
  return run;
}
// What a stage 3 reader says while its parent is being filled in, or null when
// there is nothing to wait for. Starts the fill itself when the box is free.
function sealedFillWaiting(doc) {
  const parent = getSet(((doc || {}).parent || {}).id);
  if (!parent) return null;
  const line = (run) => `filling in the sealed window of ${parent.name} from ${((run.behindOf || {}).name) || 'its parent'}: ${run.done} of ${run.total} records`;
  const going = sealedFills.get(parent.id);
  if (going) return line(going);
  const behind = sealedBehind(parent);
  if (!behind || !behind.fillable) return null;
  if (stageBusy()) return null;                  // read on as it is; the fill runs when the box is free
  const run = startSealedFill(parent.id);
  run.behindOf = behind.parent;
  return line(run);
}
const sealedFillPromise = (id) => (sealedFills.has(id) ? sealedFills.get(id).promise : null);

// WHETHER A BOARD-WIDE NOISE READING EXISTS, SAID BY EVERY SET IN THE SAME
// WORDS (RULE NINE). Per-setting deals are stored as beat/pairs/lead, but the
// per-deal MONEY never is — so "what did the best row on the whole board make
// in shuffled world seven" cannot be answered from any set written so far, at
// any null set size. A reader must not have to notice a field is absent and
// infer that: noticing an absence IS asking which era a record is from. So the
// stamp goes on every set, old and new, and the reader only ever reads it.
const BOARD_NULL_NONE = Object.freeze({
  captured: false,
  why: 'no board-wide noise reading was captured when this set was priced',
});

// Pure, so the migration's decision can be tested apart from its write.
function needsBoardNullStamp(doc) {
  return !(doc && doc.boardNull && typeof doc.boardNull === 'object');
}

function noiseTwinOf(doc) {
  const bn = (doc || {}).boardNull;
  if (needsBoardNullStamp(doc)) {
    throw new Error(`${(doc || {}).id || 'this set'} carries no board-wide noise stamp — `
      + 'the set documents have not been brought up to date');
  }
  return { available: !!bn.captured, why: bn.captured ? null : (bn.why || 'not captured') };
}

// Stamps every set that has not got one. Additive, instant, and idempotent —
// it never touches a record and never rewrites a stamp that is already there.
// It refuses while a stage job is going rather than write under a running
// writer, and says so instead of half-finishing.
function stampBoardNullOnEverySet() {
  const busy = stageRunning();
  if (busy) return { stamped: 0, already: 0, refused: `${busy} is running` };
  let stamped = 0;
  let already = 0;
  for (const s of listSets()) {
    let doc;
    try { doc = getSet(s.id); } catch (_) { doc = null; }
    if (!doc) continue;
    if (!needsBoardNullStamp(doc)) { already++; continue; }
    doc.boardNull = { ...BOARD_NULL_NONE };
    saveSet(doc);
    stamped++;
  }
  return { stamped, already, refused: null };
}
// The counter the cost line asks rides the SAME resolution the launch runs —
// same records, same carry cut, same declared bars — so the number on the
// screen and the number that runs can never be two different numbers. When
// no parent is named yet, the block is counted exactly as declared.
// THE COUNT WITHOUT THE SETTINGS (owner order, 2026-09-02: "the count is not
// known right now — HTTP 504 ... we need a longer timeout or other fix").
// Building every setting of a 352,128-setting block and keying each one again
// for the fold took the service eight seconds per ask, on its one thread, and
// every box change asks again -- so a few changes in a row queued past the
// gateway's minute. The block is a plain cross product -- decision x band x
// 24/5 x trade shape x agreement -- and the fold only ever merges settings that
// share everything but their resolved geometry. So the kept count is that
// product with the bands replaced, per group of shapes sharing entry, gate and
// t, by how many distinct geometries the group's shapes resolve to across the
// bands: a few hundred shapes instead of a few hundred thousand settings,
// worked out through the SAME shapeRepsFor the launch's fold reads, and a
// test holds the two equal.
function countDeclared(params, sizes, records) {
  const cells = shapeCellsFor(params);
  const agrees = agreementsFor(params, sizes);
  const { decisions, bands, weekdays } = blockAxesFor(params);
  const declared = decisions.length * bands.length * weekdays.length * cells.length * agrees.length;
  if (!Array.isArray(records) || !records.length) return { declared, kept: declared, folded: 0, perUnit: [], pricings: 0, weekdaysApply: true };
  // THE FOLD'S KEY, LESS WHAT THE PRODUCT CARRIES: decision and agreement are
  // the same on every unit and multiply whatever is left, so the fold is
  // counted on the (band, 24/5, shape) items alone -- in the block's own
  // order, so "the first of its duplicates" is the one the launch keeps.
  const items = [];
  for (const band of bands) {
    for (const wk of weekdays) {
      for (const cell of cells) items.push({ g: `${cell.entry}|${cell.gate}|${cell.tHours}`, wk, shape: { band, dMult: cell.dMult ?? null, trailMult: cell.trailMult ?? null, armMult: cell.armMult ?? null } });
    }
  }
  const keptOnAny = new Uint8Array(items.length);
  const perUnit = [];
  let weekdaysApply = false;
  for (const rec of records) {
    const repOf = shapeRepsFor(items.map((x) => x.shape), [rec]);
    const wkApplies = weekdaysApplyTo(rec);
    if (wkApplies) weekdaysApply = true;
    const seen = new Set();
    let mine = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const key = `${it.g}|${repOf.get(shapeKeyOf(it.shape))}|${wkApplies ? (it.wk ? 1 : 0) : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      keptOnAny[i] = 1;
      mine++;
    }
    perUnit.push(decisions.length * agrees.length * mine);
  }
  let union = 0;
  for (let i = 0; i < items.length; i++) if (keptOnAny[i]) union++;
  const kept = decisions.length * agrees.length * union;
  return { declared, kept, folded: declared - kept, perUnit, pricings: perUnit.reduce((a, b) => a + b, 0), weekdaysApply };
}
function stage3Declared(b) {
  const out = { units: null, coins: null };
  let sizes = null;
  let records = null;
  const parent = getSet(String((b || {}).from || ''));
  if (parent && parent.stage === 2) {
    // the same resolution the launch runs, Selected records included;
    // nothing picked counts as nothing here rather than refusing, so the
    // cost line can say 0 while the launch says why
    const pick = String((b || {}).pick || 'count');
    const carry = Math.max(0, Math.floor(num((b || {}).carry, 0)));
    ({ records } = pick === 'selected' ? stage3UnitsFor(parent, 0, pickedOf(parent)) : stage3UnitsFor(parent, carry));
    if (records.length) {
      sizes = [...new Set(records.map((r) => r.size || (r.ctx1 ? (r.ctx2 ? 3 : 2) : 1)))];
      out.units = records.length;
      out.coins = new Set(records.map((r) => r.trade)).size;
    }
  }
  // the count is of what will actually be PRICED: two settings that place the
  // same orders on every unit are one setting -- counted without building
  // them, through the same shape pass the launch's fold reads
  const counted = countDeclared(b || {}, sizes, records || []);
  out.settings = counted.kept;
  out.declared = counted.declared;
  out.folded = counted.folded;
  // what the units will actually price, unit by unit, and whether any unit
  // being priced has a weekday version at all (24/5 is ghosted when none does)
  out.pricings = counted.pricings;
  out.unitSettings = records ? counted.perUnit.map((held, i) => ({ u: records[i].u, held })) : [];
  out.weekdaysApply = counted.weekdaysApply;
  return out;
}
function startStage3(params) {
  claimOrRefuse();
  const parent = parentOrRefuse(params.from, 2);
  const fee = Number(params.fee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.05) {
    throw new Error('fee % each way must be a real cost between 0 and 5% — it prices every trade and every directional bar here');
  }
  const nullN = Math.max(0, Math.floor(num(params.nullN, 19)));
  // HOW MANY SCRAMBLES THIS RUN WRITES DOWN (FUNNEL-DESIGN.md 4.5). Keeping
  // them is what gives the Funnel a whole second copy of the tables, made of
  // luck, instead of a split-half standing in for one.
  //
  // It REFUSES rather than clamping. A set whose document says it kept ten and
  // whose rows carry four is a set every later reader has to distrust, and the
  // reader that averages over the shorter array will not notice it is short.
  const keepN = Math.max(0, Math.floor(num(params.keepN, 0)));
  if (keepN > nullN) {
    throw new Error(`this asks to keep ${keepN} scrambles from a null set of ${nullN} — `
      + 'there are only as many scrambles to keep as the null set has. Raise the null set size, or lower how many are kept.');
  }
  // carry forward (owner order, 2026-08-27): 0 prices every carried unit; a
  // positive count takes the top of the parent's table. The units come
  // FIRST because the declared block depends on which committee sizes are
  // actually being priced.
  const chosen = stage3RecordsFor(parent, params);
  const { records: parentRecords, savedS2, selected } = chosen;
  const carry = selected ? 0 : chosen.carry;
  if (!parentRecords.length) throw new Error(`${parent.name} holds no records — nothing to price`);
  // The committee sizes actually being priced decide which agreement shares
  // can be told apart: two shares landing on the same rung for every unit in
  // the run are one setting, not two.
  const sizes = [...new Set(parentRecords.map((r) => r.size || (r.ctx1 ? (r.ctx2 ? 3 : 2) : 1)))];
  // THE LAUNCH ANSWERS BEFORE THE SETTINGS ARE BUILT (owner order, 2026-09-02:
  // the press would "go away and do nothing for a minute before crashing
  // without a message"). Building and folding a 350,000-setting block takes
  // seconds on this thread and the browser's gateway gives up at a minute, so
  // the press came back 504 while the run went ahead unseen. The counts are
  // worked out here from the block's shape -- countDeclared, the cost line's
  // own arithmetic, held equal to the fold by test -- and the settings
  // themselves are built in the background under "writing the plan", checked
  // against these counts before anything is priced. A bad block still refuses
  // here: the count expands and validates the same trade shapes.
  const counted = countDeclared(params, sizes, parentRecords);
  if (!counted.kept) throw new Error('the block declared no settings');

  // the budget gate: the whole plan is known here, so a block that cannot
  // fit is refused NOW, with the arithmetic, never discovered mid-total
  const coinsN = new Set(parentRecords.map((r) => r.trade)).size;
  const heapGate = tallyBudgetFor({ settings: counted.kept, coins: coinsN });
  if (heapGate.band === 'refuse') throw new Error(heapGate.message);
  const diskGate = storeBudgetFor({ rows: counted.pricings });
  if (diskGate.band === 'refuse') throw new Error(diskGate.message);

  const setName = nameOrRefuse(params.name, 3);
  const seq = seqFor(3);
  const id = `s3-${Date.now().toString(36)}-${seq}`;
  const doc = {
    id, stage: 3, seq, name: setName,
    createdAt: new Date().toISOString(),
    status: 'running', progress: 'writing the plan',
    desc: String(params.desc || ''),
    engineVersion: ENGINE_VERSION,
    measurements: MEASUREMENTS_VERSION,
    // WHAT THIS RUN KEPT, stamped at launch in the shape every reader already
    // asks. A run that keeps ten and stamps 'none' would fill the columns and
    // still tell the Funnel there is nothing to compare against.
    boardNull: keepN > 0
      ? { captured: true, kept: keepN, why: null }
      : { captured: false, kept: 0, why: 'null set money kept was 0 when this set was priced' },
    // THE GATES ITS RECORDS HOLD -- every one the engine has. A set priced
    // before the always gate was removed carries no stamp, and is migrated the
    // first time it is opened (needsAlwaysStrip).
    gates: bracketLib.GATES.slice(),
    parent: {
      id: parent.id, name: parent.name,
      // which of the parent's records this set priced, in the parent's terms:
      // the ones selected on its table, or the top of it by carry
      ...(selected ? { selected: parentRecords.length, of: allRecords(parent.id).length } : {}),
      ...(!selected && carry > 0 ? {
        carry: parentRecords.length, of: allRecords(parent.id).length,
        sortedBy: savedS2 ? sortLabel(savedS2) : 'forecast score — all members high to low',
      } : {}),
    },
    params: {
      ...parent.params, from: parent.id, fee, nullN, keepN, carry: carry > 0 ? parentRecords.length : 0,
      // the exact records selected, so a rebuild or a relaunch prices these
      // and not whatever is picked on the parent's table later
      selected: selected || null,
      cell: params.cell, cellPermute: params.cellPermute || null,
      agreeRule: params.agreeRule || 'count', agreeBar: params.agreeBar === 'own' ? 'own' : 'all',
      agreePct: Number(params.agreePct) || 50,
      agreeCopy: Number(params.agreeCopy) || agreement.COPY_DEFAULT,
      agreePermuteCopy: !!params.agreePermuteCopy,
      agreeBothModels: !!params.agreeBothModels, agreePersist: Math.max(0, Math.floor(Number(params.agreePersist) || 0)),
      agreePermuteRule: !!params.agreePermuteRule, agreePermuteBar: !!params.agreePermuteBar,
      agreePermutePct: !!params.agreePermutePct,
      agreePermuteBoth: !!params.agreePermuteBoth, agreePermutePersist: !!params.agreePermutePersist,
      decision: params.decision || 'argmax', band: params.band ?? 'auto', weekdaysOnly: !!params.weekdaysOnly,
      permuteDecision: !!params.permuteDecision, permuteBand: !!params.permuteBand, permuteWeekdays: !!params.permuteWeekdays,
      // the campaign in use at THIS launch, not the parent's (same rule as stage 2)
      campaign: require('./campaign').getCampaign() || null,
    },
    seed: seedOf(id),
    recordsVersion: RECORDS_V,
    plan: {
      units: parentRecords.length,
      settings: counted.kept,
      // the names are written the moment the block is built, below; until
      // then the plan carries its counts only
      settingLabels: [],
      // what the block asked for, and what was folded away because it priced
      // the same trade — reported so the difference is never silent
      declaredSettings: counted.declared,
      sameTradeFolded: counted.folded,
      // WHAT EACH UNIT HOLDS (3.52.0): the settings that place different
      // orders on it, and the pricings that comes to over the run
      unitSettings: counted.perUnit.map((held, i) => ({ u: parentRecords[i].u, held })),
      pricings: counted.pricings,
    },
    perf: {
      unitsDone: 0, unitsTotal: parentRecords.length, elapsedMs: 0, etaMs: null, workers: null,
      cyclesDone: 0, cyclesTotal: counted.pricings * (1 + nullN + keepN), cyclesWord: 'pricings',
    },
    failures: [],
    counts: null,
  };
  doc.dataManifest = stampManifest(id, parent.params.universe);
  activeSet = doc;
  saveSet(doc);

  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveSet(doc);
  const t0 = Date.now();
  // Each phase is timed from ITS OWN start, not from the launch: a rate
  // measured across a phase that has finished tells you nothing about the one
  // you are in, and stage 3's three phases go at wildly different speeds.
  const tRead = Date.now();
  let tPrice = null;
  // offThread: stage 3's records are the big one — a unit hands back a row per
  // setting, and squashing them here is what starved the other three lanes.
  const w = { records: rowstore.writer(id, 'records', { offThread: true }) };
  const p = {
    allLoaded: parent.params.allLoaded, startMonth: parent.params.startMonth,
    endMonth: parent.params.endMonth, windowLayout: parent.params.windowLayout,
  };
  (async () => {
    // THE BLOCK ITSELF, built now that the press has been answered: every
    // setting with its name, folded to one per trade (ONE SETTING PER TRADE:
    // anything that prices identically on every unit is paid for once), and
    // held against the counts the launch was gated on. A disagreement stops
    // the run before a single pricing, because the cost line and the launch
    // must be one number.
    doc.progress = 'writing the plan: building the settings';
    saveSet(doc);
    await new Promise((resolve) => { setImmediate(resolve); });
    const declaredSettings = settingsFor(params, sizes);
    const { kept: settings, folded: sameTrade, heldOn } = foldSameTradeSettings(declaredSettings, parentRecords);
    if (settings.length !== counted.kept || declaredSettings.length !== counted.declared) {
      throw new Error(`the count said ${counted.kept.toLocaleString()} settings (${counted.declared.toLocaleString()} declared) and the block `
        + `built ${settings.length.toLocaleString()} (${declaredSettings.length.toLocaleString()} declared) — the cost line and the launch disagree, so nothing was priced`);
    }
    for (let u = 0; u < parentRecords.length; u++) {
      if (heldOn[u].length !== counted.perUnit[u]) {
        throw new Error(`the count said unit ${parentRecords[u].trade} ${parentRecords[u].geometry} would price ${counted.perUnit[u].toLocaleString()} settings and the `
          + `block folded to ${heldOn[u].length.toLocaleString()} — the cost line and the launch disagree, so nothing was priced`);
      }
    }
    Object.assign(doc.plan, {
      settingLabels: settings.map((s) => s.label),
      declaredSettings: declaredSettings.length,
      sameTradeFolded: sameTrade.length,
    });
    saveSet(doc);
    // Reading every unit's kept votes back out of the store takes real time
    // on a big set, and a screen that says "writing the plan" through all of
    // it reads as stuck (owner, 2026-08-27). Say what is actually happening,
    // as it happens.
    // THE WORK IS HANDED OUT IN PARTS, NOT UNITS (owner order, 2026-09-02:
    // "we're running 1.75M settings with 36.7M pricings and we're getting
    // about 1 cpu worth of effort and no status updates"). One payload per
    // unit kept one worker busy on a one-unit run and three idle, and said
    // nothing until the unit landed. Each unit's settings are cut into enough
    // parts to feed every worker several times over, each part numbered from
    // its place in the block so its records file under the same setting
    // numbers they always did, and the line moves as parts land.
    const workersN = pool.parallel ? pool.workers.length : 1;
    const parts = [];                     // { u: index into parentRecords, from, to } -- into the unit's OWN list
    const partsOf = [];                   // how many parts each unit was cut into
    const payloads = [];
    const agreedMap = {};
    for (let pi = 0; pi < parentRecords.length; pi++) {
      const rec = parentRecords[pi];
      // THE UNIT'S OWN LIST (3.52.0): the settings that place different orders
      // on it, each carrying its place in the block so its records file there
      const mine = heldOn[pi].map((i) => ({ ...settings[i], si: i }));
      const partsPerUnit = Math.max(1, Math.min(mine.length, workersN * 4));
      const partSize = Math.max(1, Math.ceil(mine.length / partsPerUnit));
      const whole = s3Payload({ doc, parent, rec, settings: mine, fee, nullN });     // the votes are read once per unit
      let n = 0;
      for (let from = 0; from < mine.length; from += partSize) {
        const to = Math.min(mine.length, from + partSize);
        payloads.push({ ...whole, settings: mine.slice(from, to) });
        parts.push({ u: pi, from, to });
        n++;
      }
      partsOf.push(n);
      if (pi % 5 === 4 || pi === parentRecords.length - 1) {
        phaseNote(doc, { phase: 'reading the kept votes', done: pi + 1, total: parentRecords.length, word: 'units', startedMs: tRead });
        saveSet(doc);
      }
    }
    // the pricing clock starts when the pricing does, and the screen is told
    // at once that this phase has begun with nothing finished yet — otherwise
    // the previous phase's line sits there looking like the current one
    tPrice = Date.now();
    doc.perf.partsTotal = parts.length;
    doc.perf.partsDone = 0;
    phaseNote(doc, { phase: 'pricing the settings', done: 0, total: parts.length, word: 'parts', startedMs: tPrice,
      extra: `0 of ${parentRecords.length} units` });
    saveSet(doc);
    const landed = new Array(parentRecords.length).fill(0);
    const failedUnits = new Set();
    let pricedSettings = 0;
    await pool.forEach('s3Unit', payloads, (settled, i) => {
      if (doc.cancelRequested) return;
      const part = parts[i];
      const rec = parentRecords[part.u];
      if (settled.ok && settled.value) {
        for (const row of settled.value.rows) {
          // storedRecordOf, not a spread: the pricing hands back everything it
          // worked out, and exactly one place decides what reaches disk
          // (ruling 4 — stage 3 does not grow). A spread here would put the
          // analysis block on 5.2 million records.
          w.records.push({
            ...require('./stagework').storedRecordOf(row),
            u: rec.u, trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size, geometry: rec.geometry,
          });
        }
        // the unit's realised agreements, already worked out on the same walk
        // the pricing used — kept beside the set, never on 329,280 records
        for (const [k, v] of Object.entries(settled.value.agreed || {})) agreedMap[`${rec.u}|${k}`] = v;
        w.records.flush();
        pricedSettings += part.to - part.from;
      } else if (!settled.ok && !failedUnits.has(part.u)) {
        // one failure per unit, whichever of its parts failed first: the set is
        // short that unit, and the count of failures is the count of units
        failedUnits.add(part.u);
        doc.failures.push({ unit: `${rec.trade}|${rec.geometry}`, error: String(settled.error || 'failed') });
      }
      landed[part.u]++;
      if (landed[part.u] === partsOf[part.u]) doc.perf.unitsDone++;
      doc.perf.partsDone++;
      doc.perf.elapsedMs = Date.now() - t0;
      doc.perf.etaMs = doc.perf.partsDone ? Math.round(((Date.now() - tPrice) / doc.perf.partsDone) * (parts.length - doc.perf.partsDone)) : null;
      // the SAME per-setting count cyclesTotal was built from, or a run that
      // keeps scrambles reports a progress bar that never reaches its end
      doc.perf.cyclesDone = pricedSettings * (1 + nullN + keepN);
      phaseNote(doc, {
        phase: 'pricing the settings', done: doc.perf.partsDone, total: parts.length, word: 'parts', startedMs: tPrice,
        extra: `${doc.perf.unitsDone} of ${parentRecords.length} units · ${doc.perf.cyclesDone.toLocaleString()} of ${doc.perf.cyclesTotal.toLocaleString()} pricings`,
      });
      saveSet(doc);
    });
    if (doc.cancelRequested) { finishFail(doc, null, pool); return; }
    await w.records.close();
    const okN = parentRecords.length - doc.failures.length;
    doc.counts = { unitsScored: okN, settings: settings.length, rows: rowstore.count(id, 'records'), failures: doc.failures.length };
    doc.status = okN === parentRecords.length ? 'done' : 'incomplete';
    doc.progress = doc.status === 'incomplete' ? `finished with ${doc.failures.length} unit(s) missing — the set does not match its own plan` : 'totalling the tables';
    saveSet(doc);
    const tallyGate = tallyBudgetFor({ settings: settings.length, coins: coinsN });
    let lastTallySave = 0;
    const tTally = Date.now();
    const tallyNote = (dn, tn) => {
      phaseNote(doc, { phase: 'totalling the tables', done: dn, total: tn, word: 'parts', startedMs: tTally });
      const now = Date.now();
      if (now - lastTallySave > 1000 || dn === tn) { lastTallySave = now; saveSet(doc); }
    };
    // what the members actually did, written before the tables are totalled
    // because the totalling is what joins it onto every record
    try { writeAgreed(doc.id, agreedMap); } catch (err) { doc.tallyError = `the agreements could not be saved: ${err.message}`; }
    if (tallyGate.band === 'refuse') doc.tallyError = tallyGate.message;
    else { try { await buildTally(doc, pool, tallyNote); } catch (err) { doc.tallyError = String(err.message || err); } }
    doc.progress = doc.status === 'incomplete' ? doc.progress : '';
    doc.finishedAt = new Date().toISOString();
    saveSet(doc);
    if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
    pool.abort();
  })().catch((err) => finishFail(doc, err, pool));
  // the count the gates read and the plan was written with — the built
  // block lives in the background part and is held equal to this count there
  return { id, name: doc.name, units: parentRecords.length, settings: counted.kept };
}

// ---- stage 3 tables -------------------------------------------------------------
// One streaming pass over the records builds both readings and remembers,
// per coin row, which blocks its records sit in — the same shape the Boards
// every-coin tally uses today.
const zlib = require('zlib');
const tallyFile = (id) => path.join(SETS_DIR, `${String(id).replace(/[^A-Za-z0-9._-]+/g, '_')}-tally.json.gz`);
// A BLOCK OF 177,408 SETTINGS KILLED THE FIRST TOTALLING (OOM, 2026-08-27):
// every lane's accumulator carries EVERY setting the store holds, so
// sharding a huge block duplicates a huge accumulator per lane in flight.
// Sharding stays for blocks around the design scale (the drawing's own
// worked example is 2,772 settings); above this bound the totalling runs
// inline — one accumulator, one streaming pass — which is what fits.
const SHARD_SETTINGS_LIMIT = 5000;

// ---- THE BUDGET GATE (owner order, 2026-08-27: "detect ... warn, flag,
// stop, give meaningful messages ... if they select too large of a dataset").
// Every stage job is plan-first, so the numbers that decide memory and disk
// are all known BEFORE anything runs — the gate does the arithmetic then and
// says it in the cost line, in the refusal, and on the set.
//
// The memory model is CALIBRATED, not guessed: the 177,408-setting × 17-coin
// block that killed the old totalling fits under the reshaped one at about
// 1.2 GB, which reads back as ~400 bytes per setting-and-coin atom with all
// object overhead in, plus a per-setting base. tests/test-stages.js holds
// the disk figure against a real store the same way.
const TALLY_ATOM_BYTES = 400;        // one setting × one coin, object overhead in
const TALLY_SETTING_BASE_BYTES = 760; // one ranked entry's own fields, incl. ten kept scrambles
const S3_RECORD_DISK_BYTES = 500;     // one stage 3 record row on disk, gz block share in
const HEAP_REFUSE_SHARE = 0.8;        // above this share of the ceiling: refuse
const HEAP_WARN_SHARE = 0.45;         // above this share: run, but say it is tight
const DISK_REFUSE_SHARE = 0.8;        // of the free disk, for the records store

const gbWords = (bytes) => (bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1048576))} MB`);

function tallyBudgetFor({ settings, coins, heapLimitBytes = null }) {
  let heap = heapLimitBytes;
  if (heap == null) {
    const r = require('./estimate').boxResources();
    heap = (r.heapCeilingMb || 1792) * 1048576;
  }
  const per = TALLY_SETTING_BASE_BYTES + Math.max(1, coins) * TALLY_ATOM_BYTES;
  const bytes = Math.round(settings * per);
  const share = bytes / heap;
  const band = share > HEAP_REFUSE_SHARE ? 'refuse' : (share > HEAP_WARN_SHARE ? 'tight' : 'fits');
  // THE REFUSAL SAYS WHICH DIALS MOVE IT, AND BY HOW MUCH (owner, 2026-08-29:
  // "half as many nulls shouldn't take just as much space").
  //
  // They were right that the number did not move and wrong about why, and the
  // message was what misled them. It named three things to shrink and left the
  // null set size looking like a fourth — reasonably, since the pricings figure
  // on the same line reacts to it. It does not belong there: the finished
  // tables are one entry per setting and one cell per setting-and-coin, and
  // every null-set deal is folded into a running count as it is priced and
  // never kept. So the size is settings × coins and nothing else, and the
  // message now says that instead of leaving it to be guessed.
  //
  // It also says how far over the bar the block is. "Shrink it" without a
  // number is an invitation to guess repeatedly at a screen that takes a moment
  // to answer each time.
  const fits = Math.floor((heap * HEAP_REFUSE_SHARE) / per);
  const message = band === 'fits' ? null
    : band === 'tight'
      ? `these tables will need about ${gbWords(bytes)} of the ${gbWords(heap)} the service has — it will run, but it is tight`
      : `these tables would need about ${gbWords(bytes)} and the service has ${gbWords(heap)} in all — anything above `
        + `${gbWords(Math.round(heap * HEAP_REFUSE_SHARE))} refuses rather than dying mid-total. The size is settings × coins `
        + 'and nothing else — the null set size does not change it, because each deal is counted as it is priced and never '
        + `kept. On ${Math.max(1, coins)} coin(s), ${fits.toLocaleString()} settings fit; this block declares `
        + `${settings.toLocaleString()}. Shrink it with fewer settings, a smaller carry forward, or fewer coins.`;
  return { bytes, heapBytes: heap, share, band, message, fits };
}

function storeBudgetFor({ rows, freeBytes = null }) {
  let free = freeBytes;
  if (free == null) {
    const r = require('./estimate').boxResources();
    free = r.diskFreeBytes == null ? null : r.diskFreeBytes;
  }
  const bytes = Math.round(rows * S3_RECORD_DISK_BYTES);
  if (free == null) return { bytes, freeBytes: null, band: 'fits', message: null };
  const share = bytes / free;
  const band = share > DISK_REFUSE_SHARE ? 'refuse' : (share > HEAP_WARN_SHARE ? 'tight' : 'fits');
  const message = band === 'fits' ? null
    : band === 'tight'
      ? `the records will take about ${gbWords(bytes)} of the ${gbWords(free)} free on disk`
      : `the records would take about ${gbWords(bytes)} and only ${gbWords(free)} is free on disk — the launch refuses `
        + 'rather than filling the machine. Shrink the block, or clear old record sets first.';
  return { bytes, freeBytes: free, band, share, message };
}
// The tally's shape number. Bumped when the tables gain a column the fold
// must supply (v2: avg test $ on the coins table, owner order 2026-08-27) —
// an older tally then READS AS ABSENT, so the durable rebuild re-totals it
// from the kept records with the new column, progress on screen, instead of
// serving dashes forever where the number belongs.
// 5, and the shape changed with it: ONE JSON OBJECT PER LINE rather than one
// object for the whole file.
//
// A 524,832-setting tally inflates to 553,814,407 bytes. V8 will not make a
// string longer than 536,870,888, so `.toString()` on the whole of it threw —
// and the catch around it turned "this cannot be read" into "there is no
// tally", which is the one answer that makes the caller build another. Twenty
// minutes a time, producing a file exactly as unreadable, for ever, with the
// reason thrown away (2026-08-30). The owner's tables were never going to
// appear and nothing on the screen could have said why.
//
// Line by line, no single string is ever longer than one entry, and the size
// of the whole stops mattering. Derived, so the old one is not migrated: it
// reads as an older shape and is rebuilt (RULE NINE).
const TALLY_V = 6;

// ---- WHAT THE MEMBERS ACTUALLY DID -------------------------------------------
//
// Owner order, 2026-08-29: "you need to pass through those 329k records and
// record the actual share % agreement FOR EACH ROW. then you get rid of that
// current SHARE column which lists the same 75% 300k times".
//
// They were right, and they were right that it can be done for a set already
// priced. The realised agreement depends on the unit and on the way of asking
// and on nothing about the trade shape, so a run of 329,280 settings over ten
// units holds 600 distinct answers, not 3.3 million. They are kept beside the
// set and joined onto every record as the tables are totalled.
//
// A set priced before this existed gets them by rebuilding the same units from
// its stage 2 parent's kept votes and walking the same streams. Nothing is
// re-priced and no record is rewritten.
// ---- THE RECORD SHAPE ----------------------------------------------------------
//
// RULE NINE: "when processes change, fix existing records to match the current
// schema". Every set on disk is at this shape, so there is nothing here that
// knows about an older one — the code that moved them was one-off and went out
// with the job (owner order, 2026-08-30).
//
// The stamp stays. It is one line at a launch, and it is what lets the NEXT
// shape change be written as a migration rather than as archaeology over which
// era a set came from.
const RECORDS_V = 3;

// ---- ONE-OFF: the setting names gained the one-voice share ----------------
//
// Owner order, 2026-08-30: "rename the voices first".
//
// Putting the one-voice share on screen also put it into the NAME of every
// setting that weighs by `voices`: what was written `voices 75%` is written
// `voices 75% +voice98` now. NOTHING UNDERNEATH CHANGED — a record with no
// share stored on it already resolves to 98, which is the number that was in
// the code — so this is a rename and only a rename.
//
// But the name is what a block's declared list is matched against. Until it is
// done the set reads as holding 65,856 settings its own block does not declare,
// and filling in the missing ones would price every one of them a SECOND time
// under the new name.
//
// RULE NINE: the records move with the process, so no reader anywhere has to
// ask which era a name came from. This goes out with the job once every set on
// the box is at v3.
function renamedLabelOf(r) {
  const agr = require('./stagework').agrOf(r);
  const parts = String(r.label || '').split(' · ');
  const head = `${agreeLabel({
    rule: agr.rule, pct: agr.pct, bar: agr.bar, copy: agr.copy, bothModels: agr.both, persist: agr.persist,
  })} ${shapeLabel(r)}`;
  return head === parts[0] ? null : [head, ...parts.slice(1)].join(' · ');
}
// HOW MANY ARE BEHIND, off the set's OWN list of names rather than a walk over
// three million records — this is asked every time the screen draws.
//
// The test is a string one, and that is safe here for one reason: agreeLabel
// puts +voiceN straight after the share, for the voices way of weighing and
// for nothing else. A test holds those two together. The MIGRATION itself
// never reads a name — it rebuilds each one from the record's own fields.
const BEHIND_V3 = (label) => /^voices \d+%/.test(label) && !/ \+voice\d+/.test(label);
function settingsBehind(doc) {
  const held = ((doc || {}).plan || {}).settingLabels || [];
  let n = 0;
  for (const L of held) if (BEHIND_V3(L)) n++;
  return n;
}
// ---- IS THIS SET SOUND? ---------------------------------------------------
//
// Owner, 2026-08-30: "with all the screw ups i have little confidence in the
// state of the data. how do i know you haven't made a bunch more issues?"
//
// That cannot be answered with a reassurance, and it cannot be answered by a
// check written to agree with the code that did the work. So every check here
// is against what a sound set IS, not against what any pass happens to do.
//
// The load-bearing one is the fourth: it rebuilds every name from the fields
// on the record itself, through the same two writers a launch writes with and
// the same one line that joins them. A name today's code would not write fails
// — whoever wrote it, whenever, and whether or not anybody remembered it had
// been touched. Nothing about which passes have run is consulted anywhere.
//
// It walks the records once and holds three small arrays, so it costs a read
// of the store and a few megabytes, not a second copy of it.
function auditRecordSet(doc) {
  const out = [];
  const say = (name, ok, detail) => { out.push({ name, ok, detail }); return ok; };
  const id = doc.id;
  const held = ((doc.plan || {}).settingLabels) || [];
  const units = Number(((doc.plan || {}).units)) || 0;
  if (!held.length || !units) {
    say('the set records what it holds', false, 'it does not say how many settings or units it has, so nothing here can be checked');
    return { ok: false, checks: out };
  }

  // WHAT EACH UNIT HOLDS (3.52.0): a unit prices only the settings that place
  // different orders on it, so "one record per unit" is per unit that holds
  // it. The set says HOW MANY each holds, and that is checked against the
  // records themselves; the block rebuilt today says WHICH, and that is
  // checked too whenever the stage 2 parent is still on the box to rebuild
  // it from -- and said to be unchecked, never skipped silently, when it is not.
  const unitSettings = (doc.plan || {}).unitSettings;
  if (!Array.isArray(unitSettings)) {
    say('the set records what each unit holds', false, doc.status === 'done' || doc.status === 'incomplete'
      ? 'it does not say how many settings each unit holds — open it on Boards and its records are folded per unit first'
      : 'it does not say how many settings each unit holds, and a set that did not finish is not folded per unit');
    return { ok: false, checks: out };
  }
  const saidHeld = new Map(unitSettings.map((x) => [Number(x.u), Number(x.held) || 0]));
  const expectedRows = [...saidHeld.values()].reduce((a, b) => a + b, 0);
  let heldOn = null;
  let recordsOf = null;
  let blockSettings = null;
  let noBlock = null;
  try { ({ heldOn, records: recordsOf, settings: blockSettings } = relaunchShapeOf(doc)); } catch (err) { noBlock = String(err.message || err); }
  // the set's places are matched to the block's by NAME (a filled-in set
  // holds the block's names in another order), and a set whose names are not
  // the block's cannot have its holdings checked against it
  const holders = new Int32Array(held.length);          // how many units hold each setting, by the block
  const holderBits = new Int32Array(held.length);       // and which, as bits
  if (heldOn) {
    const blockAt = new Map(blockSettings.map((st) => [st.label, st.si]));
    const placeOf = new Map();                          // block place -> place in the set
    held.forEach((L, p) => { if (blockAt.has(L)) placeOf.set(blockAt.get(L), p); });
    if (blockSettings.length !== held.length || placeOf.size !== held.length) {
      noBlock = `the block rebuilt today holds ${blockSettings.length.toLocaleString()} settings and this set ${held.length.toLocaleString()}, not all under the same names`;
      heldOn = null;
    } else {
      heldOn.forEach((list, i) => { const u = recordsOf[i].u; for (const k of list) { const p = placeOf.get(k); holders[p]++; if (u < 31) holderBits[p] |= (1 << u); } });
    }
  }
  const rows = rowstore.count(id, 'records');
  say('the records add up to what the units say they hold', rows === expectedRows,
    `${rows.toLocaleString()} records for ${held.length.toLocaleString()} settings over ${units} units `
    + `(${expectedRows.toLocaleString()} expected)`);

  // no two settings may share a name, or one hides the other everywhere
  const names = new Set(held);
  say('no two settings share a name', names.size === held.length,
    `${held.length.toLocaleString()} names, ${names.size.toLocaleString()} of them different`);

  const seenUnits = new Int32Array(held.length);        // which units, as bits
  const perSetting = new Int32Array(held.length);       // and how many records
  const perUnit = new Map();                            // records counted per unit
  const checked = new Uint8Array(held.length);          // name rebuilt once each
  const tooManyUnits = units > 30;                      // more than fits in the bits
  let twice = 0;                                        // a unit holding one setting twice
  let misplaced = 0;
  let beyond = 0;
  let misnamed = 0;
  const examples = { misplaced: [], beyond: [], misnamed: [] };
  const note = (k, v) => { if (examples[k].length < 3) examples[k].push(v); };
  // Counted by SHAPE, not by record: there are a handful of distinct field
  // lists among millions of rows, so this holds a handful of entries.
  const columns = new Set();
  const shapeSeen = new Map();

  const blocks = rowstore.blocksOf(id, 'records') || [];
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(id, 'records', [b]) || []) {
      const r = x.row || x;
      if (!(r.si >= 0 && r.si < held.length)) {
        beyond++;
        note('beyond', `position ${r.si} is outside the ${held.length.toLocaleString()} settings this set says it holds`);
        continue;
      }
      perSetting[r.si]++;
      perUnit.set(r.u, (perUnit.get(r.u) || 0) + 1);
      if (!tooManyUnits) {
        if (seenUnits[r.si] & (1 << r.u)) twice++;
        seenUnits[r.si] |= (1 << r.u);
      }
      if (held[r.si] !== r.label) {
        misplaced++;
        note('misplaced', `position ${r.si} carries "${r.label}" and the list says "${held[r.si]}"`);
      }
      // EVERY FIELD ANY RECORD CARRIES, ON ALL OF THEM. Measured against the
      // UNION rather than against whichever record came first: the store writes
      // its column list from the first row of a run and grows it when a wider
      // row arrives, so rows written before the growth read back short. Against
      // the first record this reported five million rows wrong when twelve
      // were — the fault named the right way round matters.
      const keys = Object.keys(r);
      for (const k of keys) if (!columns.has(k)) columns.add(k);
      const shape = keys.join(',');
      shapeSeen.set(shape, (shapeSeen.get(shape) || 0) + 1);
      if (checked[r.si]) continue;
      checked[r.si] = 1;
      const agr = require('./stagework').agrOf(r);
      const should = `${agreeLabel({
        rule: agr.rule, pct: agr.pct, bar: agr.bar, copy: agr.copy, bothModels: agr.both, persist: agr.persist,
      })} ${shapeLabel(r)} \u00b7 ${r.decision} ${r.bandMode === 'auto' ? 'auto' : `${r.bandMode}%`} ${r.weekdaysOnly ? '24/5' : '24/7'}`;
      if (should !== r.label) {
        misnamed++;
        note('misnamed', `on disk "${r.label}" — today it would be written "${should}"`);
      }
    }
  }

  say('every record sits at its own setting\u2019s place', misplaced === 0,
    misplaced ? `${misplaced.toLocaleString()} do not: ${examples.misplaced.join('; ')}` : 'all of them do');
  say('no record sits past the end of the list', beyond === 0,
    beyond ? `${beyond.toLocaleString()} do: ${examples.beyond.join('; ')}` : 'none does');
  say('every name is the one today\u2019s code would write', misnamed === 0,
    misnamed ? `${misnamed.toLocaleString()} settings are not: ${examples.misnamed.join('; ')}` : 'all of them are');
  const shortBy = new Map();
  for (const [shape, n] of shapeSeen) {
    const have = new Set(shape.split(','));
    for (const k of columns) if (!have.has(k)) shortBy.set(k, (shortBy.get(k) || 0) + n);
  }
  const short = [...shortBy].sort((a, b) => b[1] - a[1]);
  say('every record carries every field any record carries', short.length === 0,
    short.length
      ? short.map(([k, n]) => `${n.toLocaleString()} records do not carry ${k}`).join('; ')
      : `all of them carry the same ${columns.size}`);

  let empty = 0;
  let wrongUnits = 0;
  for (let i = 0; i < held.length; i++) {
    if (perSetting[i] === 0) { empty++; continue; }
    if (heldOn && (perSetting[i] !== holders[i] || (!tooManyUnits && seenUnits[i] !== holderBits[i]))) wrongUnits++;
  }
  say('every setting has a record', empty === 0,
    empty ? `${empty.toLocaleString()} settings have none` : 'all of them do');
  // each unit holds as many records as the set says it does -- counted from
  // the records that sit inside the list, so a record past its end is not one
  const unitShort = [];
  for (const [u, n] of saidHeld) if ((perUnit.get(u) || 0) !== n) unitShort.push(`unit ${u} holds ${(perUnit.get(u) || 0).toLocaleString()} and the set says ${n.toLocaleString()}`);
  for (const u of perUnit.keys()) if (!saidHeld.has(u)) unitShort.push(`unit ${u} holds ${perUnit.get(u).toLocaleString()} and the set does not name it`);
  say('every unit holds the records it says it does', unitShort.length === 0,
    unitShort.length ? unitShort.slice(0, 3).join('; ') : 'all of them do');
  if (tooManyUnits) {
    say('no unit holds a setting twice', true, `not checked \u2014 ${units} units is more than this check can hold in one number`);
  } else {
    say('no unit holds a setting twice', twice === 0,
      twice ? `${twice.toLocaleString()} records repeat a setting a unit already holds` : 'none does');
  }
  // and WHICH settings each unit holds, against the block rebuilt today
  if (noBlock) {
    say('every unit holds exactly the settings that place different orders on it', true, `not checked \u2014 ${noBlock}`);
  } else if (tooManyUnits) {
    say('every unit holds exactly the settings that place different orders on it', true, `not checked \u2014 ${units} units is more than this check can hold in one number`);
  } else {
    say('every unit holds exactly the settings that place different orders on it', wrongUnits === 0,
      wrongUnits ? `${wrongUnits.toLocaleString()} settings are not held by exactly the units that price them differently` : 'all of them do');
  }

  return { ok: out.every((c) => c.ok), checks: out, rows, settings: held.length, units, pricings: expectedRows };
}
// AND THE ONE CHECK THAT NEEDS THE BLOCK ITSELF: does the set hold exactly
// what a launch with these same choices would price today, no more and no
// less? Separate because it costs the enumeration, which is seventeen seconds.
function auditAgainstBlock(doc) {
  const held = ((doc.plan || {}).settingLabels) || [];
  const declared = declaredLabelsFor(doc);
  const surplus = undeclaredIn(held, declared).size;
  const missing = undeclaredIn(declared, held).size;
  return {
    held: held.length,
    declared: declared.length,
    surplus,
    missing,
    ok: surplus === 0 && missing === 0,
  };
}

// ---- AN APPEND THAT DID NOT FINISH ----------------------------------------
//
// Owner order, 2026-08-30: "look at the state of the data and do it right this
// time and give me the buttons i need to fix the data.
//
// Filling in writes its rows UNIT BY UNIT into the real store, and writes the
// set's list of names once, at the very end. A service that dies part-way — and
// one died of memory this morning — therefore leaves records sitting at
// positions the list does not reach, with nothing written down to say so.
//
// Nothing had to be kept for this to be found: a finished set holds exactly one
// record per name per unit, so a row count that is not names × units says an
// append is unfinished. That check is free — the count is in the sidecar — so
// the screen can ask it on every draw, and only the REPAIR pays for a walk.
function unfinishedAppend(doc) {
  const held = ((doc || {}).plan || {}).settingLabels || [];
  const units = Number(((doc || {}).plan || {}).units) || 0;
  if (!held.length || !units) return null;
  const whole = pricingsOf(doc);
  if (whole == null) return null;                   // behind on the per-unit fold: judged once that has run
  const rows = rowstore.count(doc.id, 'records');
  if (rows === whole) return null;
  return { rows, whole, extra: rows - whole, held: held.length, units };
}
// AND WHAT EXACTLY IS OUT THERE, which does cost a walk: how far the records
// reach past the list, how many settings that is, and — the one that decides
// what can be done about it — which units got that far. An append prices one
// unit at a time and each finished unit is whole, so the ones that landed are
// worth keeping and the ones that did not are the work that is left.
function unfinishedAppendDetail(doc) {
  const held = ((doc.plan || {}).settingLabels || []).length;
  const blocks = rowstore.blocksOf(doc.id, 'records') || [];
  const perUnit = new Map();
  let reach = held;
  let extra = 0;
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(doc.id, 'records', [b]) || []) {
      const r = x.row || x;
      if (r.si < held) continue;
      extra++;
      if (r.si + 1 > reach) reach = r.si + 1;
      perUnit.set(r.u, (perUnit.get(r.u) || 0) + 1);
    }
  }
  const settings = reach - held;
  // a unit is WHOLE only if it carries one record for every new setting IT
  // HOLDS (3.52.0): read off the block when the stage 2 parent is on the box
  // to rebuild it from, else every new setting is taken to be one it holds
  const expect = new Map();
  try {
    const shape = relaunchShapeOf(doc);
    const heldNames = new Set((doc.plan || {}).settingLabels || []);
    shape.records.forEach((rec, i) => expect.set(rec.u, shape.heldOn[i].filter((k) => !heldNames.has(shape.settings[k].label)).length));
  } catch (_) { /* judged by the count alone */ }
  const whole = [];
  const part = [];
  for (const [u, n] of [...perUnit].sort((a, b) => a[0] - b[0])) (n === (expect.has(u) ? expect.get(u) : settings) ? whole : part).push({ u, rows: n });
  return { held, reach, settings, extra, unitsWhole: whole, unitsPart: part };
}
// UNDO IT. Everything at a position past the end of the list goes, and the set
// is exactly what it was before the append started. Beside, verified, then
// swapped, like every other pass that touches these records.
//
// THE OTHER CHOICE IS TO FINISH IT, and that is not offered as a repair here
// because a half-covered setting is worse than a missing one: it would be
// averaged over the units that landed and read like every other row while
// resting on fewer. Pressing fill in again after this prices the whole thing
// once, which is slow and right.
async function undoUnfinishedAppend(doc, note = null) {
  const id = doc.id;
  const busy = stageBusy();
  if (busy) throw new Error(`${busy} is going — one heavy job at a time`);
  const gap = unfinishedAppend(doc);
  if (!gap) return { already: true };
  if (gap.extra < 0) {
    throw new Error(`this set holds ${gap.rows.toLocaleString()} records where ${gap.held.toLocaleString()} settings `
      + `over ${gap.units} units would be ${gap.whole.toLocaleString()} — there are FEWER, not more, so this is not an `
      + 'unfinished append and nothing here can repair it');
  }
  const held = (doc.plan || {}).settingLabels || [];
  const blocks = rowstore.blocksOf(id, 'records') || [];
  const SPARE = 'records-undoing';
  for (const f of [rowstore.storeFile(id, SPARE), `${rowstore.storeFile(id, SPARE)}.meta.json`,
    rowstore.gzFile(id, SPARE), `${rowstore.gzFile(id, SPARE)}.meta.json`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
  }
  const w = rowstore.writer(id, SPARE, { offThread: true });
  let gone = 0;
  if (note) note(0, blocks.length);
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(id, 'records', [b]) || []) {
      const r = x.row || x;
      if (r.si >= held.length) { gone++; continue; }
      // the same check the drop makes: a record sits at its own name
      if (held[r.si] !== r.label) {
        throw new Error(`a record at position ${r.si} carries "${r.label}" and the list says "${held[r.si]}" `
          + '— nothing was changed');
      }
      w.push(r);
    }
    // DRAIN, NOT FLUSH. flush only QUEUES a block for compression; the queue
    // is drained by close, at the very end. This loop never awaits, so every
    // block of a five-million-record store sat in memory at once and the
    // service reached 1.9 GB of its 1.8 GB ceiling on a store it had already
    // died on once today. Draining every so often costs nothing and holds the
    // memory flat — and it yields, so the service can answer while it works.
    if ((b + 1) % 40 === 0) await w.drain(); else w.flush();
    if (note) note(b + 1, blocks.length);
  }
  await w.close();

  const left = rowstore.count(id, SPARE);
  if (left !== gap.whole) {
    throw new Error(`undoing would leave ${left.toLocaleString()} records where ${gap.held.toLocaleString()} settings `
      + `over ${gap.units} units is ${gap.whole.toLocaleString()} — nothing was replaced`);
  }
  const from = rowstore.storeFile(id, SPARE);
  const to = rowstore.storeFile(id, 'records');
  fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);
  fs.renameSync(from, to);
  doc.counts = { ...(doc.counts || {}), rows: left };
  saveSet(doc);
  try { fs.rmSync(tallyFile(id), { force: true }); } catch (_) { /* nothing there */ }
  try { fs.rmSync(agreedFile(id), { force: true }); } catch (_) { /* nothing there */ }
  return { rows: gone, left };
}

// ---- DROPPING THE SETTINGS THE BLOCK NO LONGER DECLARES -------------------
//
// Owner order, 2026-08-30: "drop the 1,008 market duplicates GO NOW!", under
// the standing goal that the set carry no duplicate records at the end.
//
// A `market` setting opens at the candle's open with no price levels at all, so
// the band cannot change one cent of it. The enumerator knows that and folds
// the three fixed-band twins onto the auto one; the owner's set holds all four
// because it was priced before the fold knew. They are duplicates by
// construction, not by coincidence.
//
// THIS DELETES PRICED RECORDS, so every way it could delete the WRONG thing is
// a refusal rather than a judgement:
//
//   * a name that is merely BEHIND also reads as one the block does not
//     declare. Dropping before renaming would delete 65,856 settings that are
//     only badly named. So it refuses while anything is behind.
//   * a record is filed under its setting's POSITION in the set's list of
//     names, and dropping from the middle means renumbering the rest. If any
//     record's position does not already point at its own name, that
//     assumption is wrong and renumbering would scramble the set — so every
//     record is checked against it before anything is written.
//   * and the copy is written beside and counted before the original is
//     touched, exactly as the rename is.
// WHICH HELD NAMES THE BLOCK DOES NOT DECLARE. Split out from the surgery
// below on purpose: deciding WHAT goes and DOING it are two different risks,
// and the destructive half can then be exercised on its own against a doomed
// set somebody wrote down, rather than only against whatever the enumerator
// happens to say on the day.
// THE ONE SET DIFFERENCE, and the argument order is the whole trap: this is
// the names in the FIRST list that are not in the SECOND. Read both ways round
// by design — (held, declared) is what the set holds and the block does not
// declare; (declared, held) is what it declares and the set does not hold.
const undeclaredIn = (first, second) => {
  const have = new Set(second);
  const out = new Set();
  for (const L of first) if (!have.has(L)) out.add(L);
  return out;
};
async function dropUndeclaredSettings(doc, note = null) {
  const held = (doc.plan || {}).settingLabels || [];
  if (!held.length) throw new Error(`${doc.name} does not record which settings it holds, so nothing can be dropped from it safely`);
  // labels only, so this reads the list that every draw has already paid for
  const doomed = undeclaredIn(held, declaredLabelsFor(doc));
  return dropSettingsNamed(doc, doomed, note);
}
async function dropSettingsNamed(doc, doomed, note = null, why = null, { inTallySlot = false } = {}) {
  const id = doc.id;
  // inside the totalling's own slot the slot IS the exclusivity, and asking
  // stageBusy would refuse the very job that holds it
  const busy = inTallySlot ? null : stageBusy();
  if (busy) throw new Error(`${busy} is going — one heavy job at a time`);
  const behind = settingsBehind(doc);
  if (behind) {
    throw new Error(`${behind.toLocaleString()} of this set's settings are named in the older way — bring the setting `
      + 'names up to date first, or dropping now would delete every one of them');
  }
  const held = (doc.plan || {}).settingLabels || [];
  if (!held.length) throw new Error(`${doc.name} does not record which settings it holds, so nothing can be dropped from it safely`);
  if (!doomed.size) return { already: true, held: held.length };

  // the new position of every name that stays; -1 for the ones that go
  const moveTo = new Array(held.length);
  const kept = [];
  for (let i = 0; i < held.length; i++) {
    if (doomed.has(held[i])) { moveTo[i] = -1; continue; }
    moveTo[i] = kept.length;
    kept.push(held[i]);
  }

  const wasRows = rowstore.count(id, 'records');
  const blocks = rowstore.blocksOf(id, 'records');
  const n = Array.isArray(blocks) ? blocks.length : 0;
  if (!n || !wasRows) throw new Error(`${doc.name} has no records to drop from`);

  const SPARE = 'records-dropping';
  for (const f of [rowstore.storeFile(id, SPARE), `${rowstore.storeFile(id, SPARE)}.meta.json`,
    rowstore.gzFile(id, SPARE), `${rowstore.gzFile(id, SPARE)}.meta.json`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
  }
  const w = rowstore.writer(id, SPARE, { offThread: true });
  let gone = 0;
  let seen = 0;
  if (note) note(0, n);
  for (let b = 0; b < n; b++) {
    for (const x of rowstore.readBlocks(id, 'records', [b]) || []) {
      const r = x.row || x;
      seen++;
      // THE ASSUMPTION, CHECKED ON EVERY RECORD rather than sampled: a record
      // sits at its setting's position in the list of names.
      if (held[r.si] !== r.label) {
        throw new Error(`record ${seen} is filed at position ${r.si}, where this set's list of names says `
          + `"${held[r.si]}" and the record says "${r.label}" — nothing was changed`);
      }
      const to = moveTo[r.si];
      if (to < 0) { gone++; continue; }
      // AND EVERY KEPT RECORD SAYS WHAT IT IS. Twelve of the owner's records
      // never carried the one-voice share, because the store grows its column
      // list when a wider row arrives and those twelve were written before it
      // did. Every reader resolves it to the same 98 that every other record
      // stores, so nothing has ever been wrong — but a record leaning on a
      // default is a record that does not say what it is (RULE NINE), and this
      // pass is already rewriting all of them. Same value, written down.
      w.push({ ...r, si: to, agreeCopy: require('./stagework').agrOf(r).copy });
    }
    // DRAIN, NOT FLUSH. flush only QUEUES a block for compression; the queue
    // is drained by close, at the very end. This loop never awaits, so every
    // block of a five-million-record store sat in memory at once and the
    // service reached 1.9 GB of its 1.8 GB ceiling on a store it had already
    // died on once today. Draining every so often costs nothing and holds the
    // memory flat — and it yields, so the service can answer while it works.
    if ((b + 1) % 40 === 0) await w.drain(); else w.flush();
    if (note) note(b + 1, n);
  }
  await w.close();

  // VERIFY BEFORE ANYTHING IS REPLACED.
  const gotRows = rowstore.count(id, SPARE);
  if (gotRows !== wasRows - gone) {
    throw new Error(`the copy holds ${gotRows} records and dropping ${gone} of ${wasRows} should leave `
      + `${wasRows - gone} — nothing was replaced`);
  }
  if (!gotRows) throw new Error('dropping would empty the set — nothing was replaced');
  // and the positions that remain are 0..n-1 with no gaps, or the next thing
  // added to this set takes a number something already on disk is using
  const positions = new Set();
  for (let b = 0; b < (rowstore.blocksOf(id, SPARE) || []).length; b++) {
    for (const x of rowstore.readBlocks(id, SPARE, [b]) || []) {
      const r = x.row || x;
      positions.add(r.si);
      if (kept[r.si] !== r.label) {
        throw new Error(`a kept record landed at the wrong position — nothing was replaced`);
      }
    }
  }
  if (positions.size !== kept.length) {
    throw new Error(`the copy holds ${positions.size} settings and ${kept.length} were kept — nothing was replaced`);
  }
  for (let i = 0; i < kept.length; i++) {
    if (!positions.has(i)) throw new Error(`position ${i} is missing from the copy — nothing was replaced`);
  }

  // SWAP.
  const from = rowstore.storeFile(id, SPARE);
  const to = rowstore.storeFile(id, 'records');
  fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);
  fs.renameSync(from, to);

  const plan = doc.plan || {};
  plan.settingLabels = kept;
  // what each unit holds moves with the drop -- on a set that says what it
  // holds. One not yet folded per unit is left unstamped, or the fold would
  // read the stamp and never run (the strip runs before the fold on open)
  if (Array.isArray(plan.unitSettings)) stampUnitSettingsFromRows(doc);
  plan.settings = kept.length;
  doc.plan = plan;
  doc.counts = { ...(doc.counts || {}), settings: kept.length, rows: gotRows };
  // A SET THAT WAS PRUNED SAYS SO, under which release, the same way one that
  // was added to does. It is no longer everything its first run priced.
  doc.drops = [...(doc.drops || []), {
    at: new Date().toISOString(), engineVersion: ENGINE_VERSION,
    settings: doomed.size, rows: gone, why: why || null,
  }];
  saveSet(doc);
  try { fs.rmSync(tallyFile(id), { force: true }); } catch (_) { /* nothing there */ }
  try { fs.rmSync(agreedFile(id), { force: true }); } catch (_) { /* nothing there */ }
  return { settings: doomed.size, rows: gone, held: kept.length, left: gotRows };
}

// MIGRATE BESIDE, VERIFY, THEN SWAP (RULE NINE). The records are hours of
// compute that cannot be re-derived from anything but a full re-run, so the
// one on disk is not touched until a whole new one has been written and
// counted. An interrupted run leaves a half-written spare and the real store
// exactly as it was.
//
// BLOCK BOUNDARIES: one source block in, one flush out, so they line up. The
// new names are nine characters longer, so a block at the size limit can still
// split in two — which is why the check below is on ROWS and not on blocks.
// Nothing outside the totals indexes a stage 3 block, and the totals are
// deleted here and rebuilt.
// THE ALWAYS GATE IS GONE (owner order, 2026-09-02), AND THE RECORDS FOLLOW
// IT (RULE NINE: when a process changes, the records change with it). A stage
// 3 set priced before 3.44.0 holds settings whose gate ignored the forecast.
// The first time such a set is opened, those settings are dropped -- beside,
// verified, swapped, exactly as `drop the settings the block does not
// declare` does -- the tables are put aside and totalled again, and the set
// is stamped with the gates its records hold, so it is never asked again.
// Announced on the screen as the totalling is, in the background, once.
const isAlwaysLabel = (label) => / always d[0-9.]+x t\d+h/.test(String(label || ''));
function alwaysLabelsOf(doc) {
  const held = ((doc || {}).plan || {}).settingLabels || [];
  return new Set(held.filter(isAlwaysLabel));
}
function needsAlwaysStrip(doc) {
  if (!doc || doc.stage !== 3 || (doc.status !== 'done' && doc.status !== 'incomplete')) return false;
  if (Array.isArray(doc.gates)) return false;      // stamped: its records hold only gates the engine has
  return alwaysLabelsOf(doc).size > 0;
}
async function stripAlwaysGate(doc, note = null, { inTallySlot = false } = {}) {
  const doomed = alwaysLabelsOf(doc);
  const out = doomed.size
    ? await dropSettingsNamed(doc, doomed, note, 'the always gate was removed from the engine (3.44.0)', { inTallySlot })
    : { already: true, settings: 0, rows: 0 };
  doc.gates = bracketLib.GATES.slice();
  saveSet(doc);
  return out;
}

async function renameSettingsToV3(doc, note = null) {
  const id = doc.id;
  const busy = stageBusy();
  if (busy) throw new Error(`${busy} is going — one heavy job at a time`);
  const wasRows = rowstore.count(id, 'records');
  const blocks = rowstore.blocksOf(id, 'records');
  const n = Array.isArray(blocks) ? blocks.length : 0;
  if (!n || !wasRows) throw new Error(`${doc.name} has no records to rename`);

  const SPARE = 'records-renaming';
  // never rowstore.remove(): that takes the WHOLE store directory with it
  for (const f of [rowstore.storeFile(id, SPARE), `${rowstore.storeFile(id, SPARE)}.meta.json`,
    rowstore.gzFile(id, SPARE), `${rowstore.gzFile(id, SPARE)}.meta.json`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
  }

  const w = rowstore.writer(id, SPARE, { offThread: true });
  const renames = new Map();
  let touched = 0;
  if (note) note(0, n);
  for (let b = 0; b < n; b++) {
    for (const x of rowstore.readBlocks(id, 'records', [b]) || []) {
      const r = x.row || x;
      const to = renamedLabelOf(r);
      if (!to) { w.push(r); continue; }
      renames.set(r.label, to);
      touched++;
      // the share is written out rather than left to be assumed: a record
      // says what it is (RULE NINE)
      w.push({ ...r, label: to, agreeCopy: require('./stagework').agrOf(r).copy });
    }
    // DRAIN, NOT FLUSH. flush only QUEUES a block for compression; the queue
    // is drained by close, at the very end. This loop never awaits, so every
    // block of a five-million-record store sat in memory at once and the
    // service reached 1.9 GB of its 1.8 GB ceiling on a store it had already
    // died on once today. Draining every so often costs nothing and holds the
    // memory flat — and it yields, so the service can answer while it works.
    if ((b + 1) % 40 === 0) await w.drain(); else w.flush();
    if (note) note(b + 1, n);
  }
  await w.close();

  // VERIFY BEFORE ANYTHING IS REPLACED.
  const gotRows = rowstore.count(id, SPARE);
  if (gotRows !== wasRows) {
    throw new Error(`the renamed copy holds ${gotRows} records and the set holds ${wasRows} — nothing was replaced`);
  }
  const check = (rowstore.readBlocks(id, SPARE, [0]) || []).map((x) => x.row || x);
  if (!check.length) throw new Error('the renamed copy reads back empty — nothing was replaced');
  for (const r of check) {
    if (renamedLabelOf(r)) throw new Error(`a renamed record still reads as needing renaming: ${r.label}`);
  }

  // SWAP. Two renames inside one directory.
  const from = rowstore.storeFile(id, SPARE);
  const to = rowstore.storeFile(id, 'records');
  fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);
  fs.renameSync(from, to);

  // the set's own list of names, moved by the SAME map the records moved by
  const plan = doc.plan || {};
  const held = plan.settingLabels || [];
  plan.settingLabels = held.map((L) => renames.get(L) || L);
  doc.plan = plan;
  doc.recordsVersion = RECORDS_V;
  saveSet(doc);
  // derived, so rebuilt rather than patched (RULE NINE)
  try { fs.rmSync(tallyFile(id), { force: true }); } catch (_) { /* nothing there */ }
  try { fs.rmSync(agreedFile(id), { force: true }); } catch (_) { /* nothing there */ }
  return { records: touched, settings: renames.size, rows: gotRows };
}

// WHAT A SET'S OWN BLOCK DECLARES AND ITS RECORDS DO NOT HOLD. Read-only, and
// through the launch's own enumerator, so the number on the screen and the
// number that would be priced are the same number.
// ---- THE BLOCK'S OWN LIST, WORKED OUT ONCE ---------------------------------
//
// Owner order, 2026-08-30: "fix the /missing caching".
//
// Every Boards draw asks what this set's block declares, and answering it
// meant rebuilding the whole block through the launch's enumerator — 18,675 ms
// measured end to end, on the one thread that answers everything else, for
// every tab switch, filter, page turn and sort. It is also why a status ask
// during a long job so often got no reply at all.
//
// IT IS A PURE FUNCTION OF WHAT IT READS, and what it reads cannot change
// while a finished set sits still:
//
//   * the set's own params — fixed at the launch;
//   * the parent stage 2 set: which records it holds, and the sort saved on
//     it, because that is what decides which units are carried;
//   * the parent's own bandPct per record, which is all bandsAcross reads —
//     nothing here looks at live prices or at anything outside those two.
//
// AND IT DOES NOT READ THE SET'S LIST OF SETTING NAMES. That is the property
// worth having: renaming, dropping and filling in all change that list and
// none of them can change what the block DECLARES, so the answer stands
// through every one of them — which are exactly the moments the owner is sat
// watching a screen redraw.
//
// Only the NAMES are kept. The enumerator builds half a million setting
// objects to answer; they are dropped and the list of labels is held, which
// is both what every caller here needs and a good deal less memory than the
// objects would have been.
const DECLARED_CACHE = new Map();
const DECLARED_CACHE_MAX = 2;
function declaredKeyFor(doc) {
  const pid = ((doc.parent || {}).id) || (doc.params || {}).from || '';
  let pstat = "gone";
  try { const st = fs.statSync(setFile(pid)); pstat = `${st.mtimeMs}|${st.size}`; } catch (_) { pstat = 'gone'; }
  // The parent doc is written whenever its records or its saved sort change,
  // so its file answers for both without this having to guess at store names.
  return `${doc.id}|${JSON.stringify(doc.params || {})}|${pid}|${pstat}`;
}
function declaredLabelsFor(doc) {
  const key = declaredKeyFor(doc);
  const hit = DECLARED_CACHE.get(key);
  if (hit) return hit;
  const { settings } = relaunchShapeOf(doc);
  const labels = settings.map((x) => x.label);
  settings.length = 0;
  DECLARED_CACHE.set(key, labels);
  while (DECLARED_CACHE.size > DECLARED_CACHE_MAX) DECLARED_CACHE.delete(DECLARED_CACHE.keys().next().value);
  return labels;
}

// WHICH SETTINGS THE BLOCK DECLARES AND THE RECORDS DO NOT HOLD. ONE
// definition, read by the line that COUNTS them for the screen and by the
// pass that PRICES them.
//
// It was written twice, and the two copies did not even agree on HOW. The
// counter used a set. The worker asked an array of 329,280 names whether it
// held each of 524,832 labels in turn — a hundred and seventy thousand
// million string comparisons, which is not slow, it is stopped. Nothing on
// screen would have said so either: the button would have been pressed and
// the night would have passed with no rows and no error (2026-08-30).
function missingSettingsIn(held, settings) {
  // ONE difference, taken through undeclaredIn like every other caller — this
  // used to keep its own copy of it, in the OPPOSITE argument order, which is
  // the sort of near-miss that reads as correct in both places right up until
  // one of them is edited.
  const gone = undeclaredIn(settings.map((st) => st.label), held);
  return settings.filter((st) => gone.has(st.label));
}
// THE NEXT FREE SETTING NUMBER, worked out by a LOOP.
//
// This was `Math.max(-1, ...ranked.map(...))`, and a spread hands every entry
// to the function as an argument of its own. The owner has 329,280 of them;
// engines cap arguments somewhere around 65,000. It threw "Maximum call stack
// size exceeded" before a single row was priced, and a list that long is the
// NORMAL case here, not an edge one. lib/dataset.js carries a comment saying
// exactly this, from the last time (2026-08-30).
function nextSettingNumber(ranked) {
  let max = -1;
  for (const r of ranked) { const v = Number(r.si) || 0; if (v > max) max = v; }
  return max + 1;
}
const MISSING_CACHE = new Map();
const MISSING_CACHE_MAX = 4;
function missingSettingsOf(id) {
  const doc = getSet(String(id || ''));
  if (!doc || doc.stage !== 3) return null;
  // AND THE ANSWER ITSELF IS REMEMBERED, on top of the list above. The list
  // survives a rename or a drop; the ANSWER does not, because both change what
  // the set holds. So this is keyed on the list's key AND on the set's own
  // file, and the recompute when that file moves is two set differences over
  // half a million names — about four tenths of a second, against the eighteen
  // and a half the enumeration costs.
  let dstat = 'gone';
  try { const st = fs.statSync(setFile(doc.id)); dstat = `${st.mtimeMs}|${st.size}`; } catch (_) { dstat = 'gone'; }
  let declared;
  let dkey;
  try {
    dkey = declaredKeyFor(doc);
    declared = declaredLabelsFor(doc);
  } catch (err) { return { why: err.message }; }
  const key = `${dkey}|${dstat}`;
  const hit = MISSING_CACHE.get(key);
  if (hit) return hit;

  const held = (doc.plan || {}).settingLabels || [];
  const coins = Array.isArray((doc.params || {}).universe) ? doc.params.universe.length : 1;
  // ONE definition, read both ways round: what the block declares and the set
  // does not hold, and what it holds and the block does not declare.
  const missing = undeclaredIn(declared, held).size;
  const surplus = undeclaredIn(held, declared).size;
  const out = {
    held: held.length,
    declared: declared.length,
    missing,
    units: (doc.plan || {}).units || 0,
    pricings: missing * ((doc.plan || {}).units || 0)
      * (1 + Math.max(0, Math.floor(num((doc.params || {}).nullN, 19))) + Math.max(0, Math.floor(num((doc.params || {}).keepN, 0)))),
    gate: tallyBudgetFor({ settings: declared.length, coins }),
    appends: (doc.appends || []).length,
    behind: settingsBehind(doc),
    surplus,
    drops: (doc.drops || []).length,
  };
  MISSING_CACHE.set(key, out);
  while (MISSING_CACHE.size > MISSING_CACHE_MAX) MISSING_CACHE.delete(MISSING_CACHE.keys().next().value);
  return out;
}

// ---- FILLING IN A BLOCK THAT WAS PRICED BEFORE IT WAS WHOLE --------------------
//
// Owner order, 2026-08-30. The point of moving a set onto today's shape is to
// have data that exercises it, and a set that cannot answer for three of the
// eight quorum pairs is not that. This prices what the set's OWN block
// declares and its records do not hold, and appends it. Nothing already
// priced is read for it, touched, or priced again.
//
// WHAT IS MISSING IS WORKED OUT THROUGH THE LAUNCH'S OWN ENUMERATOR, never
// from arithmetic. A count reached by multiplying out the dials came to 526,848
// where the enumerator says 524,832 — the same-trade fold and the share dedup
// do not follow a ratio. Anything but the enumerator risks pricing a duplicate,
// and a duplicate is invisible in a table of half a million rows.
// STOPPING IT IS A USER FUNCTION (owner order, 2026-08-30; RULE FIVE). Seven
// hours in, the only way to end this pass was to restart the service — which
// leaves the half-written append behind and looks, from the screen, like
// nothing happened at all. It is asked between UNITS, which is the only place
// it can stop and leave whole ones behind.
async function appendMissingSettings(doc, pool = null, note = null, asked = null) {
  const id = doc.id;
  const busy = stageBusy();
  if (busy) throw new Error(`${busy} is going — one heavy job at a time`);
  // ORDER MATTERS AND THE SCREEN CANNOT BE THE ONLY THING SAYING SO. A setting
  // whose name is behind reads as one the block does not declare, so pricing
  // the block's missing settings first would price every one of them a SECOND
  // time under its new name — which is exactly what this pass promises never to
  // do (owner order, 2026-08-30: no duplicate records).
  const behind = settingsBehind(doc);
  if (behind) {
    throw new Error(`${behind.toLocaleString()} of this set's settings are named in the older way — bring the setting `
      + 'names up to date first, or every one of them would be priced a second time under its new name');
  }
  // READ BEFORE THE GUARDS THAT USE IT. This sat below them and a const read
  // before its own line throws — the whole pass would have died on the spot.
  const held = (doc.plan || {}).settingLabels || [];
  if (!held.length) throw new Error(`${doc.name} does not record which settings it holds, so nothing can be added to it safely`);
  // A HALF-WRITTEN RUN IS NOT SOMETHING TO APPEND TO, and this costs nothing to
  // ask — it is a row count against the sidecar — so it is asked BEFORE the
  // enumeration below, which is seventeen seconds. The narrowest check that can
  // fail goes first.
  const halfDone = unfinishedAppend(doc);
  if (halfDone && halfDone.extra > 0) {
    throw new Error(`this set holds ${halfDone.extra.toLocaleString()} records past the end of its own list of names, `
      + 'left by a run that did not finish — undo that first');
  }
  const { parent, records, settings, heldOn } = relaunchShapeOf(doc);
  // AND THE SAME FOR THE SETTINGS THAT ARE ALREADY DUPLICATES (owner order,
  // 2026-08-30). This guard was written for the names and NOT for these, and the
  // owner pressed straight past the gap and paid seven hours for it. A pass that
  // promises no second copy has to refuse both ways of getting one.
  const surplusNow = undeclaredIn(held, settings.map((x) => x.label)).size;
  if (surplusNow) {
    throw new Error(`this set holds ${surplusNow.toLocaleString()} settings its block does not declare — drop them `
      + 'first, or this run prices around duplicates that are about to go');
  }
  // THE INDEX A RECORD IS FILED UNDER MUST NOT BE REUSED. Every record carries
  // the position of its setting in the launch's list, and the tables group by
  // it. A new setting takes the next free one, so nothing already on disk can
  // be mistaken for it.
  const t = readTally(id);
  if (!t) throw new Error('open this set on Boards and let its tables finish first — the next free setting number is read from them');
  const nextSi = nextSettingNumber(t.ranked);
  if (nextSi !== held.length) {
    throw new Error(`this set holds ${held.length} setting name(s) but its records reach ${nextSi} — it cannot be added to until those agree`);
  }
  const missing = missingSettingsIn(held, settings);
  if (!missing.length) return { already: true, settings: settings.length };

  // both gates, on what the set WOULD hold, before a single row is priced
  const coinsN = Array.isArray((doc.params || {}).universe) ? doc.params.universe.length : 1;
  const heapGate = tallyBudgetFor({ settings: held.length + missing.length, coins: coinsN });
  if (heapGate.band === 'refuse') throw new Error(heapGate.message);
  const diskGate = storeBudgetFor({ rows: missing.length * records.length });   // the ceiling; the units hold at most this
  if (diskGate.band === 'refuse') throw new Error(diskGate.message);

  const fee = Number((doc.params || {}).fee) || 0;
  const nullN = Math.max(0, Math.floor(num((doc.params || {}).nullN, 19)));
  // a missing setting takes the next free number, and is priced only on the
  // units that hold it in the block it is missing from
  const newSi = new Map(missing.map((st, k) => [st.si, nextSi + k]));
  const payloads = records.map((rec, i) => {
    const mine = new Set(heldOn[i]);
    return s3Payload({ doc, parent, rec, settings: missing.filter((st) => mine.has(st.si)).map((st) => ({ ...st, si: newSi.get(st.si) })), fee, nullN });
  });
  const addedPerUnit = records.map((rec, i) => { const mine = new Set(heldOn[i]); return missing.filter((st) => mine.has(st.si)).length; });
  // appended, not rewritten: the writer opens the store for appending and
  // carries on its own row count, its own columns and its own block list
  const w = rowstore.writer(id, 'records', { offThread: true });
  const startedRows = rowstore.count(id, 'records');
  const failures = [];
  let done = 0;
  if (note) note(0, payloads.length);
  const take = (settled, i) => {
    const rec = records[i];
    if (settled.ok && settled.value) {
      for (const row of settled.value.rows) {
        // each setting carries its place in the set to the worker; they sit
        // after everything already on disk. storedRecordOf for the same reason
        // the first writer uses it: one place decides what reaches disk.
        w.push({
          ...require('./stagework').storedRecordOf(row),
          si: row.si,
          u: rec.u, trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size, geometry: rec.geometry,
        });
      }
      w.flush();
    } else if (!settled.ok) {
      failures.push({ unit: `${rec.trade}|${rec.geometry}`, error: String(settled.error || 'failed') });
    }
    done++;
    if (note) note(done, payloads.length);
    wantsStop();          // asked after every unit, on both paths
  };
  let stopped = false;
  // STOPPING THE POOLED PATH IS pool.abort(), NOT A FOURTH ARGUMENT. forEach
  // takes three and ignores anything after them, so a stop passed that way is a
  // button that silently does nothing — which is worse than no button at all.
  // The lane loop already stops on the pool's own flag, and abort sets it.
  const wantsStop = () => {
    if (!stopped && asked && asked()) { stopped = true; if (pool && pool.abort) pool.abort(); }
    return stopped;
  };
  if (pool && pool.parallel) await pool.forEach('s3Unit', payloads, take);
  else {
    for (let i = 0; i < payloads.length; i++) {
      if (wantsStop()) break;
      // eslint-disable-next-line no-await-in-loop
      try { take({ ok: true, value: await require('./stagework').s3UnitTask(payloads[i]) }, i); }
      catch (err) { take({ ok: false, error: err.message }, i); }
    }
  }
  await w.close();
  // A STOPPED RUN IS NOT A FINISHED ONE. The names are deliberately NOT written:
  // the set is left exactly as an interrupted append leaves it, and the repair
  // that undoes those rows is the same one a crash needs. Writing them here
  // would hide half-covered settings among whole ones.
  if (stopped) {
    return { stopped: true, unitsDone: done, units: payloads.length, rows: rowstore.count(id, 'records') - startedRows };
  }
  if (failures.length === records.length) {
    throw new Error(`every unit failed while adding settings: ${failures[0].error}`);
  }

  const plan = doc.plan || {};
  plan.settingLabels = held.concat(missing.map((st) => st.label));
  // and what each unit holds moves with it -- on a set that says what it
  // holds; one not yet folded per unit is left unstamped, so the fold still runs
  if (Array.isArray(plan.unitSettings)) {
    plan.unitSettings = records.map((rec, i) => {
      const was = plan.unitSettings.find((x) => x.u === rec.u);
      return { u: rec.u, held: (was ? Number(was.held) || 0 : 0) + addedPerUnit[i] };
    });
    plan.pricings = plan.unitSettings.reduce((a, x) => a + x.held, 0);
  }
  plan.settings = plan.settingLabels.length;
  doc.plan = plan;
  doc.counts = { ...(doc.counts || {}), settings: plan.settings, rows: rowstore.count(id, 'records') };
  // A SET THAT WAS ADDED TO SAYS SO, and under which release. It is no longer
  // one run under one engine, and that is a thing the reader is entitled to
  // know rather than to infer from a stamp that only names the first.
  doc.appends = [...(doc.appends || []), {
    at: new Date().toISOString(), engineVersion: ENGINE_VERSION,
    settings: missing.length, rows: rowstore.count(id, 'records') - startedRows,
    failures: failures.length,
  }];
  if (failures.length) doc.failures = [...(doc.failures || []), ...failures];
  saveSet(doc);
  // derived, so rebuilt rather than patched (RULE NINE)
  try { fs.rmSync(tallyFile(id), { force: true }); } catch (_) { /* nothing there */ }
  try { fs.rmSync(agreedFile(id), { force: true }); } catch (_) { /* nothing there */ }
  return { added: missing.length, rows: rowstore.count(id, 'records') - startedRows, failures: failures.length };
}

const AGREED_V = 1;
const agreedFile = (id) => path.join(SETS_DIR, `${id}-agreed.json.gz`);
function readAgreed(id) {
  try {
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(agreedFile(id))).toString('utf8'));
    return raw && raw.v === AGREED_V && raw.map ? raw.map : null;
  } catch (_) { return null; }
}
function writeAgreed(id, map) {
  const tmp = `${agreedFile(id)}.tmp${process.pid}-${++tmpSeq}`;
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify({ v: AGREED_V, at: new Date().toISOString(), map }))));
  fs.renameSync(tmp, agreedFile(id));
  return map;
}
// The units and the settings a stage 3 set was launched with, rebuilt from
// what the set itself recorded — the same two calls the launch made, given
// the same saved params, so the block that comes back is the block that ran.
function relaunchShapeOf(doc) {
  const parent = getSet(((doc.parent || {}).id) || (doc.params || {}).from || '');
  if (!parent || parent.stage !== 2) throw new Error('the stage 2 record set this was priced from is no longer on the box');
  const choice = unitsChoiceOf(doc.params || {});
  const { records } = stage3UnitsFor(parent, choice.carry, choice.selected);
  if (!records.length) throw new Error(`${parent.name} holds no records — the units cannot be rebuilt`);
  const sizes = [...new Set(records.map((r) => r.size || (r.ctx1 ? (r.ctx2 ? 3 : 2) : 1)))];
  const { kept, heldOn } = foldSameTradeSettings(settingsFor(doc.params || {}, sizes), records);
  // every setting carries its place in the block, and heldOn[i] lists the
  // places records[i] holds
  return { parent, records, settings: kept.map((st, si) => ({ ...st, si })), heldOn };
}
// ---- REBUILDING THE NUMBERS STAGE 3 DID NOT STORE ------------------------------
//
// Owner ruling 4: the Funnel builds the missing numbers on demand, for the
// settings that survive, and stage 3 does not grow. Everything in `rich` is
// already computed inside the pricing pass and thrown away by storedRecordOf,
// so this is the same pass over a handful of settings instead of half a million.
//
// Nothing here is cheap in the sense of free: rebuilding a unit is the expensive
// part and there are as many units as the board holds. Pricing a few thousand
// narrowed settings against them is seconds.

// The FIRST digit of a release is the one that says records stop being
// comparable (RULE ONE-C). A number rebuilt by a different first digit is a
// number from a different engine sitting beside numbers from this one, and
// nothing downstream could tell them apart.
function firstDigitOf(v) { return String(v || '').split('.')[0] || null; }

// THE REBUILD PROVES ITSELF. It recomputes the money and the trade count
// alongside the new numbers and checks them against what stage 3 stored. A
// mismatch means this is not the same run any more — the price files moved, or
// the engine did — and it refuses rather than writing numbers from one world
// beside numbers from another.
//
// `expect` maps a setting's index to the average test money the tally holds for
// it. When the caller supplies none, the result says so: an unproved rebuild is
// allowed, but it may never look like a proved one.
// EXPECT IS KEYED BY LABEL, and that is not a detail. si comes back per BLOCK —
// each setting carries its place in the set to the worker — so proving against
// si would line setting 0 of the rebuild up with setting 0 of the whole board.
// Every one would "match" and not one of them would be the same setting.
// LIKE FOR LIKE, OR IT IS NOT A CHECK (3.57.3, owner report 2026-09-04: "20
// setting(s) came back different from what the sweep stored - this is not the
// same run"). It was the same run: on a unit's board the stored money is THAT
// UNIT'S, and the rebuild's own avgTest is the average across every unit of
// the set. Comparing them disagreed on 120,291 of 137,760 settings by
// construction. `onUnit` names the unit the figures were read on, and the
// rebuilt figure is then that unit's own; without it the comparison is
// against the average, which is right for `all units together` and right
// nowhere else.
function proveRebuild(perSetting, expect, tol = 1e-6, onUnit = null) {
  if (!expect || !Object.keys(expect).length) {
    return { ran: false, checked: 0, matched: 0, mismatches: [], why: 'the caller supplied nothing to check against' };
  }
  const mismatches = [];
  let checked = 0;
  let unmatched = 0;
  let differed = 0;
  let noFigure = 0;
  for (const [label, got] of perSetting) {
    const want = expect[label];
    // A setting the caller asked about and the rebuild did not return is not a
    // silent skip: it is counted and reported, because "checked 3 of 40" and
    // "checked 40 of 40" are different claims.
    if (want == null || !Number.isFinite(Number(want))) { unmatched++; continue; }
    // the figure for the board this was read on: one unit's, or the average
    // over all of them
    let mine = got.avgTest;
    if (onUnit) {
      const u = (got.units || []).find((x) => unitKeyOf(x) === onUnit);
      if (!u) { noFigure++; continue; }
      mine = u.pnl == null || !Number.isFinite(Number(u.pnl)) ? null : Number(u.pnl);
    }
    checked++;
    const scale = Math.max(1, Math.abs(Number(want)));
    if (mine == null || Math.abs(mine - Number(want)) / scale > tol) {
      differed++;
      // THE LIST IS CAPPED AND THE COUNT IS NOT (3.57.3): the screen printed
      // the length of this list, so "20 setting(s) came back different" meant
      // "at least 20". `differed` is the true number; `mismatches` is what
      // there is room to name.
      if (mismatches.length < 20) mismatches.push({ label, stored: Number(want), rebuilt: mine });
    }
  }
  const why = [];
  if (unmatched) why.push(`${unmatched} rebuilt setting(s) had nothing to check against`);
  if (noFigure) why.push(`${noFigure} rebuilt setting(s) carry no money for this unit`);
  return {
    ran: true,
    checked,
    matched: checked - differed,
    differed,
    unmatched,
    noFigure,
    onUnit: onUnit || null,
    mismatches,
    why: why.length ? why.join('; ') : null,
  };
}

// THE SURVIVORS OF A RULE, BY NAME (3.57.1). The rebuild used to be handed a
// list of setting names by the page, and the page had none to hand: it sent an
// empty list and the service refused it, so `work out the missing numbers` had
// never once run. The press names the rule now, and the survivors are worked
// out HERE, through S4.applyRule -- the one function that applies a rule
// (lib/funnelset.js) -- so the settings rebuilt are the very settings the
// count at the top of the walk is counting, and the two cannot drift.
//
// AND WITH WHAT THE SWEEP STORED FOR EACH OF THEM (3.57.2, owner question
// 2026-09-04 about "NOT checked against the sweep (the caller supplied nothing
// to check against)"). A rebuild re-prices a setting and re-works its average
// test money, and comparing that against the money the sweep stored is what
// says the two runs are the same world. That comparison only ever happened
// when the CALLER supplied the stored figures, and the page holds none -- so
// it never happened. The rows read here carry them, so they travel back with
// the names and the check always has something to check.
async function survivorLabelsOf(id, state = {}) {
  const S4 = require('./funnelset');
  const t = readTally(id);
  if (!t) return null;                        // no tables yet: the caller starts a totalling
  const board = await funnelBoard(id, t, state.unit);
  const rich = readFunnelRich(id);
  const all = withFunnelRich(board.all, rich);
  const rows = S4.applyRule(all, S4.normaliseRule(state.rule));
  const stored = {};
  for (const r of rows) if (Number.isFinite(Number(r.avgTest))) stored[r.label] = Number(r.avgTest);
  return { labels: rows.map((r) => r.label), of: all.length, stored };
}
async function rebuildRichFor(doc, wantedLabels, opts = {}) {
  const busy = stageRunning();
  if (busy) {
    throw new Error(`${busy} is running — a rebuild reads the same units it does, `
      + 'so it waits rather than competing for them');
  }
  const here = require('../package.json').version;
  const there = (doc.params || {}).engineVersion || doc.release || null;
  if (there && firstDigitOf(there) !== firstDigitOf(here)) {
    throw new Error(`this set was priced by release ${there} and this is ${here} — `
      + 'a rebuilt number would come from a different engine than the ones beside it');
  }
  const wanted = new Set((wantedLabels || []).map(String));
  if (!wanted.size) throw new Error('nothing was asked for');
  const { parent, records, settings, heldOn } = relaunchShapeOf(doc);
  const use = settings.filter((st) => wanted.has(st.label));
  const missing = [...wanted].filter((L) => !settings.some((st) => st.label === L));
  if (missing.length) {
    throw new Error(`${missing.length} of the settings asked for are not in this set's block `
      + `(first: ${missing[0]}) — it cannot rebuild what it never priced`);
  }
  const fee = Number((doc.params || {}).fee) || 0;
  const nullN = Math.max(0, Math.floor(num((doc.params || {}).nullN, 19)));
  const payloads = records.map((rec, i) => {
    const mine = new Set(heldOn[i]);
    return s3Payload({ doc, parent, rec, settings: use.filter((st) => mine.has(st.si)), fee, nullN });
  });

  // si is per-BLOCK on the way back — the worker numbers what it was handed
  // from zero — so the label is what identifies a setting across units.
  const perSetting = new Map();
  const failures = [];
  let done = 0;
  const pool = createPool();
  activePool = pool;
  await pool.forEach('s3Unit', payloads, (settled, i) => {
    const rec = records[i];
    if (settled.ok && settled.value) {
      for (const row of settled.value.rows) {
        let e = perSetting.get(row.label);
        if (!e) { e = { label: row.label, units: [], avgTest: null }; perSetting.set(row.label, e); }
        e.units.push({
          u: rec.u, trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, geometry: rec.geometry,
          pnl: row.pnl, trades: row.trades, holdout: row.holdout, rich: row.rich,
        });
      }
    } else if (!settled.ok) {
      failures.push({ unit: `${rec.trade}|${rec.geometry}`, error: String(settled.error || 'failed') });
    }
    done++;
    if (opts.note) opts.note(done, payloads.length);
  });
  activePool = null;
  for (const e of perSetting.values()) {
    const vals = e.units.map((x) => x.pnl).filter((v) => v != null && Number.isFinite(v));
    e.avgTest = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
  }
  return { perSetting, failures, units: records.length, settings: use.length };
}

// ONE UNIT'S PAYLOAD, BUILT ONE WAY. The launch, the rebuild of what actually
// agreed, and the pass that fills in settings a block was priced without all
// hand the workers the same thing — so anything priced later is priced exactly
// as the first rows were. Only what is being ASKED for differs: which
// settings, how many null-set deals, and whether anything is priced at all.
function s3Payload({ doc, parent, rec, settings, fee, nullN, agreedOnly = false }) {
  const votes = unitRows(parent.id, 'votes', rec.blocks.votes, rec.u);
  const tau = unitRows(parent.id, 'tau', rec.blocks.tau, rec.u);
  return {
    combo: { trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size },
    geometry: rec.geometry, params: doc.params,
    unit: {
      bandPct: rec.bandPct,
      probs: rec.specs.map((_, mi) => votes.map((v) => v.m[mi])),
      ts: { test: votes.filter((v) => v.w === 0).map((v) => v.ts), hold: votes.filter((v) => v.w === 1).map((v) => v.ts) },
      members: rec.specs.map((spec, mi) => ({ spec, tauProbs: (tau.find((t) => t.mi === mi) || {}).probs || [] })),
    },
    settings, fee, nullN, keepN: agreedOnly ? 0 : (Number((doc.params || {}).keepN) || 0), seed: doc.seed,
    unitKey: `${rec.trade}|${rec.ctx1 || ''}|${rec.ctx2 || ''}|${rec.geometry}`,
    ...(agreedOnly ? { agreedOnly: true } : {}),
  };
}

async function buildAgreedTable(doc, pool = null, note = null) {
  const sw = require('./stagework');
  const { parent, records, settings, heldOn } = relaunchShapeOf(doc);
  const p = doc.params || {};
  const payloads = records.map((rec, i) => s3Payload({
    doc, parent, rec, settings: heldOn[i].map((k) => settings[k]), fee: Number(p.fee) || 0, nullN: 0, agreedOnly: true, note: note && (() => note(i, records.length)),
  }));
  const map = {};
  let done = 0;
  if (note) note(0, payloads.length);
  const take = (settled, i) => {
    if (!settled.ok) throw new Error(`a unit's agreement could not be rebuilt: ${settled.error}`);
    for (const [k, v] of Object.entries(settled.value.agreed || {})) map[`${records[i].u}|${k}`] = v;
    done++;
    if (note) note(done, payloads.length);
  };
  if (pool && pool.parallel) {
    await pool.forEach('s3Unit', payloads, take);
  } else {
    for (let i = 0; i < payloads.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      take({ ok: true, value: await sw.s3UnitTask(payloads[i]) }, i);
    }
  }
  return writeAgreed(doc.id, map);
}
function ensureAgreedTable(id) { return readAgreed(id); }

async function buildTally(doc, pool = null, note = null) {
  const id = doc.id;
  const sw = require('./stagework');
  const agreedAt = readAgreed(id);
  const blocks = rowstore.blocksOf(id, 'records') || [];
  const acc = sw.newTallyAcc();
  const settingsCount = (doc.plan || {}).settings || 0;
  // Sharded across the pool when one is in hand and the store is big enough
  // to be worth it (owner order, 2026-08-27: "yes" to multithreading the
  // totalling) — but never for a block so wide the per-lane accumulators
  // would not fit (see SHARD_SETTINGS_LIMIT above). The fold is ONE rule
  // either way, sums are commutative and the block sets are unions, so the
  // sharded answer IS the single-pass answer — a test holds the two equal.
  if (pool && pool.parallel && blocks.length >= 8 && settingsCount <= SHARD_SETTINGS_LIMIT) {
    const lanes = Math.max(2, (pool.workers || []).length * 3);
    const per = Math.ceil(blocks.length / lanes);
    const shards = [];
    for (let at = 0; at < blocks.length; at += per) {
      shards.push({ id, agreedAt, blocks: Array.from({ length: Math.min(per, blocks.length - at) }, (_, k) => at + k) });
    }
    let doneShards = 0;
    if (note) note(0, shards.length);
    await pool.forEach('s3Tally', shards, (settled) => {
      if (settled.ok && settled.value) sw.mergeTallyAcc(acc, settled.value);
      else if (!settled.ok) throw new Error(`a tally shard failed: ${settled.error}`);
      doneShards++;
      if (note) note(doneShards, shards.length);
    });
  } else {
    // Block by block, yielding between blocks: this fold runs on the one
    // thread the pages share, and "totalling in the background" must be true
    // there — a synchronous 8.7M-row fold froze every screen for minutes.
    for (let bi = 0; bi < blocks.length; bi++) {
      for (const x of rowstore.readBlocks(id, 'records', [bi])) sw.tallyFold(acc, x.row, bi, agreedAt);
      if (note) note(bi + 1, blocks.length);
      await new Promise((resolve) => { setImmediate(resolve); });
    }
  }
  // THE ACCUMULATOR IS DRAINED AS THE TABLES ARE BUILT (2026-08-27, the
  // second out-of-memory death): the fold of the 177,408-setting block fit,
  // and then building the finished tables ON TOP of the still-whole
  // accumulator doubled the footprint and died. Each entry is deleted the
  // moment its row exists, so the peak is one copy plus flat rows, never two
  // copies of the widest structure.
  const ranked = [];
  for (const [key, st] of acc.perSetting) {
    const coinCells = [...st.perCoin.values()];
    const mean = (f) => {
      const vals = coinCells.map(f).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const coinHold = coinCells.map((c) => (c.holdN ? c.hold / c.holdN : null));
    // THE ALL-LUCK COPY OF THIS ROW (FUNNEL-DESIGN.md 4.5): one figure per kept
    // scramble, averaged over the same cells avgTest is. The count beside it is
    // how many of those this row's real test money beat -- the same shape as
    // beat its own null set, and worked out here so the table can rank by it.
    const avgTest = mean((c) => (c.testN ? c.test / c.testN : null));
    const nt = sw.meanNoise(coinCells, 'nt');
    ranked.push({
      si: st.si, label: st.label,
      decision: st.decision, bandMode: st.bandMode, weekdaysOnly: st.weekdaysOnly,
      entry: st.entry, gate: st.gate, dMult: st.dMult, tHours: st.tHours, trailMult: st.trailMult, armMult: st.armMult,
      agreeRule: st.agreeRule, agreeBar: st.agreeBar, agreePct: st.agreePct, agreeCopy: st.agreeCopy,
      agreeBoth: st.agreeBoth, agreePersist: st.agreePersist,
      members: st.members,
      avgRung: mean((c) => (c.rungN ? c.rung / c.rungN : null)),
      avgVoices: mean((c) => (c.voicesN ? c.voices / c.voicesN : null)),
      avgAgreed: mean((c) => (c.agrN ? c.agr / c.agrN : null)),
      coins: coinCells.length,
      coinsInMoney: coinHold.filter((v) => v != null && v > 0).length,
      avgTest: avgTest,
      avgHold: mean((c) => (c.holdN ? c.hold / c.holdN : null)),
      avgTrades: mean((c) => (c.holdN ? c.trades / c.holdN : null)),
      avgVsLong: mean((c) => (c.vsln ? c.vsl / c.vsln : null)),
      avgLead: mean((c) => (c.ldN ? c.ld / c.ldN : null)),
      beat: coinCells.reduce((a, c) => a + c.beat, 0),
      pairs: coinCells.reduce((a, c) => a + c.pairs, 0),
      // THE ALL-LUCK COPY OF THIS ROW (FUNNEL-DESIGN.md 4.5). One figure per
      // kept scramble, averaged over the same cells avgTest is, so the Funnel
      // can run any reading twice: once here and once on a table where nothing
      // is real. null on a set priced before the column existed -- the set
      // document says so, and no reader has to guess from a record's age.
      noiseTest: nt,
      noiseHold: sw.meanNoise(coinCells, 'nh'),
      beatNoise: nt && avgTest != null ? nt.filter((v) => v != null && avgTest > v).length : null,
      noisePairs: nt ? nt.length : 0,
    });
    acc.perSetting.delete(key);
  }
  ranked.sort((a, b) => ((b.pairs ? b.beat / b.pairs : -1) - (a.pairs ? a.beat / a.pairs : -1)) || (a.si - b.si));
  const coins = [];
  for (const [key, k] of acc.perCoin) {
    const kTest = k.testN ? k.test / k.testN : null;
    const kNt = sw.meanNoise([k], 'nt');
    coins.push({
      cellLabel: k.cellLabel, trade: k.trade, ctx1: k.ctx1, ctx2: k.ctx2, geometry: k.geometry,
      share: k.pairs ? k.beat / k.pairs : null, beat: k.beat, pairs: k.pairs,
      avgTest: k.testN ? k.test / k.testN : null,
      avgHold: k.holdN ? k.hold / k.holdN : null,
      avgTrades: k.tradesN ? k.trades / k.tradesN : null,
      avgVsLong: k.vsln ? k.vsl / k.vsln : null,
      avgAgreed: k.agrN ? k.agr / k.agrN : null,
      rows: k.rows, b: [...k.b].sort((x, y) => x - y),
      noiseTest: kNt,
      noiseHold: sw.meanNoise([k], 'nh'),
      beatNoise: kNt && kTest != null ? kNt.filter((v) => v != null && kTest > v).length : null,
      noisePairs: kNt ? kNt.length : 0,
    });
    acc.perCoin.delete(key);
  }
  const out = { v: TALLY_V, builtAt: new Date().toISOString(), rows: acc.rows, ranked, coins };
  // WRITTEN STREAMING, entry by entry. Stringifying a 177,408-setting tally
  // in one piece is a second whole copy of it at the worst moment — part of
  // what put the first totalling over the heap. The stream writes the same
  // bytes without ever holding them all at once.
  const tmp = `${tallyFile(id)}.tmp${process.pid}-${++tmpSeq}`;
  const gz = zlib.createGzip();
  const ws = fs.createWriteStream(tmp);
  gz.pipe(ws);
  const put = (str) => new Promise((resolve) => { if (gz.write(str)) resolve(); else gz.once('drain', resolve); });
  const breathe = (i) => (i % 2000 === 1999 ? new Promise((resolve) => { setImmediate(resolve); }) : null);
  // The header carries the two counts so the reader knows where the settings
  // end and the coins begin without holding either list to find out.
  await put(`{"v":${TALLY_V},"builtAt":${JSON.stringify(out.builtAt)},"rows":${acc.rows},"ranked":${ranked.length},"coins":${coins.length}}\n`);
  for (let i = 0; i < ranked.length; i++) { await put(`${JSON.stringify(ranked[i])}\n`); const b = breathe(i); if (b) await b; }
  for (let i = 0; i < coins.length; i++) { await put(`${JSON.stringify(coins[i])}\n`); const b = breathe(i); if (b) await b; }
  await new Promise((resolve) => { ws.on('finish', resolve); gz.end(); });
  fs.renameSync(tmp, tallyFile(id));
  return out;
}
// ---- REBUILDING THE TABLES WHEN THEY ARE MISSING (owner order, 2026-08-27:
// "go with the durable fix but must have good progress indicator"). A
// restart — or the out-of-memory death that orphaned the first big set —
// can no longer strand a finished set without its tables: opening it kicks
// the totalling in the background, the screen shows how far it has got, and
// the tables appear when it lands. One totalling at a time; it waits its
// turn while a run is going, and a failure is reported on the set and on
// the screen rather than retried into the same wall.
let tallyRun = null;   // { id, done, total, startedAt, error, promise }

// ---- FOLDING A SET'S RECORDS PER UNIT (3.52.0, RULE NINE) --------------------
function foldBehind(doc) {
  if (!doc || doc.stage !== 3) return false;
  if (doc.status !== 'done' && doc.status !== 'incomplete') return false;
  if (!Array.isArray(((doc.plan || {}).settingLabels)) || !doc.plan.settingLabels.length) return false;
  return !Array.isArray((doc.plan || {}).unitSettings);
}
// what each unit holds, counted off the records themselves -- after a pass
// that changed what is on disk, the set says what it now holds
function stampUnitSettingsFromRows(doc) {
  const per = new Map();
  const blocks = rowstore.blocksOf(doc.id, 'records') || [];
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(doc.id, 'records', [b]) || []) {
      const r = x.row || x;
      per.set(r.u, (per.get(r.u) || 0) + 1);
    }
  }
  const order = Array.isArray((doc.plan || {}).unitSettings) ? doc.plan.unitSettings.map((x) => x.u) : [...per.keys()].sort((a, b) => a - b);
  for (const u of per.keys()) if (!order.includes(u)) order.push(u);
  doc.plan.unitSettings = order.map((u) => ({ u, held: per.get(u) || 0 }));
  doc.plan.pricings = doc.plan.unitSettings.reduce((a, x) => a + x.held, 0);
}
async function foldRecordsPerUnit(doc, note = null) {
  const id = doc.id;
  const labels = (doc.plan || {}).settingLabels || [];
  // A SET WHOSE BLOCK CANNOT BE REBUILT TODAY is not left unusable: its stage
  // 2 parent may be gone, or its names may be behind. It is stamped with what
  // its records hold, unit by unit, and the plan says the fold did not run
  // and why -- the audit on Boards says the same, and the owner decides.
  const stampOnly = (why) => {
    stampUnitSettingsFromRows(doc);
    doc.plan.foldedPerUnit = { at: new Date().toISOString(), dropped: 0, kept: rowstore.count(id, 'records'), notFolded: why };
    saveSet(doc);
    return { kept: doc.plan.foldedPerUnit.kept, dropped: 0, notFolded: why };
  };
  let shape;
  try { shape = relaunchShapeOf(doc); } catch (err) { return stampOnly(String(err.message || err)); }
  const { records, settings, heldOn } = shape;
  // THE SET'S OWN ORDER, MATCHED BY NAME: a set that has had settings filled
  // in holds the block's names with the new ones at the end, so a place in
  // the set is found from its name, never assumed to be the block's place
  const blockAt = new Map(settings.map((st) => [st.label, st.si]));
  const planToBlock = labels.map((L) => blockAt.get(L));
  if (settings.length !== labels.length || planToBlock.some((k) => k === undefined)) {
    return stampOnly(`the block rebuilt today (${settings.length.toLocaleString()} settings) is not the one this set holds `
      + `(${labels.length.toLocaleString()}) — bring the set's settings up to date first`);
  }
  // holds.get(u): the places IN THE SET that unit u holds
  const holds = new Map(records.map((rec, i) => {
    const blockHeld = new Set(heldOn[i]);
    return [rec.u, new Set(labels.map((L, p) => p).filter((p) => blockHeld.has(planToBlock[p])))];
  }));
  // nothing to fold when every unit holds the whole block: the set is
  // stamped and its records are not rewritten
  if (heldOn.every((list) => list.length === settings.length)) {
    doc.plan.unitSettings = records.map((rec, i) => ({ u: rec.u, held: heldOn[i].length }));
    doc.plan.pricings = doc.plan.unitSettings.reduce((a, x) => a + x.held, 0);
    doc.plan.foldedPerUnit = { at: new Date().toISOString(), dropped: 0, kept: rowstore.count(id, 'records') };
    saveSet(doc);
    return { kept: doc.plan.foldedPerUnit.kept, dropped: 0 };
  }
  const SPARE = 'records-folding';
  for (const f of [rowstore.storeFile(id, SPARE), `${rowstore.storeFile(id, SPARE)}.meta.json`,
    rowstore.gzFile(id, SPARE), `${rowstore.gzFile(id, SPARE)}.meta.json`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
  }
  const blocks = rowstore.blocksOf(id, 'records') || [];
  const w = rowstore.writer(id, SPARE, { offThread: true });
  let kept = 0;
  let dropped = 0;
  let beyond = 0;
  if (note) note(0, blocks.length);
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(id, 'records', [b]) || []) {
      const r = x.row || x;
      if (!(r.si >= 0 && r.si < labels.length)) { beyond++; continue; }
      const mine = holds.get(r.u);
      if (mine && mine.has(r.si)) { w.push(r); kept++; } else dropped++;
    }
    w.flush();
    if (note) note(b + 1, blocks.length);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  await w.close();
  if (beyond) throw new Error(`${beyond.toLocaleString()} records sit past the end of this set's list of names — undo that first, nothing was replaced`);
  const got = rowstore.count(id, SPARE);
  if (got !== kept) throw new Error(`the copy holds ${got.toLocaleString()} records and ${kept.toLocaleString()} were kept — nothing was replaced`);
  // SWAP, and everything derived from the records goes with the old ones
  const from = rowstore.storeFile(id, SPARE);
  const to = rowstore.storeFile(id, 'records');
  fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);
  fs.renameSync(from, to);
  recordsInHand.id = null; recordsInHand.rows = null;
  try { fs.rmSync(tallyFile(id), { force: true }); } catch (_) { /* nothing there */ }
  try { fs.rmSync(funnelRichFile(id), { force: true }); } catch (_) { /* nothing there */ }
  if (tallyInHand.id === id) { tallyInHand.id = null; tallyInHand.tally = null; }
  if (tallyInHand.staleId === id) tallyInHand.staleId = null;
  doc.plan.unitSettings = records.map((rec, i) => ({ u: rec.u, held: heldOn[i].length }));
  doc.plan.pricings = doc.plan.unitSettings.reduce((a, x) => a + x.held, 0);
  doc.plan.foldedPerUnit = { at: new Date().toISOString(), dropped, kept };
  if (doc.counts) doc.counts.rows = kept;
  saveSet(doc);
  return { kept, dropped };
}
function ensureTally(id) {
  // A totalling in flight answers FIRST, before any file is touched (the
  // third out-of-memory death): the old order consulted readTally on every
  // poll, and while the stale file was being replaced that meant parsing
  // the whole of it, over and over, beside the fold.
  if (tallyRun) {
    if (tallyRun.id === id) {
      return tallyRun.error ? { failed: tallyRun.error }
        : { totalling: { done: tallyRun.done, total: tallyRun.total, phase: tallyRun.phase || null, word: tallyRun.word || 'parts' } };
    }
    if (!tallyRun.error) return { waiting: `the tables of another record set are totalling right now — one totalling at a time` };
    tallyRun = null;   // a dead attempt for another set does not block this one
  }
  // THE RECORDS COME FIRST (3.44.0): a set still holding settings whose gate
  // ignored the forecast is brought up to date before anything is read from
  // it, in this same slot, so the screen sees one job: the drop, then the
  // tables. A set that never held one is stamped here and never asked again.
  const strip = getSet(id);
  if (strip && strip.stage === 3 && !Array.isArray(strip.gates) && !needsAlwaysStrip(strip)
    && (strip.status === 'done' || strip.status === 'incomplete')) {
    strip.gates = bracketLib.GATES.slice();
    saveSet(strip);
  }
  if (strip && needsAlwaysStrip(strip)) {
    if (batch.batchRunning() || activeSet) return { waiting: 'a run is going — the records are brought up to date when the box is free' };
    const run = { id, done: 0, total: 0, phase: 'removing the settings whose gate ignored the forecast', word: 'parts', startedAt: Date.now(), error: null, promise: null };
    tallyRun = run;
    run.promise = (async () => {
      try {
        await stripAlwaysGate(strip, (dn, tn) => { run.done = dn; run.total = tn; }, { inTallySlot: true });
        if (strip.tallyError) { delete strip.tallyError; saveSet(strip); }
      } catch (err) {
        run.error = String(err.message || err);
        const d = getSet(id);
        if (d && d.tallyError !== run.error) { d.tallyError = run.error; saveSet(d); }
        return;
      }
      // the slot is freed; the next ask finds no tables and totals them
      tallyRun = null;
    })();
    return { totalling: { done: 0, total: 0, phase: run.phase, word: run.word } };
  }
  // THE FOLD IS PER UNIT (3.52.0): a set priced before that holds, on a unit
  // whose shape has no weekday version, both values of 24/5 as two records of
  // one trade, and never says what each unit holds. Brought up to date in this
  // slot, before its tables: the duplicate records dropped, the plan told what
  // each unit holds, the tables re-totalled from what is left.
  const fold = getSet(id);
  if (fold && foldBehind(fold)) {
    if (batch.batchRunning() || activeSet) return { waiting: 'a run is going — the records are folded per unit when the box is free' };
    const run = { id, done: 0, total: 0, phase: 'folding the settings per unit', word: 'parts', startedAt: Date.now(), error: null, promise: null };
    tallyRun = run;
    run.promise = (async () => {
      try {
        await foldRecordsPerUnit(fold, (dn, tn) => { run.done = dn; run.total = tn; });
        if (fold.tallyError) { delete fold.tallyError; saveSet(fold); }
      } catch (err) {
        run.error = String(err.message || err);
        const d = getSet(id);
        if (d && d.tallyError !== run.error) { d.tallyError = run.error; saveSet(d); }
        return;
      }
      tallyRun = null;              // the slot is freed; the next ask finds no tables and totals them
    })();
    return { totalling: { done: 0, total: 0, phase: run.phase, word: run.word } };
  }
  // readTally is the arbiter, not the file's existence: a tally of an older
  // shape sits on disk and still reads as absent, and this is the door the
  // re-totalling walks in through. The parse happens once — it remembers.
  try { if (readTally(id)) return { ready: true }; } catch (_) { /* fall through */ }
  // A TALLY THAT CANNOT BE READ IS NOT A MISSING ONE. Building another produces
  // the same unreadable file, so this says what happened once rather than
  // spending twenty minutes on it again every time the screen asks.
  if (tallyUnreadable && tallyUnreadable.id === id) {
    const msg = `the tables were built and cannot be read back: ${tallyUnreadable.why}`;
    const d = getSet(id);
    if (d && d.tallyError !== msg) { d.tallyError = msg; saveSet(d); }
    return { failed: msg };
  }
  const doc = getSet(id);
  if (!doc || doc.stage !== 3 || (doc.status !== 'done' && doc.status !== 'incomplete')) return { none: true };
  if (batch.batchRunning() || activeSet) {
    return { waiting: 'a run is going — the tables total when the box is free' };
  }
  // over-budget tables refuse HERE too — an out-of-memory death cannot be
  // caught in software, so the gate is the protection, said on the screen
  const gate = tallyBudgetFor({
    settings: (doc.plan || {}).settings || 0,
    coins: Array.isArray((doc.params || {}).universe) ? doc.params.universe.length : 1,
  });
  if (gate.band === 'refuse') {
    if (doc.tallyError !== gate.message) { doc.tallyError = gate.message; saveSet(doc); }
    return { failed: gate.message };
  }
  const run = { id, done: 0, total: 0, phase: null, word: 'parts', startedAt: Date.now(), error: null, promise: null };
  tallyRun = run;
  run.promise = (async () => {
    let pool = null;
    try {
      const blocks = rowstore.blocksOf(id, 'records') || [];
      const settingsCount = (doc.plan || {}).settings || 0;
      if (blocks.length >= 8 && settingsCount <= SHARD_SETTINGS_LIMIT) pool = createPool();
      // WHAT THE MEMBERS ACTUALLY DID COMES FIRST, or the tables would be
      // totalled without it and the column would be empty for a set that
      // could perfectly well have filled it. A set priced before it was
      // measured rebuilds it from its stage 2 parent's kept votes here —
      // ten units, no pricing — and one that already has it skips straight on.
      if (!readAgreed(id)) {
        if (!pool) pool = createPool();
        run.phase = 'reading what the members actually did';
        run.word = 'units';
        try {
          await buildAgreedTable(doc, pool, (dn, tn) => { run.done = dn; run.total = tn; });
          if (doc.agreedError) { delete doc.agreedError; saveSet(doc); }
        } catch (err) {
          // BEST EFFORT, NEVER A BLOCKER. The votes live on the stage 2 parent,
          // and a parent can have been deleted. Tables without one column are
          // worth far more than no tables, so the reason is recorded and said
          // on the screen and the totalling carries on.
          doc.agreedError = String(err.message || err);
          saveSet(doc);
        }
      }
      run.phase = null;
      run.word = 'parts';
      await buildTally(doc, pool, (dn, tn) => { run.done = dn; run.total = tn; });
      if (doc.tallyError) { delete doc.tallyError; saveSet(doc); }
      if (tallyRun === run) tallyRun = null;
    } catch (err) {
      run.error = String(err.message || err);
      doc.tallyError = run.error;
      saveSet(doc);
    } finally {
      if (pool) pool.abort();
    }
  })();
  return { totalling: { done: 0, total: 0 } };
}
// Test hook: settle when the totalling in flight (if any) has finished.
function tallyWait() { return tallyRun && tallyRun.promise ? tallyRun.promise : Promise.resolve(); }

const tallyInHand = { id: null, tally: null, mtimeMs: 0, size: 0, staleId: null, staleMtimeMs: 0, staleSize: 0 };
// ONE OBJECT PER LINE, TAKEN OUT OF THE BUFFER. A Buffer may be gigabytes; a
// STRING may not exceed 536,870,888 characters, so the whole is never turned
// into one. Each line is an entry and no entry is large.
function parseTally(buf) {
  // A LINE IS BOUNDED, AND SO IS LOOKING FOR ONE. The older shape is a single
  // object with no newline in it at all, so scanning to "the end of the first
  // line" is scanning to the end of the FILE — and stringifying that is exactly
  // the thing this function exists to avoid. It threw, the throw read as
  // damage, and damage is the one verdict that does not rebuild: the fix for
  // the unreadable file refused to rebuild the unreadable file (2026-08-30).
  //
  // A header line is about a hundred bytes. No newline in the first 64 KB means
  // the older shape, decided without touching the rest.
  const LOOK = 1 << 16;
  let at = 0;
  const line = () => {
    if (at >= buf.length) return null;
    const e = buf.indexOf(10, at);
    if (e < 0) {
      if (buf.length - at > LOOK) throw new Error('the tally stops without ending its last line');
      const tail = buf.toString('utf8', at, buf.length);
      at = buf.length;
      return tail;
    }
    const str = buf.toString('utf8', at, e);
    at = e + 1;
    return str;
  };
  if (buf.subarray(0, Math.min(buf.length, LOOK)).indexOf(10) < 0) {
    // an older shape: one object for the whole file. A version difference, not
    // damage, so it is rebuilt rather than reported.
    return { v: -1 };
  }
  const first = line();
  if (!first) throw new Error('the tally file is empty');
  const head = JSON.parse(first);
  if (typeof head.ranked !== 'number' || typeof head.coins !== 'number') return { v: -1 };
  const ranked = new Array(head.ranked);
  for (let i = 0; i < head.ranked; i++) {
    const l = line();
    if (l === null) throw new Error(`the tally says it holds ${head.ranked} settings and stops after ${i}`);
    ranked[i] = JSON.parse(l);
  }
  const coins = new Array(head.coins);
  for (let i = 0; i < head.coins; i++) {
    const l = line();
    if (l === null) throw new Error(`the tally says it holds ${head.coins} coin rows and stops after ${i}`);
    coins[i] = JSON.parse(l);
  }
  return { ...head, ranked, coins };
}
// WHY the last unreadable tally could not be read, so it can be said on the
// screen instead of silently answered with another build.
let tallyUnreadable = null;
// WHETHER A SET STILL HOLDS SETTINGS WHOSE GATE IGNORED THE FORECAST, answered
// from a stat of its document rather than a parse of it: the answer is asked
// on every read of every table, and the document of the owner's set carries
// half a million setting names. The strip saves the document, so the stat
// changes and the answer is worked out again exactly once.
const stripPending = new Map();   // id -> { mtimeMs, size, needs }
// A SET BEHIND ON THE PER-UNIT FOLD IS NOT SERVED ITS OLD TABLES (3.52.1).
// The fold runs in the tally slot, and a set that already has tables never
// reaches that slot: S3 #2 was served as it stood after the 3.52.0 deploy and
// never folded. Same door as the strip, cached the same way.
const foldPendingCache = new Map();   // id -> { mtimeMs, size, needs }
function foldPending(id) {
  let st = null;
  try { st = fs.statSync(setFile(id)); } catch (_) { foldPendingCache.delete(id); return false; }
  const hit = foldPendingCache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.needs;
  const needs = foldBehind(getSet(id));
  foldPendingCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, needs });
  return needs;
}
function alwaysStripPending(id) {
  let st = null;
  try { st = fs.statSync(setFile(id)); } catch (_) { stripPending.delete(id); return false; }
  const hit = stripPending.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.needs;
  const needs = needsAlwaysStrip(getSet(id));
  stripPending.set(id, { mtimeMs: st.mtimeMs, size: st.size, needs });
  return needs;
}
function readTally(id) {
  // A totalling in flight is about to replace this very file — nothing reads
  // it meanwhile, least of all the screens' four-second polls.
  if (tallyRun && tallyRun.id === id && !tallyRun.error) return null;
  // TABLES TOTALLED OVER A GATE THE ENGINE NO LONGER HAS ARE NOT SERVED (3.44.0):
  // a set still holding always settings reads as having no tables, so every
  // screen falls through to ensureTally, which brings the records up to date
  // and totals them again. Serving the old tables would show a third of a
  // board the engine cannot price any more, on every screen, indefinitely.
  if (alwaysStripPending(id) || foldPending(id)) return null;
  let st = null;
  try { st = fs.statSync(tallyFile(id)); } catch (_) { return null; }
  if (tallyInHand.id === id && tallyInHand.tally && tallyInHand.mtimeMs === st.mtimeMs && tallyInHand.size === st.size) {
    return tallyInHand.tally;
  }
  // THE VERDICT ON A FILE IS REMEMBERED, STALE OR SERVED (the third
  // out-of-memory death, 2026-08-27 23:25): a tally of an older shape used
  // to be re-parsed on EVERY ask — each poll inflating a hundreds-of-MB
  // JSON beside the re-total's own accumulator — and the service died at
  // the heap limit inside JSON.parse within a minute. One parse decides;
  // a stat answers ever after, until the file itself changes underneath.
  if (tallyInHand.staleId === id && tallyInHand.staleMtimeMs === st.mtimeMs && tallyInHand.staleSize === st.size) return null;
  let t = null;
  let why = null;
  try { t = parseTally(zlib.gunzipSync(fs.readFileSync(tallyFile(id)))); } catch (err) { t = null; why = String(err.message || err); }
  // A tally of an older shape is not served and not cached — it reads as
  // absent, and the rebuild-on-read machinery re-totals it with the columns
  // the screens now show. Serving it would put dashes where numbers belong.
  //
  // A tally that cannot be READ is a different thing entirely, and telling the
  // two apart is the whole difference between rebuilding once and rebuilding
  // for ever: an older shape SHOULD be rebuilt, and something unreadable should
  // be reported, because building it again produces the same unreadable file.
  if (t && t.v !== TALLY_V) { t = null; why = null; }
  tallyUnreadable = why ? { id, mtimeMs: st.mtimeMs, size: st.size, why } : null;
  if (t) {
    tallyInHand.id = id; tallyInHand.tally = t; tallyInHand.mtimeMs = st.mtimeMs; tallyInHand.size = st.size;
  } else {
    tallyInHand.staleId = id; tallyInHand.staleMtimeMs = st.mtimeMs; tallyInHand.staleSize = st.size;
  }
  return t;
}

// ---- deleting a record set (owner order, 2026-08-27: "yes" to the parked
// delete control). Two-step, like deleting a run: asked without the set's
// own id typed back it only reports what would go; a set another set names
// as its parent is refused by name; nothing is deleted while any stage run
// is going, because a run may be reading its parent at that moment.
function childrenOf(id) {
  return listSets().filter((x) => x.parent && x.parent.id === id).map((x) => ({ id: x.id, name: x.name }));
}
function deleteSet(id, confirm) {
  const doc = getSet(String(id || ''));
  if (!doc) throw new Error(`no record set called "${id}"`);
  if (activeSet) {
    throw new Error(`${activeSet.name || activeSet.id} is being written right now — nothing is deleted while a stage run is going`);
  }
  if (tallyRun && !tallyRun.error && tallyRun.id === doc.id) {
    throw new Error(`the tables of ${doc.name} are totalling right now — nothing is deleted while its records are being read`);
  }
  const children = childrenOf(doc.id);
  if (children.length) {
    throw new Error(`${doc.name} is the parent of ${children.map((c) => c.name).join(', ')} — a set another set names as its `
      + 'parent is never deleted. Delete the children first.');
  }
  const rows = rowstore.count(doc.id, 'records');
  const bytes = rowstore.bytes(doc.id);
  if (String(confirm || '') !== doc.id) {
    return {
      preview: true, id: doc.id, name: doc.name, stage: doc.stage, status: doc.status,
      desc: doc.desc || '', rows, bytes, confirmWith: doc.id,
    };
  }
  rowstore.remove(doc.id);
  try { fs.rmSync(tallyFile(doc.id), { force: true }); } catch (_) { /* may not exist */ }
  try { fs.rmSync(setFile(doc.id), { force: true }); } catch (_) { /* reported below */ }
  if (recordsInHand.id === doc.id) { recordsInHand.id = null; recordsInHand.rows = null; }
  if (tallyInHand.id === doc.id) { tallyInHand.id = null; tallyInHand.tally = null; }
  if (tallyInHand.staleId === doc.id) { tallyInHand.staleId = null; }
  return { deleted: true, id: doc.id, name: doc.name, rows, bytes };
}

// POST-RUN NOTES, the same contract the runs have (owner order, 2026-08-04;
// carried to record sets 2026-08-27): freely editable once the set has
// landed, refused while it is being written — the orchestrator saves the doc
// continuously and a concurrent note write would be silently overwritten.
// RENAMING A RECORD SET (owner order, 2026-09-03). The owner's name, checked
// the way a launch checks it, refused while the set is being written or its
// tables are totalling — and refused while the set being written names this
// one as its parent, because that run rewrites its own document as it goes and
// would put the old name back. EVERY SET THAT NAMES THIS ONE AS ITS PARENT
// CARRIES THE NEW NAME TOO (RULE NINE: when a record changes, the records
// change with it): stage 2, 3 and 4 sets each wrote their parent's name at
// launch, and a reader that had to look the parent up to learn its current
// name would be the legacy branch this rule forbids.
function setSetName(id, raw) {
  const doc = getSet(String(id || ''));
  if (!doc) throw new Error('unknown record set');
  const name = String(raw ?? '').trim().slice(0, 80);
  if (!name) throw new Error('a record set needs a name — the box is empty');
  if (doc.status === 'running') throw new Error('the record set is still being written — rename it after it finishes');
  if (tallyRun && !tallyRun.error && tallyRun.id === doc.id) {
    throw new Error(`the tables of ${doc.name} are totalling right now — rename it when they land`);
  }
  if (activeSet && activeSet.parent && activeSet.parent.id === doc.id) {
    throw new Error(`${activeSet.name || activeSet.id} is being written right now and names ${doc.name} as its parent — rename it when that run lands`);
  }
  const taken = nameTaken(name, doc.id);
  if (taken) throw new Error(`a record set called "${name}" already exists (${taken.id}) — pick another name`);
  const was = doc.name;
  doc.name = name;
  doc.nameEditedAt = new Date().toISOString();
  saveSet(doc);
  const childrenRenamed = [];
  for (const row of listSets()) {
    if (!row.parent || row.parent.id !== doc.id) continue;
    const child = getSet(row.id);
    if (!child || !child.parent) continue;
    child.parent.name = name;
    saveSet(child);
    childrenRenamed.push(child.id);
  }
  return { id: doc.id, name, was, nameEditedAt: doc.nameEditedAt, childrenRenamed };
}

function setSetNotes(id, text) {
  const doc = getSet(String(id || ''));
  if (!doc) throw new Error('unknown record set');
  if (doc.status === 'running') throw new Error('the record set is still being written — notes save after it finishes');
  doc.notes = String(text ?? '').slice(0, 20000);
  doc.notesEditedAt = new Date().toISOString();
  saveSet(doc);
  return { id: doc.id, notes: doc.notes, notesEditedAt: doc.notesEditedAt };
}

// ---- reads for Boards ------------------------------------------------------------
function chainOf(id) {
  const out = [];
  let cur = getSet(id);
  while (cur) {
    out.unshift({
      id: cur.id, stage: cur.stage, name: cur.name, status: cur.status,
      createdAt: cur.createdAt, desc: cur.desc || '',
      plan: cur.plan ? { units: cur.plan.units || 0, settings: cur.plan.settings || 0 } : null,
      counts: cur.counts, parent: cur.parent ? { id: cur.parent.id, name: cur.parent.name, orderBy: cur.parent.orderBy || null, carry: cur.parent.carry ?? null, sortedBy: cur.parent.sortedBy || null, selected: cur.parent.selected ?? null, of: cur.parent.of ?? null } : null,
      manifestDigest: cur.dataManifest && cur.dataManifest.overallDigest ? cur.dataManifest.overallDigest.slice(0, 12) : null,
      params: publicParams(cur),
    });
    cur = cur.parent ? getSet(cur.parent.id) : null;
  }
  return out;
}

function stage1Table(id, from, n, filters = null) {
  const doc = getSet(id);
  if (!doc) return null;
  const ranking = rankingOf(id);
  const byU = new Map(allRecords(id).map((r) => [r.u, r]));
  let rows = ranking.map((row, i) => {
    const r = byU.get(row.u) || {};
    return {
      _i: i, u: row.u,
      trade: r.trade, ctx1: r.ctx1, ctx2: r.ctx2, geometry: r.geometry,
      members: (r.specs || []).length, voices: r.voices ?? null,
      score: row.score, beat: row.beat, pairs: row.pairs, lead: row.lead,
      money: r.money ?? null, beatMoney: r.beatMoney ?? null, leadMoney: r.leadMoney ?? null,
    };
  });
  if (Array.isArray(doc.sort) && doc.sort.length) rows = applySort(1, rows, doc.sort, (a, b) => a._i - b._i);
  // the place is settled BEFORE the filters, so a filtered table still says
  // where each row stands in the whole set rather than renumbering itself
  rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const of = rows.length;
  rows = applyFilters(1, rows, filters);
  return {
    total: rows.length, of, from, sort: doc.sort || [],
    // a set written before the tuning-slice money existed says so with its
    // table, and Boards offers to fill it in there (RULE NINE)
    behind: tuningMoneyBehind(doc) ? 'tuning-slice money' : null,
    rows: rows.slice(from, from + n).map(({ _i, ...rest }) => rest),
  };
}

function stage2Table(id, from, n, filters = null) {
  const doc = getSet(id);
  if (!doc) return null;
  let rows = allRecords(id).map((r) => ({
    u: r.u, carriedRank: r.carriedRank, s1rank: r.s1rank,
    trade: r.trade, ctx1: r.ctx1, ctx2: r.ctx2, geometry: r.geometry,
    members: r.specs.length,
    logreg: r.specs.filter((s) => s.model === 'logreg').length,
    boost: r.specs.filter((s) => s.model === 'boost').length,
    voices: r.voices ?? null, voices3: r.voices3 ?? null,
    score3: r.score3, scoreAll: r.scoreAll, helped: r.helped,
    beat: r.beat, pairs: r.pairs, lead: r.lead,
    money3: r.money3 ?? null, moneyAll: r.money ?? null, beatMoney: r.beatMoney ?? null, leadMoney: r.leadMoney ?? null,
  }));
  // the saved sort orders the whole table; best all-members forecast score
  // first when none is saved. Ties keep their carry position either way, so
  // the order is total and two reads page identically.
  if (Array.isArray(doc.sort) && doc.sort.length) {
    rows = applySort(2, rows, doc.sort, (a, b) => a.carriedRank - b.carriedRank);
  } else {
    rows.sort((a, b) => ((b.scoreAll ?? -1e9) - (a.scoreAll ?? -1e9)) || (a.carriedRank - b.carriedRank));
  }
  rows = rows.map((r, i) => { const { carriedRank, ...rest } = r; return { rank: i + 1, ...rest }; });
  const of = rows.length;
  rows = applyFilters(2, rows, filters);
  return {
    total: rows.length, of, from, sort: doc.sort || [], picked: pickedOf(doc),
    behind: tuningMoneyBehind(doc) ? 'tuning-slice money' : null,
    rows: rows.slice(from, from + n),
  };
}

const S3_SORTS = ['share', 'pairs', 'test', 'money', 'trades', 'vslong', 'rows', 'coin', 'setting', 'agreed', 'beatnoise'];
// What each floor on the every-coin table reads, in the shape spreadOf wants.
// The table does its own filtering rather than going through FILTER_DEFS, so
// its columns are named here — and they are named ONCE, beside the floors
// that use them.
const S3_COIN_FILTERS = {
  minShare: ['_sharePct', 'min'], minPairs: ['pairs', 'min'], minTest: ['avgTest', 'min'],
  minHold: ['avgHold', 'min'], minTrades: ['avgTrades', 'min'], minVsLong: ['avgVsLong', 'min'],
  minAgreed: ['avgAgreed', 'min'], minBeatNoise: ['_beatNoisePct', 'min'],
};
function stage3Coins(id, query) {
  const t = readTally(id);
  if (!t) return null;
  const minPairs = Math.max(0, Math.floor(num(query.minPairs, 0)));
  const minShare = query.minShare === '' || query.minShare == null ? null : Number(query.minShare);
  const minHold = query.minHold === '' || query.minHold == null ? null : Number(query.minHold);
  const minTrades = query.minTrades === '' || query.minTrades == null ? null : Number(query.minTrades);
  const minVsLong = query.minVsLong === '' || query.minVsLong == null ? null : Number(query.minVsLong);
  const minAgreed = query.minAgreed === '' || query.minAgreed == null ? null : Number(query.minAgreed);
  const minBeatNoise = query.minBeatNoise === '' || query.minBeatNoise == null ? null : Number(query.minBeatNoise);
  // ONE SETTING'S COINS AND NOTHING ELSE (owner order, 2026-08-30). Matched
  // WHOLE, not by containing: the button that sets it sends a name exactly,
  // and a name that is the start of a longer one would otherwise drag that
  // one's coins in beside it.
  const setting = query.setting === '' || query.setting == null ? null : String(query.setting);
  // avg test $ WAS DECLARED AND NEVER READ (owner, 2026-08-29: "CHECK the
  // Table 3.B filters ... they do not seem to be filtering correctly"). The
  // page drew the box and sent what was typed in it, and nothing here looked:
  // a floor of a million on it removed none of 411,600 rows on the box. Every
  // other floor on this table was measured biting, one at a time.
  const minTest = query.minTest === '' || query.minTest == null ? null : Number(query.minTest);
  const clears = (r) => (minPairs ? r.pairs >= minPairs : true)
    && (setting == null || r.cellLabel === setting)
    && (minTest == null || (r.avgTest != null && r.avgTest >= minTest))
    && (minAgreed == null || (r.avgAgreed != null && r.avgAgreed >= minAgreed))
    && (minShare == null || (r.share != null && r.share * 100 >= minShare))
    && (minHold == null || (r.avgHold != null && r.avgHold >= minHold))
    && (minTrades == null || (r.avgTrades != null && r.avgTrades >= minTrades))
    && (minVsLong == null || (r.avgVsLong != null && r.avgVsLong >= minVsLong))
    // a set that kept no scrambles has not answered this badly -- it was
    // never asked, so a floor on it drops the row rather than reading a zero
    && (minBeatNoise == null || (r.noisePairs > 0 && ((r.beatNoise || 0) / r.noisePairs) * 100 >= minBeatNoise));
  const kept = t.coins.filter(clears);
  const byShare = (a, b) => ((b.share ?? -1) - (a.share ?? -1)) || (b.pairs - a.pairs);
  // The same share the floor reads, so a column cannot rank by one number
  // while the box beneath it filters on another.
  const noiseShare = (r) => (!r.noisePairs ? null : (r.beatNoise || 0) / r.noisePairs);
  const orders = {
    share: byShare,
    pairs: (a, b) => (b.pairs - a.pairs) || byShare(a, b),
    test: (a, b) => ((b.avgTest ?? -1e15) - (a.avgTest ?? -1e15)) || byShare(a, b),
    money: (a, b) => ((b.avgHold ?? -1e15) - (a.avgHold ?? -1e15)) || byShare(a, b),
    trades: (a, b) => ((b.avgTrades ?? -1e15) - (a.avgTrades ?? -1e15)) || byShare(a, b),
    vslong: (a, b) => ((b.avgVsLong ?? -1e15) - (a.avgVsLong ?? -1e15)) || byShare(a, b),
    rows: (a, b) => (b.rows - a.rows) || byShare(a, b),
    agreed: (a, b) => ((b.avgAgreed ?? -1e15) - (a.avgAgreed ?? -1e15)) || byShare(a, b),
    beatnoise: (a, b) => ((noiseShare(b) ?? -1) - (noiseShare(a) ?? -1)) || byShare(a, b),
    coin: (a, b) => String(a.trade).localeCompare(String(b.trade)) || byShare(a, b),
    setting: (a, b) => String(a.cellLabel).localeCompare(String(b.cellLabel)) || byShare(a, b),
  };
  const key = S3_SORTS.includes(query.sort) ? query.sort : 'share';
  // one click on a column sorts it its natural way — best first, or A to Z;
  // a second click turns the whole order the other way (owner order,
  // 2026-08-27). The flip reverses ties too, so the order stays total.
  const cmp = orders[key];
  kept.sort(query.flip ? (a, b) => cmp(b, a) : cmp);
  const from = Math.max(0, Math.floor(num(query.offset, 0)));
  const limit = Math.max(1, Math.min(500, Math.floor(num(query.limit, 100))));
  // keyed on the floors only: the sort and the page reorder and cut the rows,
  // neither changes which rows are in them, so a page turn re-uses the answer.
  const floors = JSON.stringify(Object.keys(S3_COIN_FILTERS).map((k) => query[k] ?? ''));
  const spread = cachedSpread(`3C|${id}|${t.builtAt}|${t.rows}|${floors}`, () => spreadOf(kept, S3_COIN_FILTERS));
  return {
    total: kept.length, removed: t.coins.length - kept.length, from, spread,
    rows: kept.slice(from, from + limit).map(({ b, ...row }) => row),
  };
}

// ---- THE FUNNEL'S VIEW OF A STAGE 3 SET ----------------------------------------
//
// ONE READ RETURNS THE WHOLE STATE OF THE WALK, rather than a route per step.
// The rule is applied in exactly one place, so the survivor count the owner sees
// on step 2 and the one the cut writes cannot be two different numbers.
//
// Everything here reads TEST money. The held-back window is opened once, at the
// cut, on what survives (FUNNEL-DESIGN.md section 2).
// ---- THE UNIT IS THE BOARD (Funnel design §17, owner order 2026-09-02) --------
//
// One rule per coin-and-shape unit. A unit's board is its RECORDS -- one per
// setting, every dial on it, its own test money and its own ten kept figures
// -- read from the blocks the per-coin table says hold that unit. Not Table
// 3.B: that folds the eight decision/band variants of a setting into one row.
// One unit's board is held in memory at a time; asking for another lets the
// first go. Reading yields between blocks so the pages keep answering.
// The unit's identity is the one the whole engine uses (unitKeyOf, above);
// the name beside it is what the screen prints.
const unitNameOf = (u) => `${u.trade}${u.ctx1 ? ` alongside ${u.ctx1}` : ''}${u.ctx2 ? ` and ${u.ctx2}` : ''} ${u.geometry}`;
// Worked out once per tally in hand: the per-coin table is 658,560 rows on
// the owner's set and every read, every board load and every across would
// otherwise walk it again.
// IN THE STAGE 2 TABLE'S ORDER (owner decision, 2026-09-02). The list used to
// follow the order the units happened to finish pricing, reshuffled by which
// totalling part finished first -- an order nobody chose. It is now the
// parent's stage 2 table as Boards shows it: its saved sort, or forecast
// score with all members when none is saved. So the first unit of a set is
// that table's top row, and re-sorting the table on Boards reorders the
// list on the next read. Worked out once per tally in hand and per saved
// sort, because the per-coin table is 658,560 rows on the owner's set.
const unitsOfTally = new WeakMap();
const parentOfSet = (id) => {
  const doc = id ? getSet(id) : null;
  const pid = doc ? ((doc.parent || {}).id || (doc.params || {}).from || null) : null;
  const parent = pid ? getSet(pid) : null;
  return parent && parent.stage === 2 ? parent : null;
};
function unitsOfSet(t, id = null) {
  const parent = parentOfSet(id);
  const sortKey = parent ? JSON.stringify([parent.id, parent.sort || []]) : '';
  const memo = unitsOfTally.get(t);
  if (memo && memo.sortKey === sortKey) return memo.units;
  const seen = new Map();
  for (const c of (t.coins || [])) {
    const key = unitKeyOf(c);
    if (!seen.has(key)) seen.set(key, { key, name: unitNameOf(c), trade: c.trade, ctx1: c.ctx1 || null, ctx2: c.ctx2 || null, geometry: c.geometry, blocks: new Set() });
    for (const b of (c.b || [])) seen.get(key).blocks.add(b);
  }
  let units = [...seen.values()].map((u) => ({ ...u, blocks: [...u.blocks].sort((x, y) => x - y) }));
  if (parent) {
    const place = new Map(stage2Table(parent.id, 0, Number.MAX_SAFE_INTEGER).rows.map((r, i) => [unitKeyOf(r), i]));
    const at = (u) => (place.has(u.key) ? place.get(u.key) : Number.MAX_SAFE_INTEGER);
    units = units.map((u, i) => ({ u, i })).sort((a, b) => (at(a.u) - at(b.u)) || (a.i - b.i)).map((x) => x.u);
  }
  unitsOfTally.set(t, { sortKey, units });
  return units;
}
// A record as a board row: the shape every reading already takes on the
// blended board, so nothing downstream changes. Each measure is the ONE
// record's own -- the same field the blended row averages over its units,
// read here from a single unit, so a column means the same thing on both
// boards. `avgAgreed` is not carried: it lives in the agreed sidecar, joined
// by the totalling, and a board is read from the records alone.
function boardRowOf(r, unitKey) {
  const h = r.holdout || null;
  const held = h && h.pnl != null ? Number(h.pnl) : null;
  return {
    si: r.si, label: r.label, unit: unitKey,
    decision: r.decision ?? null, bandMode: r.bandMode ?? null, weekdaysOnly: r.weekdaysOnly ?? null,
    entry: r.entry ?? null, gate: r.gate ?? null, dMult: r.dMult ?? null, tHours: r.tHours ?? null,
    trailMult: r.trailMult ?? null, armMult: r.armMult ?? null,
    agreeRule: r.agreeRule ?? null, agreeBar: r.agreeBar ?? null, agreePct: r.agreePct ?? null,
    agreeCopy: r.agreeCopy ?? null, agreeBoth: r.agreeBoth ?? null, agreePersist: r.agreePersist ?? null,
    members: r.members ?? null,
    avgRung: r.rung ?? null, avgVoices: r.voices ?? null,
    coins: 1, coinsInMoney: held != null && held > 0 ? 1 : 0,
    avgTest: r.pnl == null ? null : Number(r.pnl),
    avgHold: held,
    avgTrades: h && h.trades != null ? Number(h.trades) : null,
    avgVsLong: h && h.vsAlwaysLong != null ? Number(h.vsAlwaysLong) : null,
    avgLead: r.lead ?? null,
    beat: r.beat ?? null, pairs: r.pairs ?? null,
    noiseTest: Array.isArray(r.noiseTest) ? r.noiseTest : null,
    noiseHold: Array.isArray(r.noiseHold) ? r.noiseHold : null,
  };
}
let unitBoardInHand = { id: null, builtAt: null, key: null, rows: null };
async function loadUnitBoard(id, t, unitKey) {
  if (unitBoardInHand.id === id && unitBoardInHand.builtAt === t.builtAt && unitBoardInHand.key === unitKey && unitBoardInHand.rows) {
    return unitBoardInHand.rows;
  }
  const unit = unitsOfSet(t, id).find((u) => u.key === unitKey);
  if (!unit) throw new Error(`this set holds no unit called '${unitKey}'`);
  unitBoardInHand = { id: null, builtAt: null, key: null, rows: null };   // let the last one go first
  const rows = [];
  for (const bi of unit.blocks) {
    const got = rowstore.readBlocks(id, 'records', [bi]);
    if (!got) throw new Error('the records of this set are not stored in blocks, so a unit board cannot be read from them');
    for (const x of got) {
      const r = x.row;
      if (r.trade !== unit.trade || r.geometry !== unit.geometry || (r.ctx1 || null) !== unit.ctx1 || (r.ctx2 || null) !== unit.ctx2) continue;
      rows.push(boardRowOf(r, unitKey));
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  unitBoardInHand = { id, builtAt: t.builtAt, key: unitKey, rows };
  return rows;
}
// THE BOARD A WALK IS ON: a unit's records, or the blended table. Nothing
// chosen is the set's FIRST unit (§17.2) -- the blend is walked only when it
// is asked for by name, 'all'. The read and the cut both resolve here, so the
// board that was walked and the board that is cut cannot be two boards.
const blendBoard = (t) => ({ unit: null, name: null, all: t.ranked || [] });
async function funnelBoard(id, t, unitKey) {
  const key = unitKey == null ? '' : String(unitKey);
  if (key === 'all') return blendBoard(t);
  const units = unitsOfSet(t, id);
  const unit = key ? units.find((u) => u.key === key) : units[0];
  if (key && !unit) throw new Error(`this set holds no unit called '${key}'`);
  if (!unit) return blendBoard(t);            // a set with no units has only the blend
  return { unit: unit.key, name: unit.name, all: await loadUnitBoard(id, t, unit.key) };
}

// DOES IT HOLD ELSEWHERE, done properly (§17.3): the same rule on each of the
// OTHER units' boards, loaded one at a time and let go. A pressed action, not
// part of the read -- nine boards is nine reads.
async function funnelAcross(id, state = {}, note = null) {
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  const t = readTally(id);
  if (!t) throw new Error('this set has no totalled tables yet');
  const F = require('./funnel');
  const S4 = require('./funnelset');
  const rule = S4.normaliseRule(state.rule);
  // the walked board, resolved exactly as the read resolves it: nothing
  // chosen is the first unit, 'all' is the blend (then every unit is "other")
  const units = unitsOfSet(t, id);
  const chosen = state.unit == null ? '' : String(state.unit);
  const here = chosen === 'all' ? null : (chosen ? (units.find((u) => u.key === chosen) || {}).key || null : (units[0] || {}).key || null);
  if (chosen && chosen !== 'all' && !here) throw new Error(`this set holds no unit called '${chosen}'`);
  // THE REBUILT NUMBERS ARE LAID ON, per unit, so a rule with a limit on the
  // worst losing streak reads each unit's own rather than keeping nothing
  const rich = readFunnelRich(id);
  const out = { unit: here, rule, units: [] };
  const others = units.filter((u) => u.key !== here).length;
  // the same bar the walk is read under, per unit against that unit's own copies
  const barFor = (k) => F.barOf({ k, barPct: state.barPct });
  if (note) note(0, others);
  for (const u of units) {
    if (u.key === here) continue;
    // eslint-disable-next-line no-await-in-loop
    const board = withFunnelRich(await loadUnitBoard(id, t, u.key), rich);
    const kept = S4.applyRule(board, rule);
    const money = (list, moneyOf) => { let s = 0; let n = 0; for (const r of list) { const v = moneyOf(r); if (v != null) { s += v; n++; } } return n ? s / n : null; };
    const real = money(kept, F.money);
    const k = kept.length && Array.isArray(kept[0].noiseTest) ? kept[0].noiseTest.length : 0;
    const copies = Array.from({ length: k }, (_, d) => money(kept, F.moneyAt(d)));
    const beatsN = copies.filter((v) => F.beats(real, v)).length;
    out.units.push({
      unit: u.key, name: u.name, survivors: kept.length, of: board.length, avgTest: real,
      positive: real != null && real > 0,
      check: copies, beats: beatsN, k, bar: k ? barFor(k) : 0, clears: k > 0 && beatsN >= barFor(k),
      lead: F.leadOf(real, copies),
    });
    if (note) note(out.units.length, others);
  }
  const usable = out.units.filter((x) => x.avgTest != null);
  out.positive = usable.filter((x) => x.positive).length;
  out.of = usable.length;
  out.clearBar = usable.filter((x) => x.clears).length;
  out.bar = usable.length && usable[0].k ? usable[0].bar : null;
  out.barPct = F.barPctOf(state);
  // the walked unit's board comes back into hand for the next read
  if (here) await loadUnitBoard(id, t, here);
  return out;
}

// THE ACROSS RUNS IN THE BACKGROUND AND IS POLLED. On the owner's set it is
// nine boards at five or six seconds each -- right at the sixty seconds the
// web server in front allows one request -- so a pressed read that answered
// in one reply would answer with a gateway time-out on the very set it was
// built for. Started, polled, finished: the totalling's shape. One at a time;
// the result is kept for the rule it was read for, and the same rule asked
// again is answered from it without reading a block.
let acrossRun = null;   // { key, token, id, startedAt, done, of, result, error, promise }
function acrossKeyOf(id, state) {
  const S4 = require('./funnelset');
  // the bar is part of what was read: the same rule under another share of
  // the copies is another reading, and must not be answered from this one
  return JSON.stringify([id, state.unit == null ? '' : String(state.unit), S4.normaliseRule(state.rule), require('./funnel').barPctOf(state)]);
}
const acrossStatus = (run) => ({
  running: !run.result && !run.error,
  token: run.token, done: run.done, of: run.of,
  startedAt: new Date(run.startedAt).toISOString(),
  error: run.error, result: run.result,
});
function funnelAcrossStart(id, state = {}) {
  const key = acrossKeyOf(id, state);
  if (acrossRun) {
    // the same rule is the same reading -- unless that reading failed, in
    // which case pressing again tries again rather than re-reading the failure
    if (acrossRun.key === key && !acrossRun.error) return acrossStatus(acrossRun);
    if (!acrossRun.result && !acrossRun.error) throw new Error('the other units are still being read for another rule — one reading at a time');
  }
  const startedAt = Date.now();
  const run = { key, token: `${id}:${startedAt}`, id, startedAt, done: 0, of: 0, result: null, error: null, promise: null };
  acrossRun = run;
  run.promise = funnelAcross(id, state, (done, of) => { run.done = done; run.of = of; })
    .then((result) => { run.result = result; run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return acrossStatus(run);
}
function funnelAcrossStatus(id) {
  if (!acrossRun || acrossRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, error: null, result: null };
  return acrossStatus(acrossRun);
}

async function funnelRead(id, state = {}) {
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  if (doc.stage !== 3) throw new Error(`${doc.name || id} is a stage ${doc.stage} set — the Funnel reads stage 3`);
  // A PARENT BEHIND ON ITS SEALED WINDOW IS FILLED IN FIRST (3.51.0, RULE
  // NINE): announced here, run once in the background, and the page asks again
  const sealing = sealedFillWaiting(doc);
  if (sealing) return { waiting: sealing };
  const t = readTally(id);
  if (!t) return null;                       // the caller starts a totalling, exactly as the tables do

  const F = require('./funnel');
  const S4 = require('./funnelset');
  // THE BOARD IS THE CHOSEN UNIT'S RECORDS (§17), or the blended table when
  // `all units together` is chosen. Nothing below cares which.
  const board = await funnelBoard(id, t, state.unit);
  // THE REBUILT NUMBERS ARE LAID ON FIRST, so a limit on the worst losing
  // streak has something to read (§16, step 6). Rows keep what they carry.
  const rich = readFunnelRich(id);
  const all = withFunnelRich(board.all, rich);
  const step = Math.max(1, Math.min(7, Math.floor(Number(state.step) || 1)));
  // THE CLOSING IS FOLDED IN AT STEP 7 AND NOWHERE ELSE. It is chosen on step 7
  // and it is what step 7 is for, so that is where the count and the sentence
  // have to include it -- what the screen shows before the button is pressed is
  // then the same arithmetic the written set gets. Earlier steps leave it out on
  // purpose: 'tighten the ranges toward the middle' re-derives itself against
  // every setting in the set each time it is asked, and paying that on step 1
  // buys nothing, because the choice cannot be seen or changed there.
  const closed = step === 7
    ? S4.ruleWithClosing(all, state.rule, state.closing, state.target)
    : { rule: S4.normaliseRule(state.rule), key: 'rule', detail: null };
  const rule = closed.rule;
  const rows = S4.applyRule(all, rule);
  const seed = state.seed || id;
  const floor = state.floor == null ? 0 : Math.max(0, Math.floor(state.floor));

  // What this set can be read ACROSS, worked out from what it actually holds --
  // this is what makes a single-coin probe fall through to a weaker check by
  // itself rather than reporting a comparison it never made.
  const coins = new Set();
  const shapes = new Set();
  for (const r of all) { if (r.coins != null) coins.add(r.coins); }
  for (const r of (t.coins || [])) { coins.add(r.trade); shapes.add(r.geometry); }
  const fixed = new Set([...Object.keys(rule.ranges), ...Object.keys(rule.allowed)]);
  const freeDials = F.ALL_DIALS.filter((d) => !fixed.has(d)).length;
  const units = unitsOfSet(t, id).map((u) => ({ key: u.key, name: u.name }));
  // ON A UNIT'S BOARD, "elsewhere" IS THE OTHER UNITS (§17.3), read by a
  // pressed action; the axis logic below is for the blended board only.
  const holdsAxis = board.unit
    ? { axis: 'units', weaker: false, passedOver: [], others: units.filter((u) => u.key !== board.unit).length }
    : F.holdsAxisFor({
      coins: coins.size,
      shapes: shapes.size,
      // the thirds exist once the survivors have been rebuilt and kept
      thirds: rows.some((r) => Array.isArray(r.pnlThirds)),
      freeDials,
    });

  const out = {
    set: {
      id: doc.id,
      name: doc.name,
      stage: 3,
      settings: all.length,
      release: (doc.params || {}).engineVersion || null,
      // named, never left blank -- a missing comparison that shows as nothing
      // reads as "nothing to report", which is the opposite of the truth
      noiseTwin: noiseTwinOf(doc),
      sealed: sealedWindowOf(doc),
    },
    money: 'test',
    // which board this walk is on, by key and by the name the screen prints,
    // and every board the set offers
    unit: board.unit,
    unitName: board.name,
    units,
    step,
    rule,
    ruleSentence: S4.ruleSentence(rule),
    // what the closing did to the rule, in words, so step 7 can state it back
    // rather than the owner pressing the button to find out
    closing: { key: closed.key, detail: closed.detail },
    target: state.target == null ? null : Math.max(0, Math.floor(state.target)),
    survivors: rows.length,
    of: all.length,
    holdsAxis,
    rebuilt: !!(rich && rich.settings),
    reading: null,
    // the conditions a mark is recorded for, worked out for THIS step (§16.5)
    conditions: {},
  };
  if (!rows.length) {
    out.reading = { why: 'this rule keeps nothing, so there is nothing to read' };
    return out;
  }

  // THE CHECK (§3, §16.2): the scrambled copies when the set kept them, the two
  // halves of the settings when it did not. One of the two, named, on every
  // step -- and the same one feeds the recommendation, so there is never a
  // third number to choose.
  const keptN = rows.length && Array.isArray(rows[0].noiseTest) ? rows[0].noiseTest.length : 0;
  out.set.keptScrambles = keptN;
  // NO COPY OF THE BOARD IS EVER BUILT (2026-09-02: ten copies of 524,832 rows
  // at once killed the service twice the first time this tab was opened on
  // the filled set). Every reading takes a money reader; F.moneyAt(d) reads
  // kept scramble d straight off each row. The walk's rule carries no cut
  // before step 7, so reading the survivors by position IS the scrambled copy
  // under the same rule -- ranges, allowed values and the rebuilt-number
  // limits never read the money. Only the cut does, and it is folded in at
  // step 7 alone, where no reading is drawn.
  // THE BAR (owner order, 2026-09-02; a share since 2026-09-04): a value
  // counts when it beats at least the bar's worth of the K copies; the owner
  // sets the share on the screen, it travels with every read, it resolves to
  // a count on this set, and what it clears by chance is said beside it
  const bar = keptN ? F.barOf({ k: keptN, barPct: state.barPct }) : 2;
  // the share travels INSIDE the check, so every reader that resolves it
  // again -- a dial's values, a grid's squares -- lands on the same count
  const check = keptN ? { k: keptN, barPct: F.barPctOf(state), bar } : { seed };
  const kind = F.checkKindOf(check);
  out.check = { kind, k: keptN, barPct: F.barPctOf(state), bar, chance: kind === 'scrambles' ? F.chanceOf(bar, keptN) : null };
  out.conditions.checkIsHalves = kind === 'halves';
  const [ha, hb] = kind === 'halves' ? F.splitHalf(rows, seed) : [null, null];

  if (step === 1) {
    const r1 = F.step1(rows, { seed, top: 3 });
    // THE CHECK AT STEP 1 IS STEP 2'S CHECK ROLLED UP (owner, 2026-09-02: "why
    // would you attract a view to a set-up that varies from the null set IN
    // THE WRONG DIRECTION?"). Movement has no direction -- the forecast can
    // move the piles apart by making them lose more, and a check on movement
    // bolded exactly such a dial. So a dial counts only when at least one of
    // its values makes more money than that same value on every scrambled
    // copy (or sits above both halves' averages): the thing step 2 will
    // actually let the owner keep. The column prints how many of its values
    // do, so a bold row on step 1 is a bold row waiting on step 2.
    const beating = {};
    const counts = {};
    let clear = 0;
    let ofAll = 0;
    for (const x of r1.dials) {
      const c = F.countsFor(rows, x.dial, check, { seed });
      const n = c.values.filter((v) => v.counts).length;
      beating[x.dial] = { n, of: c.values.length };
      counts[x.dial] = n > 0;
      clear += n;
      ofAll += c.values.length;
    }
    r1.beating = beating;
    r1.counts = counts;
    // THE BOARD'S HONESTY IN ONE LINE: how many values clear the bar across
    // every dial, beside how many would with no forecast at all
    r1.honesty = { clear, of: ofAll, byChance: out.check.chance == null ? null : ofAll * out.check.chance };
    r1.noise = { of: keptN, used: keptN, kind };
    out.reading = r1;
    const sh = r1.splitHalf || {};
    out.conditions.halvesDisagree = sh.why ? null : !sh.agrees;
    out.conditions.leadNotEven = r1.dials.length ? (r1.lopsided || []).includes(r1.dials[0].dial) : null;
  } else if (step === 2) {
    const dial = String(state.dial || '');
    const r2 = F.step2(rows, dial, { seed });
    if (!r2.why) {
      // the check's average beside the real one per value, and the range it
      // recommends -- the widest run of neighbouring values that beat it
      r2.rec = F.recommendRange(rows, dial, check, { seed });
      // what each value carries into the next step, so a boundary is set knowing
      // its cost
      r2.noise = { of: keptN, used: keptN, kind };
    }
    out.reading = r2;
    out.conditions.spike = r2.shape === 'spike';
  } else if (step === 3) {
    const a = String(state.dialA || '');
    const b = String(state.dialB || '');
    const g = F.step3(rows, a, b, { floor });
    const readers = kind === 'scrambles' ? Array.from({ length: keptN }, (_, d) => [rows, F.moneyAt(d)]) : [[ha, F.money], [hb, F.money]];
    const checkGrids = (a && b) ? readers.map(([x, m]) => F.step3(x, a, b, { floor, moneyOf: m })) : [];
    const block = (a && b) ? F.recommendBlock(g, checkGrids, kind, { barPct: F.barPctOf(state) }) : null;
    out.reading = { ...g, floorCost: F.floorCost(g, state.floorChoices), checkGrids, block, noise: { of: keptN, used: keptN, kind } };
    // THE DIALS INTERACT when the best block does not span every value the
    // rule currently keeps on both axes -- the good part of one dial sits at
    // particular values of the other
    if (block && block.block) {
      const spansA = block.block.a.from === g.aVals[0] && block.block.a.to === g.aVals[g.aVals.length - 1];
      const spansB = block.block.b.from === g.bVals[0] && block.block.b.to === g.bVals[g.bVals.length - 1];
      out.conditions.interact = !(spansA && spansB);
    } else out.conditions.interact = null;
  } else if (step === 4 && board.unit) {
    // the other units are read on demand (funnelAcross); the page presses for it
    out.reading = { axis: holdsAxis, unit: board.unit, others: holdsAxis.others, why: null, pressed: true, noise: { of: keptN, used: keptN, kind } };
  } else if (step === 4) {
    const slices = sliceRowsFor(rows, t, holdsAxis.axis, rule);
    const real = F.holdsAcross(slices, holdsAxis.axis, { floor });
    // the same count on the check: every scrambled copy, or each half
    const boards = kind === 'scrambles' ? Array.from({ length: keptN }, () => rows) : [ha, hb];
    const checkReads = boards.map((x, i) => F.holdsAcross(
      sliceRowsFor(x, t, holdsAxis.axis, rule, kind === 'scrambles' ? { d: i } : {}), holdsAxis.axis, { floor },
    ));
    out.reading = {
      axis: holdsAxis, slices, floor,
      positive: real.positive, of: real.of, why: real.why,
      check: { kind, positive: checkReads.map((x) => x.positive), of: checkReads.map((x) => x.of) },
      noise: { of: keptN, used: keptN, kind },
    };
  } else if (step === 5) {
    const ordered = F.ORDERED_DIALS.filter((d) => rows.some((r) => r[d] != null));
    // one list of cells at a time, and each is let go before the next is made
    const region = (list, moneyOf = F.money) => require('./plateau').widestRegion(
      list.map((r) => ({ ...r, pnl: moneyOf(r), trades: r.avgTrades == null ? 1 : r.avgTrades })),
      { minTrades: 0, orderedAxes: ordered, categoricalAxes: F.CATEGORICAL_DIALS },
    );
    out.reading = region(rows);
    // THE REGION AS A RULE (§16.4, step 5): its edges on every ordered dial and
    // its values on every word-valued one, with what keeping it would leave
    const keep = S4.regionRule(out.reading, { ordered, categorical: F.CATEGORICAL_DIALS });
    const keepRule = { ...rule, ranges: keep.ranges, allowed: keep.allowed };
    out.reading.keep = { ...keep, keeps: out.reading.size ? S4.applyRule(all, keepRule).length : 0 };
    // ALL of the copies here, unlike the readings above that only compare: "wider
    // than luck" off one copy is a coin toss; "wider than all ten" is the claim
    // the count on Sweep exists to buy. With halves, the size on each half.
    const each = [];
    if (kind === 'scrambles') for (let d = 0; d < keptN; d++) { const r = region(rows, F.moneyAt(d)); each.push(r && r.size != null ? r.size : null); }
    else for (const x of [ha, hb]) { const r = region(x); each.push(r && r.size != null ? r.size : null); }
    const mine = out.reading && out.reading.size != null ? out.reading.size : null;
    out.reading.noise = {
      of: keptN, used: kind === 'scrambles' ? keptN : 2, kind, sizes: each,
      widest: each.reduce((a, v) => (v != null && (a == null || v > a) ? v : a), null),
      beatenBy: mine == null ? null : each.filter((v) => v != null && mine > v).length,
    };
    out.conditions.regionNotWider = mine == null ? null : out.reading.noise.beatenBy < each.length;
  } else if (step === 6) {
    // WHAT THE LIMITS ARE LIMITS ON (3.57.0): a limit in dollars means nothing
    // without the stake, and a count of trades means nothing without the
    // window it was counted over -- so both travel with the step's answer,
    // for the units this reading covers and no others
    // the sealed bounds sit on the stage 2 parent's records, which this
    // already resolves for the set's own choice of units (3.51.0)
    const sealed = sealedWindowOf(doc);
    const mineOnly = board && board.key ? (sealed.units || []).filter((u) => unitKeyOf(u) === board.key) : (sealed.units || []);
    out.reading = {
      rebuilt: out.rebuilt,
      exposure: exposureOf(doc, mineOnly.length ? mineOnly : (sealed.units || []),
        { holdHours: rows.reduce((a, r) => (Number.isFinite(Number(r.tHours)) && Number(r.tHours) > a ? Number(r.tHours) : a), 0) }),
      // WHAT EACH LIMIT WOULD KEEP, read off the survivors themselves
      ladders: {
        maxDrawdown: F.ladderFor(rows, 'maxDrawdown', 'max'),
        avgTrades: F.ladderFor(rows, 'avgTrades', 'min'),
      },
    };
  }
  return out;
}

function sliceRowsFor(rows, t, axis, rule, opts = {}) {
  const F = require('./funnel');
  // a scrambled copy's per-coin money is the kept scramble at position d
  const d = opts.d == null ? null : Math.max(0, Math.floor(Number(opts.d) || 0));
  if (axis === 'thirds') {
    // THE MONEY IN EACH THIRD OF THE WINDOW, from the rebuilt numbers kept beside
    // the set. Each third is one slice across every survivor.
    const w = rows.reduce((m, r) => Math.max(m, Array.isArray(r.pnlThirds) ? r.pnlThirds.length : 0), 0);
    return Array.from({ length: w }, (_, i) => {
      const vs = rows.map((r) => (Array.isArray(r.pnlThirds) ? r.pnlThirds[i] : null)).filter((v) => v != null && Number.isFinite(Number(v)));
      return { key: `third ${i + 1}`, n: vs.length, mean: vs.length ? vs.reduce((a, c) => a + Number(c), 0) / vs.length : null };
    });
  }
  if (axis === 'dials') {
    const fixed = new Set([...Object.keys(rule.ranges || {}), ...Object.keys(rule.allowed || {})]);
    const free = F.ALL_DIALS.find((x) => !fixed.has(x) && new Set(rows.map((r) => F.keyOf(r[x]))).size > 1);
    if (!free) return [];
    const by = F.groupsFor(rows, free, d == null ? F.money : F.moneyAt(d));
    return [...by.entries()].map(([k, vals]) => ({
      key: `${free} ${k}`, n: vals.length, mean: vals.reduce((a, c) => a + c, 0) / vals.length,
    }));
  }
  if (axis === 'coins' || axis === 'shapes') {
    const labels = new Set(rows.map((r) => String(r.label).split(' · ')[0]));
    const by = new Map();
    for (const c of (t.coins || [])) {
      if (!labels.has(c.cellLabel)) continue;
      const k = axis === 'coins' ? c.trade : c.geometry;
      if (!by.has(k)) by.set(k, []);
      const v = d == null ? c.avgTest : ((c.noiseTest || [])[d] ?? null);
      if (v != null) by.get(k).push(v);
    }
    return [...by.entries()].map(([k, vals]) => ({
      key: k, n: vals.length, mean: vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : null,
    }));
  }
  return [];
}

// ---- the rebuilt numbers, kept beside the set --------------------------------
//
// STAGE 3 DOES NOT GROW (ruling 4): the rebuild's numbers -- worst losing
// streak, worst trade, wins, stops, the money in each third -- are never
// written into the records. They were handed to the screen for the proof and
// then thrown away, which left step 6 with nothing to read: a limit on the
// worst losing streak refused every row, because no row carried one.
//
// So they are kept in a SIDECAR beside the set, keyed by setting label, and
// funnelRead lays them onto the survivors before the rule is applied. It is a
// derived file: rebuilt by pressing the button again, never migrated (RULE
// NINE). One number per setting is the average across its units, the same way
// avg test $ is.
const funnelRichFile = (id) => path.join(SETS_DIR, `${String(id).replace(/[^A-Za-z0-9._-]+/g, '_')}.funnelrich.json`);
const RICH_FIELDS = ['maxDrawdown', 'worstTrade', 'bestTrade', 'wins', 'stops', 'grossPerTrade'];
// 2 (3.41.0): each setting's numbers are kept PER UNIT beside the average
// across units, because a unit's board reads its own (§17).
const FUNNEL_RICH_V = 2;
function saveFunnelRich(id, perSetting) {
  const out = { v: FUNNEL_RICH_V, savedAt: new Date().toISOString(), release: require('../package.json').version, settings: {} };
  for (const [label, e] of perSetting) {
    const acc = {};
    const thirds = [];
    for (const u of (e.units || [])) {
      const t = u.rich && u.rich.test;
      if (!t) continue;
      for (const f of RICH_FIELDS) {
        const v = t[f];
        if (v == null || !Number.isFinite(Number(v))) continue;
        if (!acc[f]) acc[f] = { s: 0, n: 0 };
        acc[f].s += Number(v); acc[f].n++;
      }
      if (Array.isArray(t.pnlThirds)) thirds.push(t.pnlThirds);
    }
    const row = {};
    for (const [f, a] of Object.entries(acc)) row[f] = a.n ? a.s / a.n : null;
    // AND PER UNIT (§17): on a unit's board the limits read the unit's own
    // numbers, not an average across ten units. A setting with nothing
    // rebuilt carries nothing -- not an empty table either.
    const units = {};
    for (const u of (e.units || [])) {
      const tt = u.rich && u.rich.test;
      if (!tt) continue;
      const one = {};
      for (const f of RICH_FIELDS) if (tt[f] != null && Number.isFinite(Number(tt[f]))) one[f] = Number(tt[f]);
      if (Array.isArray(tt.pnlThirds)) one.pnlThirds = tt.pnlThirds.slice();
      units[unitKeyOf(u)] = one;
    }
    if (Object.keys(units).length) row.units = units;
    if (thirds.length) {
      const w = Math.max(...thirds.map((x) => x.length));
      row.pnlThirds = Array.from({ length: w }, (_, i) => {
        const vs = thirds.map((x) => x[i]).filter((v) => v != null && Number.isFinite(Number(v)));
        return vs.length ? vs.reduce((a, c) => a + Number(c), 0) / vs.length : null;
      });
    }
    out.settings[label] = row;
  }
  atomicWrite(funnelRichFile(id), JSON.stringify(out));
  return { settings: Object.keys(out.settings).length, fields: RICH_FIELDS };
}
function readFunnelRich(id) {
  let x = null;
  try { x = JSON.parse(fs.readFileSync(funnelRichFile(id), 'utf8')); } catch (_) { return null; }
  // AN OLDER SHAPE READS AS ABSENT, never translated (RULE NINE). The rebuilt
  // numbers are derived from the records, so the screen offers the rebuild
  // again and the file is written back in today's shape -- the same way a
  // tally of an older shape is re-totalled rather than read around.
  return x && x.v === FUNNEL_RICH_V ? x : null;
}
// lay the rebuilt numbers onto rows by label; a row keeps what it already has
function withFunnelRich(rows, rich) {
  if (!rich || !rich.settings) return rows;
  return rows.map((r) => {
    const x = rich.settings[r.label];
    if (!x) return r;
    // a unit board row takes the unit's own rebuilt numbers; the blend takes
    // the average across units
    const src = r.unit && x.units && x.units[r.unit] ? x.units[r.unit] : x;
    const o = { ...r };
    for (const [f, v] of Object.entries(src)) if (f !== 'units' && o[f] === undefined) o[f] = v;
    return o;
  });
}

// ---- THE CUT: writing a Stage 4 set --------------------------------------------
//
// The choices made walking the steps ARE the rule, and the rule is what gets
// written -- not the rows it happened to pick today. A row cannot be
// null-tested; a rule can.
//
// AN EMPTY OR ONE-SETTING RESULT IS WRITTEN WITH A WARNING, NEVER REFUSED
// (owner ruling 6). Refusing would take the decision away invisibly.
async function cutFunnelSet(parentId, state = {}) {
  {
    const sealing = sealedFillWaiting(getSet(String(parentId || '')));
    if (sealing) throw new Error(`${sealing} — the cut waits for it, so the set it writes can say the window is sealed`);
  }
  const busy = stageRunning();
  if (busy) throw new Error(`${busy} is running — the cut reads the same tables it writes from`);
  const parent = getSet(parentId);
  if (!parent) throw new Error(`unknown record set '${parentId}'`);
  if (parent.stage !== 3) throw new Error(`${parent.name || parentId} is a stage ${parent.stage} set — a Funnel set is cut from stage 3`);
  const t = readTally(parentId);
  if (!t) throw new Error(`${parent.name} has no totalled tables yet — there is nothing to cut from`);
  // THE SET IS CUT ON THE BOARD IT WAS WALKED ON: a unit's records, or the blend
  const board = await funnelBoard(parentId, t, state.unit);
  const ranked = withFunnelRich(board.all, readFunnelRich(parentId));

  const S4 = require('./funnelset');
  const seq = seqFor(4);
  const id = `s4-${Date.now().toString(36)}-${seq}`;
  const doc = S4.newFunnelSet({
    id,
    seq,
    // a unit's set says which unit, unless the owner types a name
    name: String(state.name || (board.unit ? `S4 #${seq} - ${board.name}` : `S4 #${seq}`)).slice(0, 120),
    parent,
    release: require('../package.json').version,
    target: state.target,
    seed: state.seed || id,
    boardNull: parent.boardNull || null,
    sealed: sealedWindowOf(parent),
    // one rule per coin-and-shape unit (§17); null means the blended board
    unit: board.unit,
    unitName: board.name,
    // the check this walk was read against, bar included
    check: (() => {
      const k = ranked.length && Array.isArray(ranked[0].noiseTest) ? ranked[0].noiseTest.length : 0;
      const b = k ? require('./funnel').barOf({ k, barPct: state.barPct }) : 2;
      return { kind: k ? 'scrambles' : 'halves', k, barPct: require('./funnel').barPctOf(state), bar: b, chance: k ? require('./funnel').chanceOf(b, k) : null };
    })(),
  });
  // The walk as it happened, forward steps and back-steps alike. Going back is
  // more looking, and the reserve grade can only count what was written down.
  for (const st of (state.steps || [])) S4.recordStep(doc, st);
  for (const b of (state.backSteps || [])) S4.recordBackStep(doc, b);
  // THE MARKS THE WALK WAS CARRIED PAST (§16.5), on the set beside the rule.
  // Only keys the record knows are kept; the words are the record's own.
  for (const m of (state.marks || [])) S4.recordMark(doc, { key: m && m.key, step: m && m.step, detail: m && m.detail });
  // THE CLOSING IS PART OF THE RULE, not a note beside it. A closing recorded
  // on the set but dropped before the arithmetic writes a set whose record
  // claims a narrowing its rule does not carry.
  const closed = S4.ruleWithClosing(ranked, state.rule, state.closing, doc.target);
  doc.rule = closed.rule;
  const survivors = S4.applyRule(ranked, doc.rule);
  S4.finishFunnelSet(doc, survivors, { key: closed.key, detail: closed.detail });
  // THE REPLAY IS CHECKED BEFORE THE SET IS SAVED, not asserted in a test and
  // hoped for in production. A set whose rule does not reproduce its own
  // survivors is a story about a decision rather than the decision.
  const check = S4.replay(doc, ranked);
  if (!check.same) {
    throw new Error(`the rule does not reproduce its own survivors (${check.got} vs ${check.had}) — refusing to write it`);
  }
  doc.replayChecked = { at: new Date().toISOString(), ...check };
  saveSet(doc);
  return doc;
}

function listFunnelSets(parentId = null) {
  return listSets()
    .filter((x) => String(x.id).startsWith('s4-'))
    .map((x) => getSet(x.id))
    .filter((d) => d && (!parentId || ((d.parent || {}).id === parentId)))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function stage3Ranked(id, from, n, filters = null) {
  const doc = getSet(id);
  const t = readTally(id);
  if (!t) return null;
  // The saved sort orders the WHOLE ranked list before the page is cut, so
  // page one really is the top of everything; the fixed rule the totalling
  // wrote (beat its own null set, best first) when nothing is picked. The
  // rows are tagged and untagged around the sort so the cached tally itself
  // is never reordered.
  let rows;
  let sort = [];
  if (doc && Array.isArray(doc.sort) && doc.sort.length) {
    sort = doc.sort;
    rows = applySort(3, t.ranked.map((r, i) => ({ ...r, _i: i })), doc.sort, (a, b) => a._i - b._i);
  } else {
    rows = t.ranked.map((r, i) => ({ ...r, _i: i }));
  }
  const of = rows.length;
  rows = applyFilters(3, rows, filters);
  const spread = cachedSpread(`3R|${id}|${t.builtAt}|${t.rows}|${JSON.stringify(filters || {})}`,
    () => spreadOf(rows, FILTER_DEFS[3]));
  return {
    total: rows.length, of, from, sort, spread,
    agreedError: (doc && doc.agreedError) || null,
    rows: rows.slice(from, from + n).map(({ _i, ...r }) => r),
  };
}

function stage3CoinRows(id, query) {
  const t = readTally(id);
  if (!t) return { indexed: false, why: 'the tables have not been totalled yet' };
  const hit = t.coins.find((k) => k.cellLabel === query.cellLabel && k.trade === query.trade
    && String(k.ctx1 || '') === String(query.ctx1 || '') && String(k.ctx2 || '') === String(query.ctx2 || '')
    && k.geometry === query.geometry);
  if (!hit) return { indexed: false, why: 'no such coin row in this set' };
  const agreedAt = readAgreed(id);
  const keyOf = require('./stagework').agreedKeyOfRecord;
  const got = rowstore.readBlocks(id, 'records', hit.b)
    .map((x) => x.row)
    .filter((r) => r.label.split(' · ')[0] === hit.cellLabel && r.trade === hit.trade
      && String(r.ctx1 || '') === String(hit.ctx1 || '') && String(r.ctx2 || '') === String(hit.ctx2 || '')
      && r.geometry === hit.geometry)
    // joined on the way out, from the same table the tables were totalled
    // from — it is not on the record, and this is the only place it is read
    .map((r) => ({ ...r, ...((agreedAt && agreedAt[`${r.u}|${keyOf(r)}`]) || {}) }));
  return { indexed: true, shown: got.length, rows: got };
}


// ---- FILLING IN THE KEPT SCRAMBLES ON A SET THAT WAS PRICED WITHOUT THEM ----
//
// Owner order, 2026-08-31: "keep 10, do all of it, backfill included", and
// after three failures, 2026-09-01: "redesign the system from the ground up to
// actually save the records ... you can save every single unit and confirm it
// in the code before going forward and wasting another five and a half hours."
//
// IT IS TWO PASSES NOW, AND THE FIRST ONE SAVES.
//
//   1. PRICE AND SAVE, one unit at a time. A unit is priced, its figures are
//      written to their own file, and that file is READ BACK AND CHECKED before
//      the next unit starts. Then the memory goes. One unit is held, never ten.
//   2. REWRITE, reading those files back as the walk needs them.
//
// WHAT THAT BUYS, and each of these is a failure that actually happened:
//
//   * A death at hour four costs minutes. Every unit already saved is verified
//     and skipped on the next attempt, so the work is not lost. The first three
//     attempts each threw away everything they had done.
//   * Memory cannot be the thing that kills it. Holding all ten units of
//     figures was about 560 MB on top of a service already near its ceiling;
//     this holds one, then two during the rewrite.
//   * A unit that saved wrong is caught THERE, at the minute it happened,
//     rather than five hours later against a row that cannot find its figures.
//
// THE REST OF WHAT WAS LEARNED, kept because each cost an evening:
//
//   * The scrambles are a pure function of the set's id, so this is a RULE NINE
//     migration and not a re-run: seedOf is a hash of the name and the shuffle
//     is a seeded Fisher-Yates. Scramble seven is the same scramble seven.
//   * Every unit's rows appear in MORE THAN ONE stretch of the store, because
//     settings added later were appended as a second pass. Measured, not
//     assumed: 328,020 rows a unit in the first, 196,812 in the second.
//   * The rewrite decides its own block boundaries (manualBlocks). Flushing per
//     source block is not enough on its own -- the writer also closes a block
//     once a block's worth of bytes has piled up, and these rows are a fifth
//     bigger, so source blocks split and every recorded block index breaks.
//   * Nothing is swapped until the row count AND the block shape match.
function keptFigsDir(id) {
  return path.join(__dirname, '..', 'data', 'batches', `${String(id).replace(/[^A-Za-z0-9._-]+/g, '_')}__keptfigs`);
}
// A UNIT'S FIGURES ON DISK: the flat Int32Array beside a small note saying what
// it should be. The note is what makes "saved" checkable instead of assumed.
function writeUnitFigures(dir, u, vals, has, meta) {
  const crypto = require('crypto');
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(vals.buffer, vals.byteOffset, vals.byteLength);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  let priced = 0;
  for (let i = 0; i < has.length; i++) if (has[i]) priced++;
  const binTmp = path.join(dir, `unit-${u}.bin.tmp`);
  fs.writeFileSync(binTmp, buf);
  fs.renameSync(binTmp, path.join(dir, `unit-${u}.bin`));
  atomicWrite(path.join(dir, `unit-${u}.json`), JSON.stringify({ ...meta, unit: u, priced, sha, at: new Date().toISOString() }));
  return { sha, priced };
}
// READ BACK AND CHECK, every time -- on the unit just written and on every unit
// the rewrite loads. A file that says one thing and holds another is exactly
// the failure this design exists to make impossible, so it is never trusted on
// the strength of existing.
function readUnitFigures(dir, u, want) {
  const crypto = require('crypto');
  const jf = path.join(dir, `unit-${u}.json`);
  const bf = path.join(dir, `unit-${u}.bin`);
  let note;
  try { note = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (_) { return null; }
  let buf;
  try { buf = fs.readFileSync(bf); } catch (_) { return null; }
  // ANSWERING A DIFFERENT QUESTION is not the same as being damaged, and
  // treating them alike would refuse a run just because the owner changed how
  // many scrambles to keep. Stale gets re-priced; damaged stops everything.
  const stale = [];
  if (note.settings !== want.settings) stale.push(`it is for ${note.settings} settings and this set declares ${want.settings}`);
  if (note.width !== want.width) stale.push(`it holds ${note.width} figures a setting and this asks for ${want.width}`);
  if (note.keep !== want.keep) stale.push(`it kept ${note.keep} scrambles and this asks for ${want.keep}`);
  if ((note.from || 0) !== (want.from || 0)) stale.push(`it starts at scramble ${note.from || 0} and this asks to start at ${want.from || 0}`);
  if (stale.length) return { stale };
  const bad = [];
  // a unit prices only the settings that place different orders on it
  // (3.52.0), so what must have been priced into its file is ITS count
  const mustPrice = want.priced != null ? want.priced : want.settings;
  if (note.priced !== mustPrice) bad.push(`only ${note.priced} of ${mustPrice} settings were priced into it`);
  const expectBytes = want.settings * want.width * 4;
  if (buf.length !== expectBytes) bad.push(`it is ${buf.length} bytes and should be ${expectBytes}`);
  if (!bad.length && crypto.createHash('sha256').update(buf).digest('hex') !== note.sha) {
    bad.push('its contents do not match the fingerprint written beside it');
  }
  if (bad.length) return { bad };
  return { vals: new Int32Array(buf.buffer, buf.byteOffset, buf.length / 4), note };
}

function startKeptScrambleFill(id, wantKeep, opts = {}) {
  const dryRun = !!opts.dryRun;
  const onlyUnit = opts.onlyUnit == null ? null : Math.max(0, Math.floor(Number(opts.onlyUnit)));
  const busy = stageBusy();
  if (busy) {
    throw new Error(`${busy} is running — filling in the kept scrambles reads the same units it does, `
      + 'so it waits rather than competing for them');
  }
  const doc = getSet(id);
  if (!doc || doc.stage !== 3) throw new Error('that is not a stage 3 record set');
  if (doc.status !== 'done') throw new Error(`${doc.name} is ${doc.status} — a fill waits until the set has landed`);
  const here = require('../package.json').version;
  const there = doc.engineVersion || null;
  if (there && firstDigitOf(there) !== firstDigitOf(here)) {
    throw new Error(`${doc.name} was priced by release ${there} and this box runs ${here} — `
      + 'a figure filled in now would come from a different engine than the ones beside it');
  }
  const nullN = Math.max(0, Math.floor(num((doc.params || {}).nullN, 19)));
  const have = Math.max(0, Math.floor(num((doc.params || {}).keepN, 0)));
  const keep = Math.max(0, Math.floor(Number(wantKeep) || 0));
  if (keep > nullN) {
    throw new Error(`this asks to keep ${keep} scrambles from a null set of ${nullN} — `
      + 'there are only as many scrambles to keep as the set was swept with');
  }
  if (!dryRun && keep <= have) {
    throw new Error(`${doc.name} already keeps ${have} — ask for more than that, or there is nothing to fill in`);
  }
  // A TOP-UP PRICES ONLY WHAT THE RECORDS DO NOT HOLD (owner order, 2026-09-02:
  // "a PROPER design would ADD the missing rows, not subject the user to 6
  // hours of waiting again"). Scramble d is a hash of the set's name, so the
  // `have` positions already on every row are exactly what pricing them again
  // would produce. From `have` to `keep - 1` is priced and APPENDED; a fresh
  // fill has from = 0 and adds all of it.
  const from = dryRun ? 0 : Math.min(have, keep);
  const add = keep - from;

  const { parent, records, settings, heldOn } = relaunchShapeOf(doc);
  const blocks = rowstore.blocksOf(id, 'records') || [];
  if (!blocks.length) throw new Error(`${doc.name} has no rows on disk to fill in`);
  const fee = Number((doc.params || {}).fee) || 0;
  const totalRows = blocks.reduce((a, b) => a + (b.rows || 0), 0);

  activeSet = doc;
  doc.status = 'filling';
  const asked = from ? `adding ${add} kept scrambles to the ${from} held` : `filling in ${keep} kept scrambles`;
  doc.progress = `${asked} — starting`;
  doc.perf = {
    unitsDone: 0, unitsTotal: records.length, elapsedMs: 0, etaMs: null, workers: null,
    cyclesDone: 0,
    cyclesTotal: heldOn.reduce((a, h) => a + h.length, 0) * (1 + add * 2), cyclesWord: 'pricings',
  };
  saveSet(doc);

  (async () => {
    const pool = createPool();
    activePool = pool;
    doc.perf.workers = pool.parallel ? pool.workers.length : 1;
    saveSet(doc);
    const t0 = Date.now();
    const SCRATCH = `${id}__keptfill`;
    const FIGS = keptFigsDir(id);
    const NIL = -2147483648;
    const width = add * 2 + 1;           // the ADDED test figures, the added held-back figures, then the re-priced real money
    const disagreed = [];
    let unitsSaved = 0;
    let rowsDone = 0;
    let matched = 0;
    let skipped = 0;
    let padded = 0;                         // rows that held fewer kept figures than the set claimed
    const sw = require('./stagework');
    let phase = 'pricing';
    let note = '';
    let lastSay = 0;
    const say = (force = false) => {
      const now = Date.now();
      if (!force && now - lastSay < 2000) return;
      lastSay = now;
      doc.perf.unitsDone = unitsSaved;
      doc.perf.cyclesDone = heldOn.slice(0, unitsSaved).reduce((a, h) => a + h.length, 0) * (1 + keep * 2);
      doc.perf.elapsedMs = now - t0;
      doc.perf.etaMs = unitsSaved ? Math.round(((now - t0) / unitsSaved) * (records.length - unitsSaved)) : null;
      doc.progress = `${asked} — ${phase}: ${unitsSaved} of ${records.length} units saved`
        + `${note ? `, ${note}` : ''}`
        + `${phase === 'rewriting' ? ` · ${rowsDone.toLocaleString()} of ${totalRows.toLocaleString()} records written` : ''}`
        + ` · ${Math.floor((now - t0) / 60000)}m so far`;
      saveSet(doc);
    };
    // The line ticks whether or not anything has landed: the first thing that
    // lands is half an hour away, and half an hour of a still line reads
    // exactly like a hung job.
    const beat = setInterval(() => { try { say(true); } catch (_) { /* the run reports its own faults */ } }, 10000);
    const stopBeat = () => clearInterval(beat);

    const labelIdx = new Map();
    settings.forEach((st, i) => labelIdx.set(st.label, i));
    if (labelIdx.size !== settings.length) {
      stopBeat();
      throw new Error(`this set declares ${settings.length} settings under ${labelIdx.size} names — `
        + 'the fill joins its figures on the name, so two settings sharing one would take each other\'s');
    }
    // the file is block-wide (a place per setting of the block); what must be
    // priced into it is the unit's own count
    const wantFor = (u) => ({ settings: settings.length, priced: heldOn[u].length, width, keep, from });
    const lanes = Math.max(1, (pool.parallel && pool.workers ? pool.workers.length : 1));

    try {
      // ---- PASS ONE: price a unit, save it, read it back, let it go --------
      for (let u = 0; u < records.length; u++) {
        if (onlyUnit != null && u !== onlyUnit) continue;
        const rec = records[u];
        const already = readUnitFigures(FIGS, u, wantFor(u));
        if (already && already.vals) {
          // ALREADY DONE AND STILL SOUND. This is what makes a death at hour
          // four cost minutes: it is not trusted for existing, it is re-read
          // and re-fingerprinted before it is believed.
          unitsSaved++;
          note = `${rec.trade} was already saved and still checks out`;
          say(true);
          continue;
        }
        if (already && already.stale) {
          note = `${rec.trade} was saved for a different ask (${already.stale[0]}) — pricing it again`;
          say(true);
        }
        if (already && already.bad) {
          throw new Error(`the figures saved for ${rec.trade} are not usable — ${already.bad.join('; ')}. `
            + 'Delete them and run this again rather than filling in from a file that does not say what it holds');
        }
        const base = { ...s3Payload({ doc, parent, rec, settings, fee, nullN }), keepN: keep, keepFrom: from, noiseOnly: true };
        const mine = heldOn[u].map((k) => settings[k]);          // the unit's own list, block places on each
        const per = Math.max(1, Math.ceil(mine.length / lanes));
        const shards = [];
        for (let at = 0; at < mine.length; at += per) shards.push({ ...base, settings: mine.slice(at, at + per) });
        const vals = new Int32Array(settings.length * width).fill(NIL);
        const has = new Uint8Array(settings.length);
        let lanesDone = 0;
        await pool.forEach('s3Unit', shards, (settled, i) => {
          if (!settled || !settled.ok) {
            throw new Error(`unit ${rec.trade}, part ${i + 1} of ${shards.length} failed: `
              + `${settled ? settled.error : 'it returned nothing'}`);
          }
          for (const r of (settled.value.rows || [])) {
            const at = labelIdx.get(r.label);
            if (at === undefined) throw new Error(`unit ${rec.trade} priced "${r.label}", which is not in this set's block`);
            const off = at * width;
            // the task hands back positions from..keep-1 only, in order
            for (let d = 0; d < add; d++) {
              const tv = (r.noiseTest || [])[d];
              const hv = (r.noiseHold || [])[d];
              vals[off + d] = tv == null ? NIL : Math.round(tv * 100);
              vals[off + add + d] = hv == null ? NIL : Math.round(hv * 100);
            }
            vals[off + add * 2] = r.pnl == null ? NIL : Math.round(r.pnl * 100);
            has[at] = 1;
          }
          lanesDone++;
          note = `pricing ${rec.trade}, ${lanesDone} of ${shards.length} parts`;
          say(true);
        });
        note = `saving ${rec.trade}`;
        say(true);
        writeUnitFigures(FIGS, u, vals, has, { settings: settings.length, width, keep, from, trade: rec.trade });
        // READ BACK BEFORE MOVING ON. The owner's words: confirm it in the code
        // before going forward. Not "it returned without throwing" -- read the
        // bytes off the disk and check them against what they claim to be.
        const back = readUnitFigures(FIGS, u, wantFor(u));
        if (!back || !back.vals) {
          throw new Error(`the figures for ${rec.trade} did not read back${back && back.bad ? ` — ${back.bad.join('; ')}` : ''}`);
        }
        let same = back.vals.length === vals.length;
        if (same) for (let i = 0; i < vals.length; i += 977) if (back.vals[i] !== vals[i]) { same = false; break; }
        if (!same) throw new Error(`the figures for ${rec.trade} read back different from what was written`);
        unitsSaved++;
        note = `${rec.trade} saved and checked`;
        say(true);
      }

      // ---- PASS TWO: rewrite the store from the saved figures --------------
      phase = 'rewriting';
      note = '';
      say(true);
      const w = rowstore.writer(SCRATCH, 'records', { manualBlocks: true });
      const loaded = new Map();            // unit -> vals, at most two at a time
      const figuresFor = (u) => {
        if (loaded.has(u)) return loaded.get(u);
        const got = readUnitFigures(FIGS, u, wantFor(u));
        if (!got || !got.vals) {
          if (onlyUnit != null) { loaded.set(u, null); return null; }   // a rehearsal has only one unit's figures
          throw new Error(`the figures for unit ${u} are missing or unusable${got && got.bad ? ` — ${got.bad.join('; ')}` : ''}`);
        }
        // never more than two resident: the store is written unit by unit, so
        // one is in use and one is on its way out
        while (loaded.size >= 2) loaded.delete(loaded.keys().next().value);
        loaded.set(u, got.vals);
        return got.vals;
      };
      for (let bi = 0; bi < blocks.length; bi++) {
        for (const x of rowstore.readBlocks(id, 'records', [bi])) {
          const u = x.row.u;
          const vals = figuresFor(u);
          if (!vals) { w.push({ ...x.row, noiseTest: null, noiseHold: null }); rowsDone++; skipped++; continue; }
          const at = labelIdx.get(x.row.label);
          if (at === undefined) throw new Error(`${x.row.label} is on disk for unit ${u} and this set's block does not declare it`);
          const off = at * width;
          const freshT = [];
          const freshH = [];
          let anyH = false;
          for (let d = 0; d < add; d++) {
            const tv = vals[off + d];
            const hv = vals[off + add + d];
            freshT.push(tv === NIL ? null : tv / 100);
            if (hv !== NIL) anyH = true;
            freshH.push(hv === NIL ? null : hv / 100);
          }
          // APPENDED AFTER WHAT THE ROW ALREADY HOLDS. A row holding fewer than
          // `from` is padded and counted -- reported, never a reason to stop.
          const keptT = sw.appendKept(x.row.noiseTest, from, freshT);
          const keptH = sw.appendKept(x.row.noiseHold, from, freshH);
          if (keptT.padded || keptH.padded) padded++;
          const nT = keptT.arr;
          const nH = keptH.arr;
          if (from && Array.isArray(x.row.noiseHold) && x.row.noiseHold.some((v) => v != null)) anyH = true;
          const nowCents = vals[off + add * 2];
          const wasCents = x.row.pnl == null ? NIL : Math.round(x.row.pnl * 100);
          if (nowCents === NIL || wasCents === NIL || Math.abs(nowCents - wasCents) > 1) {
            disagreed.push({ unit: u, label: x.row.label, stored: x.row.pnl, now: nowCents === NIL ? null : nowCents / 100 });
            if (disagreed.length > 5) {
              throw new Error(`the fill disagrees with what stage 3 stored on ${disagreed.length}+ settings `
                + `(first: ${disagreed[0].label} on unit ${disagreed[0].unit}, ${disagreed[0].stored} then ${disagreed[0].now}) — `
                + 'this is not the same run any more, so nothing is written');
            }
          }
          matched++;
          w.push({ ...x.row, noiseTest: nT, noiseHold: anyH ? nH : null });
          rowsDone++;
        }
        w.flush();          // one flush a block, so the new block holds the rows the old one did
        say();
      }
      w.close();
      if (disagreed.length) {
        throw new Error(`the fill disagrees with what stage 3 stored on ${disagreed.length} setting(s) `
          + `(first: ${disagreed[0].label} on unit ${disagreed[0].unit}) — nothing is written`);
      }
      const before = rowstore.count(id, 'records');
      const after = rowstore.count(SCRATCH, 'records');
      if (before !== after) {
        throw new Error(`the filled store holds ${after} rows and the original holds ${before} — nothing is swapped`);
      }
      const oldBlocks = rowstore.blocksOf(id, 'records') || [];
      const newBlocks = rowstore.blocksOf(SCRATCH, 'records') || [];
      const sameShape = oldBlocks.length === newBlocks.length
        && oldBlocks.every((b, i) => b.rows === newBlocks[i].rows && b.firstRow === newBlocks[i].firstRow);
      if (!sameShape) {
        throw new Error(`the filled store has ${newBlocks.length} blocks against ${oldBlocks.length}, or they hold `
          + 'different rows — every block index already recorded would point somewhere else, so nothing is swapped');
      }
      if (dryRun) {
        doc.status = 'done';
        doc.progress = `PROVING RUN on unit ${onlyUnit}: ${matched.toLocaleString()} rows found their figures, `
          + `${skipped.toLocaleString()} copied through; ${disagreed.length} disagreed with the stored money; `
          + `the rewritten store holds ${after.toLocaleString()} rows in ${newBlocks.length} blocks against `
          + `${before.toLocaleString()} in ${oldBlocks.length}, every block holding the rows it held before. `
          + 'It would have swapped. Nothing was.';
        doc.perf.elapsedMs = Date.now() - t0;
        saveSet(doc);
        try { rowstore.remove(SCRATCH); } catch (_) { /* best effort */ }
        try { fs.rmSync(rowstore.storeDir(SCRATCH), { recursive: true, force: true }); } catch (_) { /* best effort */ }
        return;
      }
      // THE SWAP, last and only once everything above held.
      for (const f of ['records.jsonl.gz', 'records.jsonl.gz.meta.json']) {
        fs.renameSync(path.join(rowstore.storeDir(SCRATCH), f), path.join(rowstore.storeDir(id), f));
      }
      try { fs.rmSync(rowstore.storeDir(SCRATCH), { recursive: true, force: true }); } catch (_) { /* already gone */ }
      try { fs.rmSync(tallyFile(id), { force: true }); } catch (_) { /* no totals yet */ }
      // The saved figures go only AFTER the swap: until then they are the thing
      // that makes a second attempt cheap.
      try { fs.rmSync(FIGS, { recursive: true, force: true }); } catch (_) { /* best effort */ }
      doc.params = { ...(doc.params || {}), keepN: keep };
      if (padded) doc.warnings = [...(doc.warnings || []), `${padded} row(s) held fewer than the ${from} kept figures the set claimed before this fill and were padded with blanks`];
      doc.boardNull = { captured: true, kept: keep, why: null, filledAt: new Date().toISOString(), filledBy: here };
      doc.status = 'done';
      doc.progress = `${from ? `${add} kept scrambles added, ${keep} now` : `${keep} kept scrambles`} filled in — the totals rebuild next`;
      doc.perf.elapsedMs = Date.now() - t0;
      saveSet(doc);
    } catch (e) {
      // THE SAVED FIGURES ARE KEPT. They are checked before they are believed,
      // so keeping them costs nothing and throwing them away is what made each
      // of the first three failures cost the whole run.
      try { rowstore.remove(SCRATCH); } catch (_) { /* best effort */ }
      try { fs.rmSync(rowstore.storeDir(SCRATCH), { recursive: true, force: true }); } catch (_) { /* best effort */ }
      doc.status = 'done';
      doc.progress = `filling in the kept scrambles stopped: ${e.message}`
        + (unitsSaved ? ` — ${unitsSaved} unit(s) are saved and will be reused, so a second attempt starts from there.` : '');
      saveSet(doc);
    } finally {
      stopBeat();
      if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
    }
  })();

  return {
    started: true,
    id,
    keep,
    dryRun,
    onlyUnit,
    units: records.length,
    settings: settings.length,
    pricings: dryRun
      ? (heldOn[0] || []).length * (1 + keep * 2)
      : heldOn.reduce((a, h) => a + h.length, 0) * (1 + keep * 2),
  };
}

module.exports = {
  startKeptScrambleFill,
  feeOrRefuse, tuningMoneyBehind, startTuningMoneyFill, moneyDriftOf,
  // exported so the sort can be checked by BEHAVIOUR rather than by matching
  // the shape of its source, which rotted the moment a second share column
  // arrived
  sortValue,
  sameEngineLine, stageBusy, foldSameTradeSettings, heldOnFor, pricingsOf, foldBehind, foldPending, foldRecordsPerUnit, stampUnitSettingsFromRows, SAME_TRADE_TOLERANCE,
  listSets, getSet, chainOf, stageRunning, cancelStage, markInterrupted,
  startStage1, startStage2, startStage3,
  stage1Table, stage2Table, stage3Ranked, stage3Coins, stage3CoinRows,
  settingsFor, unitsFor, stage3Declared, countDeclared, shapeCellsFor, blockAxesFor, buildTally, readTally, parseTally, TALLY_V, seedOf, S3_SORTS, deleteSet, childrenOf,
  setSetPicked, pickedOf, unitsChoiceOf, stage3RecordsFor, PICK_CHOICES, PICK_LABELS, stage3UnitsFor,
  setSetNotes, setSetName, nextNames, nextFreeName, nameTaken, setSetSort, applySort, validateSort, sortLabel, applyFilters, FILTER_DEFS,
  ensureTally, tallyWait, tallyBudgetFor, storeBudgetFor,
  spreadOf, S3_COIN_FILTERS,
  buildAgreedTable, readAgreed, writeAgreed, relaunchShapeOf, appendMissingSettings, missingSettingsOf,
  missingSettingsIn, nextSettingNumber,
  renamedLabelOf, settingsBehind, renameSettingsToV3, BEHIND_V3,
  rebuildRichFor, proveRebuild, firstDigitOf, funnelRead, sliceRowsFor,
  cutFunnelSet, listFunnelSets, saveFunnelRich, readFunnelRich, withFunnelRich, funnelRichFile,
  unitKeyOf, unitNameOf, unitsOfSet, boardRowOf, loadUnitBoard, funnelBoard, funnelAcross, FUNNEL_RICH_V,
  testWindowOfUnit, exposureOf,
  funnelAcrossStart, funnelAcrossStatus,
  sealedWindowOf, sealedFromUnits, sealedBehind, startSealedFill, sealedFillWaiting, sealedFillPromise, noiseTwinOf, needsBoardNullStamp,
  survivorLabelsOf,
  stampBoardNullOnEverySet, BOARD_NULL_NONE,
  dropUndeclaredSettings, dropSettingsNamed, undeclaredIn, isAlwaysLabel, alwaysLabelsOf, needsAlwaysStrip, stripAlwaysGate, alwaysStripPending,
  tallyRunPromise: () => (tallyRun ? tallyRun.promise : null),
  unfinishedAppend, unfinishedAppendDetail, undoUnfinishedAppend,
  declaredLabelsFor, declaredKeyFor,
  auditRecordSet, auditAgainstBlock,
  // the same pool every heavy job uses, so filling in a block is worked the
  // same way a launch is rather than on the one thread that answers pages
  createPoolForFillIn: () => createPool(),
  RECORDS_V,
};
