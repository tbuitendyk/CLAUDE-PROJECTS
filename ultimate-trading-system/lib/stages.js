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
const { createPool: buildPool } = require('./pool');
const { stampManifest, manifestDiff, pinnedFilesOf, pinnedIntact } = require('./manifest');
const { GEOMETRIES, DEFAULT_PAIRS } = require('./dataset');
const bracketLib = require('./bracket');
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

// ---- PAUSE AND START AGAIN (3.82.0, owner order 2026-09-07) ------------------
//
// "I wanna confirm that we can stop it and restart it without losing the work
// that's been done" -- and it could not be. Everything a stage 3 run had priced
// was on disk as it landed, but two things lived only in memory until the last
// part finished: the agreements each unit reached and the four comparisons for
// each unit. A stop threw both away for every finished unit, and nothing could
// pick a stopped set back up. A deploy, which restarts the service, did the
// same.
//
// Now the run writes those two things, and the order of its units, beside the
// set once a minute and again the moment it is paused or fails -- the
// CHECKPOINT -- and a paused set is started again from its own records and its
// checkpoint: the settings already on disk are kept, the rest are priced, and
// the run finishes through the same tail a launch does (continueStage3).
//
// The checkpoint is written by the run itself. The one run on code older than
// this was paused from outside through Node's own debugger by a one-time tool
// that wrote the same file; the tool went with 3.85.0 (RULE TEN), and the
// history of it is in the commits.
const CHECKPOINT_V = 1;
const CHECKPOINT_EVERY_MS = 60 * 1000;
// IN A FOLDER OF ITS OWN, never beside the set: listSets reads every .json in
// the sets folder as a set, and a checkpoint named <id>-checkpoint.json was
// listed as a second, headless copy of its own set (found by the rehearsal,
// 2026-09-07).
const checkpointFile = (id) => path.join(SETS_DIR, 'checkpoints', `${String(id).replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
function readCheckpoint(id) {
  try {
    const c = JSON.parse(fs.readFileSync(checkpointFile(id), 'utf8'));
    return c && c.v === CHECKPOINT_V && c.id === id && c.agreedMap && c.controlsMap && Array.isArray(c.units) ? c : null;
  } catch (_) { return null; }
}
const hasCheckpoint = (id) => readCheckpoint(id) != null;
// `live` is what the run holds in memory and nowhere else while it prices.
function writeCheckpoint(doc, live) {
  atomicWrite(checkpointFile(doc.id), JSON.stringify({
    v: CHECKPOINT_V, id: doc.id, at: new Date().toISOString(), release: ENGINE_VERSION, writtenBy: 'the run',
    workersN: live.workersN, partsTotal: (doc.perf || {}).partsTotal || 0, partsDone: (doc.perf || {}).partsDone || 0,
    units: live.units, agreedMap: live.agreedMap, controlsMap: live.controlsMap, windowsMap: live.windowsMap || {},
    failures: doc.failures || [], pricedSettings: live.pricedSettings(),
    storeRows: live.storeRows(), storeBlocks: live.storeBlocks(),
  }));
  live.checkpointedAt = Date.now();
}
function checkpointIfDue(doc, live) {
  if (!live) return;
  if (live.checkpointedAt && Date.now() - live.checkpointedAt < CHECKPOINT_EVERY_MS) return;
  writeCheckpoint(doc, live);
}
function dropCheckpoint(id) { try { fs.rmSync(checkpointFile(id), { force: true }); } catch (_) { /* nothing there */ } }
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
        // a paused stage 3 set can be started again when its checkpoint is
        // there; the Sweep's stage 3 box offers exactly those (3.82.0)
        checkpoint: d.stage === 3 && d.status !== 'running' && hasCheckpoint(d.id),
        continued: Array.isArray(d.continued) ? d.continued.length : 0,
        // the stage-engine check's own sets, kept off every screen's list (3.87.0)
        exam: !!d.exam,
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
    // EVERY FIELD THE SWEEP PROVENANCE CHECK READS A STAGE 1 SET BY (owner
    // order, 2026-08-27: the section titles go red at the point of provenance
    // break). `compare` and `trainOn` were missing, and a field the check reads
    // and the service does not send is not a near miss -- it reads as a set
    // that disagrees with the boxes on every draw. Both were added to a run's
    // record without being added here, so every set launched with doubles or
    // triples, and every set trained by the money each trade was worth, painted
    // Stage 2 red the moment its own record set appeared in the box below
    // (owner, 2026-09-06: "STILL RED").
    //
    // theProvenanceCheckIsSentEveryFieldItReads holds the two together: it runs
    // the screen's own check against THIS function's output, so a field added
    // to one side and not the other fails the suite.
    universe: p.universe || null, compare: p.compare || null, geometries: p.geometries || null,
    trainOn: p.trainOn || null,
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
// The guards were once asymmetric and only one direction held: a stage launch
// refused while the older sweep engine was going, and nothing asked the other
// way, so that engine's check read the box as idle in the middle of a nine-hour
// stage 3 — two worker pools against a four-worker allowance, and cache writes
// underneath a job that is reading. That engine is gone (3.97.0); this one
// answer is what every heavy launch left on the box asks.
//
// Returns what is busy, in words fit to put in a refusal, or null.
function stageBusy() {
  if (activeSet) return `stage run ${activeSet.id}`;
  if (examBusy()) return examBusy();
  if (tallyRun && !tallyRun.error) return `the totalling of ${tallyRun.id}`;
  // 3.81.0, owner order: "other loads are not allowed" while step 6's press is
  // working. Named HERE rather than in a second gate of its own, so every
  // refusal already built on stageBusy()/claimOrRefuse() -- the stage launches,
  // the purge, the box-busy readout -- covers it without being told twice.
  const rich = richBusy();
  if (rich) return rich;
  // and the ranking read (3.102.0, owner order 2026-09-10: "when it's running,
  // you have to block other long jobs"). It reads every board of a set off
  // disk -- minutes on a set of three hundred coins and shapes -- so it is
  // named here beside the pricing pass rather than in a gate of its own.
  const held = holdBusy();
  if (held) return held;
  return null;
}
function claimOrRefuse(params = {}) {
  // the stage-engine check's own launches carry exam: true; nothing else launches while it runs (3.87.0)
  if (examBusy() && !(params && params.exam)) throw new Error(`${examBusy()} is going right now — one heavy job at a time`);
  if (activeSet) throw new Error(`stage run ${activeSet.id} is going right now — one heavy job at a time`);
  if (tallyRun && !tallyRun.error) {
    throw new Error(`the tables of ${tallyRun.id} are totalling right now — one heavy job at a time. They appear on Boards when it lands.`);
  }
  // and where "sweep processor" "runs on" (3.99.0), before anything is written
  sweepHereOrRefuse();
}
// THE COMPUTE TAB'S "sweep processor" CHOICE IS READ HERE (3.99.0, owner order
// 2026-09-08: the Compute tab is tied to the three-stage engine, the only
// engine there is). A run may only start here while that choice points at this
// machine; otherwise the launch refuses, naming the platform as the dropdown
// shows it, instead of quietly running here anyway. Three readers, one
// definition: the launches' shared gate above (the three stages, a continue, a
// fill-in, the step-6 press) refuses before anything is written; the
// stage-engine check's status carries it, so its press sleeps on it and the
// deploy gate sees it; and createPool() below refuses to build the workers at
// all, so a launch that reaches for them by another road -- the totalling, a
// Stage 4 rebuild, the ride, the unread grade, the capture, the half-life run,
// the kept-scramble fill -- stops there. The retired engine's launcher read
// this before 3.97.0; nothing read it between.
function sweepHereOrRefuse() {
  const elsewhere = require('./compute').sweepRunsHereOr();
  if (elsewhere) throw new Error(elsewhere);
}
// every worker pool this file builds comes through here, so the backstop holds
// for every launch, whichever gate it came in by
function createPool() {
  sweepHereOrRefuse();
  return buildPool();
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

// WHAT IS TRADED AND WHAT IT IS READ AGAINST ARE TWO LISTS (owner order,
// 2026-09-06: "just make two boxes: trade coins and compare coins so LTCUSDT
// can be compared to the universe of others").
//
// They used to be one, and the coins a unit was read against were always the
// other members of that same list. So asking for ONE coin against everything
// else was impossible: with one coin in the list there was no second or third
// to draw, doubles and triples produced nothing at all, and the launch refused
// with "the universe and sizes produced no units" -- which is true, useless,
// and reads as a fault in the system rather than in the boxes.
//
// `compare` defaults to `trade` when it is not given, so a run that names one
// list behaves exactly as every run before this did.
function unitsFor(trade, sizes, geometries, compare = null) {
  const combos = [];
  const u = trade;
  // BLANK COMPARE COINS MEANS THE UNIVERSE (owner, 2026-09-06: "BLANK = THE
  // UNIVERSE"). The trade box already reads blank as all the default pairs and
  // says so on its own label; the compare box reads it the same way, because a
  // coin typed into trade coins with nothing beside it is somebody asking for
  // that coin against everything, which is the whole reason this box exists.
  const c = (compare && compare.length) ? compare : DEFAULT_PAIRS;
  // a coin is never read against itself, whichever list it came from
  const others = (a) => c.filter((x) => x !== a);
  if (sizes.singles) for (const a of u) combos.push({ trade: a, ctx1: null, ctx2: null, size: 1 });
  if (sizes.doubles) for (const a of u) for (const b of others(a)) combos.push({ trade: a, ctx1: b, ctx2: null, size: 2 });
  if (sizes.triples) {
    for (const a of u) {
      const rest = others(a);
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) combos.push({ trade: a, ctx1: rest[i], ctx2: rest[j], size: 3 });
    }
  }
  const units = [];
  for (const co of combos) for (const g of geometries) units.push({ ...co, geometry: g });
  return units;
}
// Every coin a run actually touches, read off the UNITS it built rather than
// off the boxes it was given. The price-file record is stamped over this -- a
// run that read a coin whose candles are not in its own fingerprint could be
// handed different data later and nothing would notice, and a run fingerprinted
// over coins it never opened refuses for a file it never read.
const coinsOfUnits = (units) => [...new Set((units || []).flatMap((u) => [u.trade, u.ctx1, u.ctx2]).filter(Boolean))].sort();
// A CHILD READS EXACTLY THE COINS ITS PARENT'S UNITS NAME, so its fingerprint
// is over the same set and the two can be compared at all. Read from the
// parent's own plan; a parent too old to carry one falls back to its trade
// coins, which is what it would have been stamped over then.
const coinsOfParent = (parent) => {
  const list = ((parent || {}).plan || {}).unitList;
  const got = coinsOfUnits(list);
  return got.length ? got : [...new Set(((parent || {}).params || {}).universe || [])].sort();
};
// THE COINS TO RE-FINGERPRINT ARE THE ONES THE RECORD ALREADY NAMES (3.77.1,
// owner 2026-09-06: "this message on the s3 sweep is wrong ... the price files
// changed since S2 #1 was written (all 16 coins listed)").
//
// Nothing had changed. A stage 1 set's plan carries its unit list, so
// coinsOfParent reads all seventeen coins off it and that is what the set is
// fingerprinted over. A STAGE 2 set's plan carries only a count -- there is no
// unit list on it -- so coinsOfParent fell through to its trade coins and
// returned ONE. The stage 3 launch then held a seventeen-coin fingerprint up to
// a one-coin fingerprint, found sixteen coins in the first and not the second,
// and reported them as price files that had changed. Every stage 3 launch out
// of a stage 2 set was refused, on a comparison that was never like for like.
//
// The stored record lists exactly which coins were fingerprinted. Re-stamping
// THOSE answers the only question being asked -- have those files moved --
// and the two sides cover the same coins by construction, so the comparison
// can never again be between different sets of them.
const coinsFingerprinted = (doc) => {
  const was = ((doc || {}).dataManifest || {}).symbols;
  const names = was && typeof was === 'object' ? Object.keys(was) : [];
  return names.length ? names.sort() : coinsOfParent(doc);
};
// AND A COVERAGE DIFFERENCE IS NOT A PRICE-FILE CHANGE. Lumping the two
// together is what let the fault above read as a data problem for a whole
// afternoon. `changed` is a file that moved; a coin on one side and not the
// other is the two fingerprints not covering the same ground, which is a fault
// in the asking, not in the data, and it says so.
// A RUN READS THE PRICE FILES IT WAS LAUNCHED ON (3.84.0, owner report
// 2026-09-07: "the price files changed since S3 #1c was written (LTCUSDT) ...
// that is false"). The complaint below names the pinned files that have
// changed or gone, never a coin, and never a file that has merely appeared
// beside them -- that one is not this run's.
function pinComplaint(check, name) {
  if (check.why) return `${name} cannot be proved unchanged: ${check.why}`;
  const list = (xs) => xs.slice(0, 5).join(', ') + (xs.length > 5 ? ` and ${xs.length - 5} more` : '');
  const parts = [];
  if (check.changed.length) {
    parts.push(`${check.changed.length} of the price files ${name} was launched on ${check.changed.length === 1 ? 'has' : 'have'} changed since (${list(check.changed)})`);
  }
  if (check.gone.length) parts.push(`${check.gone.length} of the price files ${name} was launched on ${check.gone.length === 1 ? 'is' : 'are'} gone (${list(check.gone)})`);
  return parts.join(', and ');
}
// the pin a unit's task carries: the path of its set's stamp detail, the
// list of files the launch read. A set that was never stamped carries none
// and reads what is on disk, as it always did.
const pinOf = (doc) => { const dm = (doc || {}).dataManifest; return dm && !dm.error && typeof dm.detailFile === 'string' ? dm.detailFile : null; };
// A CHILD IS STAMPED OVER EVERY COIN ITS PARENT WAS STAMPED OVER (3.84.1,
// found on the box the hour 3.84.0 shipped): S3 #1c's own stamp named one
// coin, LTCUSDT, while every one of its units read sixteen more alongside it,
// because the launch fell back to the parent's trade coin. A pin over one
// coin leaves sixteen reading whatever is on disk. The parent's pin names the
// coins its units read; a parent without one is read over its unit list, as
// before.
function childStampFor(id, parent) {
  const parentPin = pinnedFilesOf(parent.dataManifest);
  const coins = parentPin && Object.keys(parentPin).length ? Object.keys(parentPin).sort() : coinsOfParent(parent);
  return stampManifest(id, coins, { onlyFiles: parentPin });
}
function manifestComplaint(diff, name) {
  if (diff.changed.length) {
    return `the price files changed since ${name} was written (${diff.changed.join(', ')})`;
  }
  const off = [...diff.onlyA, ...diff.onlyB];
  return `the price-file record of ${name} covers ${diff.onlyA.length ? 'coins this check did not read' : 'fewer coins than this check read'}`
    + ` (${off.join(', ')}) — the two were not measured over the same coins, so nothing can be concluded about the data`;
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
  // A STOPPED STAGE 3 RUN THAT KEPT ITS CHECKPOINT IS PAUSED, NOT CANCELLED
  // (3.82.0): the word says what can be done with it. Everything else ends the
  // way it always did.
  doc.status = doc.cancelRequested ? (doc.stage === 3 && hasCheckpoint(doc.id) ? 'paused' : 'cancelled') : 'error';
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

// ---- STAGE 1 --------------------------------------------------------------------
function startStage1(params) {
  claimOrRefuse(params);
  const universe = Array.isArray(params.universe) && params.universe.length
    ? params.universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : DEFAULT_PAIRS;
  // THE COINS EACH TRADED COIN IS READ AGAINST (3.75.0, owner order). Left
  // empty it is the traded coins themselves, which is what every run before
  // this did — so an old set relaunched from its own params comes out
  // identical, and nothing on disk means anything different than it did.
  const compare = Array.isArray(params.compare) && params.compare.length
    ? params.compare.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : [];
  // THE FABRICATED COINS NEVER MEET A REAL RUN (3.87.0): the stage-engine
  // check's pair carry a known rule, so any board
  // they sat on would be judging fiction. The old launcher has refused them
  // since 2026-08-03; this one refuses them too, unless the exam is launching.
  {
    const G = require('./stagegate');
    const reserved = [...universe, ...compare].find((s) => G.isExamSymbol(s));
    if (reserved && !params.exam) {
      throw new Error(`${reserved} is a reserved fabricated coin — it never enters a real run (the stage-engine check is how they are used)`);
    }
  }
  const sizes = {
    singles: !!(params.sizes || {}).singles,
    doubles: !!(params.sizes || {}).doubles,
    triples: !!(params.sizes || {}).triples,
  };
  if (!sizes.singles && !sizes.doubles && !sizes.triples) throw new Error('tick at least one of singles / doubles / triples');
  const geometries = params.permuteGeometry
    ? Object.keys(GEOMETRIES)
    : [GEOMETRIES[params.geometry] ? params.geometry : 'daily-4d'];
  // THE 80/20 LAYOUT IS GONE (owner order, 2026-09-08). It kept no held-back
  // slice, so nothing cut from it could be verified; refused by name rather
  // than quietly relaid, so a launch that still asks for it hears why.
  if (params.windowLayout === 'legacy80') throw new Error('the 80/20 window layout was removed: it keeps no held-back slice, so nothing cut from it could ever be verified — choose 70/15/15 or 61/13/13/13');
  const windowLayout = ['split70', 'reserve61'].includes(params.windowLayout) ? params.windowLayout : 'reserve61';
  const nullN = Math.max(0, Math.floor(num(params.nullN, 19)));
  const fee = feeOrRefuse(params.fee, 'it prices the tuning-slice $ every unit is read by');
  // WHAT EACH TRAINING WEEK IS WORTH (3.69.0, owner order). `direction` is what
  // every set before this was trained under: every week one lesson, whatever
  // it was worth. `money` weighs each week by the gap between the best and the
  // worst its decision could have done, in dollars -- so a landslide teaches
  // more than a crumb. Refused rather than coerced: a mistyped word must not
  // quietly train a whole run the old way while the record says otherwise.
  const sw = require('./stagework');
  const trainOn = params.trainOn === undefined || params.trainOn === null || params.trainOn === ''
    ? 'direction' : String(params.trainOn);
  if (!sw.TRAIN_ON.includes(trainOn)) {
    throw new Error(`"${trainOn}" is not a way to train (${sw.TRAIN_ON.join('/')})`);
  }
  const weightCap = params.weightCap === undefined || params.weightCap === null || params.weightCap === ''
    ? sw.WEIGHT_CAP_DEFAULT : Number(params.weightCap);
  if (!Number.isFinite(weightCap) || weightCap < 0) {
    throw new Error(`the most one week may count for must be 0 or more — got ${JSON.stringify(params.weightCap)}`);
  }
  const p = {
    allLoaded: params.allLoaded !== false,
    startMonth: params.startMonth || '2018-01',
    endMonth: params.endMonth || '2026-06',
    windowLayout,
    trainOn,
    weightCap,
  };
  const units = unitsFor(universe, sizes, geometries, compare);
  // WHAT THE RUN ACTUALLY READ, WRITTEN DOWN. A set that recorded an empty box
  // would depend for ever on what empty happened to mean the day it is read
  // back (RULE NINE: a record says what it is, in today's words).
  const compareUsed = (compare.length ? compare : DEFAULT_PAIRS)
    .filter(() => sizes.doubles || sizes.triples);
  // A REFUSAL SAYS WHICH BOX IS WRONG AND BY HOW MUCH (owner, 2026-09-06:
  // "what's this nonsense?"). "the universe and sizes produced no units" is
  // true and useless: it names both boxes, neither number, and nothing to do
  // about it. Every way of getting here is a coin count that cannot fill the
  // shape asked for, so the sentence says exactly that.
  if (!units.length) {
    const reads = (compare.length ? compare : DEFAULT_PAIRS);
    const need = sizes.triples ? 3 : sizes.doubles ? 2 : 1;
    const what = sizes.triples ? 'triples' : sizes.doubles ? 'doubles' : 'singles';
    // the coins that are actually AVAILABLE to read a traded coin against: a
    // compare list holding only the coin being traded offers it nothing
    const spare = reads.filter((x) => !universe.includes(x)).length;
    throw new Error(`nothing to score: ${what} reads each traded coin against `
      + `${need - 1} other ${need - 1 === 1 ? 'coin' : 'coins'}, and compare coins offers `
      + `${spare} that ${spare === 1 ? 'is' : 'are'} not itself (${reads.join(', ') || 'nothing'})`
      + `${compare.length ? '' : ' — all 17 default pairs, because compare coins is blank'}. `
      + `Put ${need - 1} or more other coin(s) in compare coins, or tick singles.`);
  }

  const setName = nameOrRefuse(params.name, 1);
  const seq = seqFor(1);
  const id = `s1-${Date.now().toString(36)}-${seq}`;
  const doc = {
    id, stage: 1, seq, name: setName,
    createdAt: new Date().toISOString(),
    status: 'running', progress: 'writing the plan',
    desc: String(params.desc || ''),
    engineVersion: ENGINE_VERSION,
    exam: !!params.exam,
    measurements: MEASUREMENTS_VERSION,
    boardNull: { ...BOARD_NULL_NONE },
    // The owner's current campaign name rides on every launch, exactly as it
    // does on the sweeps (owner order, 2026-08-04; carried here 2026-08-27).
    params: { universe, compare: compareUsed, sizes, geometries, windowLayout, nullN, fee, ...p, campaign: require('./campaign').getCampaign() || null },
    seed: seedOf(id),
    plan: { units: units.length, unitList: units },
    perf: {
      unitsDone: 0, unitsTotal: units.length, elapsedMs: 0, etaMs: null, workers: null,
      cyclesDone: 0, cyclesTotal: units.reduce((nn, uu) => nn + trainingsPerUnit(uu.size), 0), cyclesWord: 'trainings',
    },
    failures: [],
    counts: null,
  };
  doc.dataManifest = stampManifest(id, coinsOfUnits(units));
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
      geometry: u.geometry, params: p, seed: doc.seed, unitKey: unitKeyOf(u), nullN, fee, pin: pinOf(doc),
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
          bandPct: res.bandPct, counts: res.counts, reserve: res.reserve || null, windows: res.windows || null,
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

// ---- THE UNITS A RUN LOST, PUT BACK (3.73.0) --------------------------------
//
// Owner order, 2026-09-06: "can you give me a button to fix issues like that
// without wasting another 18 hours on a run?"
//
// A stage 1 unit that dies takes nothing else with it -- the other ten thousand
// are whole and on disk -- but the SET is stamped incomplete, and a stage 2
// launch refuses an incomplete parent. So eighteen units out of 10,200 cost the
// whole run. That is the wrong price for the mistake.
//
// This re-runs exactly the units that are absent, under the set's OWN saved
// choices, and appends them. Nothing already on disk is read, touched or
// trained again.
//
// WHY IT MUST USE THE SET'S OWN CHOICES AND NOT TODAY'S BOXES. The units
// already here were trained on a particular window; ones trained on a different
// window would sit in the same table, be ranked against them, and be carried to
// stage 2 beside them, with nothing anywhere able to tell them apart. A fill-in
// that reads the boxes is not a fill-in, it is a second run wearing the same
// name. The three things that would make the new units incomparable are checked
// before anything runs, and each refuses by name.

// Which of a stage 1 set's planned units have no record. A record carries its
// own place in the plan (`u`), so this is subtraction, not guesswork.
function missingUnitsOf(doc) {
  if (!doc || doc.stage !== 1) return null;
  const list = ((doc.plan || {}).unitList) || [];
  if (!list.length) return null;
  // THE ANSWER MUST NOT COME OUT OF A LIST THAT PREDATES THE FILL. Records are
  // held in hand between reads, and this is the one question asked BEFORE and
  // AFTER rows are appended -- so a cache that did not notice the append would
  // report the same gaps for ever and the set would never be stamped finished.
  // The row count is metadata, so asking costs nothing.
  if (recordsInHand.id === doc.id && recordsInHand.rows
    && recordsInHand.rows.length !== rowstore.count(doc.id, 'records')) {
    recordsInHand.id = null; recordsInHand.rows = null;
  }
  const have = new Set(allRecords(doc.id).map((r) => r.u));
  const missing = [];
  for (let i = 0; i < list.length; i++) if (!have.has(i)) missing.push({ i, unit: list[i] });
  return { total: list.length, have: have.size, missing };
}

// The reason this set cannot be filled in, or null. Said as one sentence the
// screen prints, because a button that refuses without saying why is worse
// than no button.
function unitFillRefusal(doc) {
  if (!doc || doc.stage !== 1) return 'only a stage 1 record set holds units to put back';
  if (doc.status === 'running') return `${doc.name} is still going`;
  const pm = doc.measurements || 0;
  if (pm !== MEASUREMENTS_VERSION) {
    return `${doc.name} was built on measurement block ${pm || 'v2 or older'} and this box builds ${MEASUREMENTS_VERSION} — `
      + 'a unit trained here would be trained on numbers the rest of the set has never seen. Start a new stage 1.';
  }
  if (doc.engineVersion && !sameEngineLine(doc.engineVersion, ENGINE_VERSION)) {
    return `${doc.name} was written by engine ${doc.engineVersion} and this box runs ${ENGINE_VERSION} — `
      + 'a unit trained here could not be compared with the ones already in it.';
  }
  // the filled-in units read the same pinned files the rest of the set read
  // (3.84.0); the only question is whether those files are still intact
  if (!doc.dataManifest || doc.dataManifest.error || !doc.dataManifest.symbols) {
    return `${doc.name} carries no readable price-file record, so nothing can prove the data is unchanged`;
  }
  const pinned = pinnedIntact(doc.dataManifest);
  if (!pinned.intact) {
    return `${pinComplaint(pinned, doc.name)} — a unit trained on other data would not be comparable `
      + 'with the ones already in it, so this refuses rather than mixing them.';
  }
  return null;
}

// THE ORDERING, REBUILT BESIDE THE SET, VERIFIED, THEN SWAPPED IN.
//
// It has to be rebuilt rather than appended to: it is one row per unit in
// score order, so a unit put back anywhere changes every rank after it, and
// appending would leave the new units at the bottom whatever they scored.
//
// NEVER rowstore.remove(). It takes ONE argument -- the record set -- and
// deletes the WHOLE store directory: the records, the votes, the tau votes and
// the models, all of them. There is no per-store remove and there never was.
// Written here as `rowstore.remove(id, 'ranking')` on 2026-09-06, in the belief
// that the second argument named one store, it destroyed an eighteen-hour run
// of 10,200 units the first time the owner pressed the control. The warning was
// already in this file, beside a pass that had always got it right, and I wrote
// the call anyway.
//
// So: the files are named one at a time, the new ordering is written under its
// own name, its row count is checked against what it was built from, and only
// then does it take the real name -- one rename, atomic, nothing removed first.
// That is the same shape RULE NINE demands of a record store, and the same shape
// every pass that rewrites one uses.
const RANKING_SPARE = 'ranking-rebuilding';
function wipeOneStore(id, name) {
  for (const f of [rowstore.plainFile(id, name), `${rowstore.plainFile(id, name)}.meta.json`,
    rowstore.gzFile(id, name), `${rowstore.gzFile(id, name)}.meta.json`]) {
    try { fs.rmSync(f, { force: true }); } catch (_) { /* nothing there */ }
  }
}
async function rebuildRanking(id, records) {
  const all = records.slice();
  // the SAME total order the launch settles on: beat, then lead, then the
  // unit's own place in the plan -- so two runs of one set rank identically
  all.sort((a, b) => (b.beat - a.beat) || ((b.lead ?? -1e9) - (a.lead ?? -1e9)) || (a.u - b.u));
  wipeOneStore(id, RANKING_SPARE);          // anything a stopped run left behind
  const rk = rowstore.writer(id, RANKING_SPARE);
  for (let r = 0; r < all.length; r++) {
    rk.push({
      rank: r + 1, u: all[r].u, beat: all[r].beat, pairs: all[r].pairs, lead: all[r].lead, score: all[r].score,
      money: all[r].money, beatMoney: all[r].beatMoney, leadMoney: all[r].leadMoney,
    });
  }
  await rk.close();
  // VERIFY BEFORE ANYTHING IS REPLACED
  const got = rowstore.count(id, RANKING_SPARE);
  if (got !== all.length) {
    wipeOneStore(id, RANKING_SPARE);
    throw new Error(`the rebuilt ordering holds ${got} row(s) and the set holds ${all.length} record(s) — the ordering was left exactly as it was`);
  }
  const from = rowstore.storeFile(id, RANKING_SPARE);
  if (!from.endsWith('.gz')) throw new Error('the rebuilt ordering is not in the form the swap expects — nothing was replaced');
  const to = rowstore.gzFile(id, 'ranking');
  // ONE RENAME, and the old ordering is only gone once the new one has its
  // name. Nothing is deleted first, so a crash anywhere above leaves the set
  // exactly as it was.
  fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);
  fs.renameSync(from, to);
  // an unsquashed ordering from an older era would otherwise shadow the one
  // just written -- storeFile prefers the plain file when it has any size
  try { fs.rmSync(rowstore.plainFile(id, 'ranking'), { force: true }); } catch (_) { /* nothing there */ }
  try { fs.rmSync(`${rowstore.plainFile(id, 'ranking')}.meta.json`, { force: true }); } catch (_) { /* nothing there */ }
  return { rows: got };
}

const unitFills = new Map();
function fillMissingUnitsStart(id) {
  if (unitFills.has(id)) return unitFills.get(id);
  const doc = getSet(id);
  if (!doc) throw new Error(`no record set called "${id}"`);
  const why = unitFillRefusal(doc);
  if (why) throw new Error(why);
  claimOrRefuse();
  const gaps = missingUnitsOf(doc);
  if (!gaps) throw new Error(`${doc.name} does not record which units it planned, so nothing can be put back safely`);
  if (!gaps.missing.length) return { id, already: true, done: 0, total: 0, added: 0, error: null, promise: Promise.resolve() };

  const run = {
    id, done: 0, total: gaps.missing.length, added: 0, error: null, failures: [], promise: null,
  };
  unitFills.set(id, run);
  const p = doc.params || {};
  const nullN = Math.max(0, Math.floor(num(p.nullN, 19)));
  const fee = Number(p.fee) || 0;
  run.promise = (async () => {
    const w = writers(id);
    const pool = createPool();
    const payloads = gaps.missing.map(({ unit }) => ({
      combo: { trade: unit.trade, ctx1: unit.ctx1, ctx2: unit.ctx2, size: unit.size },
      geometry: unit.geometry, params: p, seed: doc.seed, unitKey: unitKeyOf(unit), nullN, fee, pin: pinOf(doc),
    }));
    const stillFailed = [];
    try {
      await pool.forEach('s1Unit', payloads, (settled, k) => {
        const { i, unit } = gaps.missing[k];
        if (settled.ok && settled.value) {
          const res = settled.value;
          // THE RECORD IS FILED UNDER ITS OWN PLACE IN THE PLAN, never at the
          // end of the file. Everything downstream joins on that number, and
          // the stores are append-only, so a unit put back years later still
          // lands where the plan always said it was.
          const ranges = writeUnitStores(w, unit, i, res);
          w.records.push({
            u: i, trade: unit.trade, ctx1: unit.ctx1, ctx2: unit.ctx2, size: unit.size, geometry: unit.geometry,
            bandPct: res.bandPct, counts: res.counts, reserve: res.reserve || null, windows: res.windows || null,
            specs: res.members.map((m) => ({ ...m.spec, picked: m.picked })),
            voices: voicesOf(res.members, (res.counts || {}).test || 0),
            score: res.score, beat: res.beat, pairs: res.pairs, lead: res.lead,
            nullScores: res.nullScores,
            money: res.tuning.money, moneyTrades: res.tuning.trades, moneyChunks: res.tuning.chunks,
            nullMoney: res.tuning.nullMoney, beatMoney: res.tuning.beat, leadMoney: res.tuning.lead,
            blocks: ranges,
          });
          w.records.flush();
          run.added++;
        } else if (!settled.ok) {
          stillFailed.push({ unit: unitKeyOf(unit), error: String(settled.error || 'failed') });
        }
        run.done++;
      });
    } finally {
      for (const k of ['votes', 'tau', 'models', 'records']) await w[k].close();
      pool.abort();
    }
    recordsInHand.id = null; recordsInHand.rows = null;      // the appended rows must be served, not the old list
    const all = allRecords(id).slice();
    await rebuildRanking(id, all);
    const fresh = getSet(id);
    if (fresh) {
      const left = missingUnitsOf(fresh);
      fresh.failures = stillFailed;
      fresh.counts = { unitsScored: all.length, failures: stillFailed.length };
      // A SET THAT MATCHES ITS OWN PLAN AGAIN IS FINISHED, and saying so is the
      // whole point: an incomplete set is refused as a parent, so a fill-in
      // that left the stamp alone would have fixed nothing anybody can use.
      fresh.status = (left && left.missing.length === 0) ? 'done' : 'incomplete';
      fresh.progress = fresh.status === 'done' ? ''
        : `finished with ${left ? left.missing.length : stillFailed.length} unit(s) missing — the set does not match its own plan`;
      fresh.unitsFilledAt = new Date().toISOString();
      saveSet(fresh);
    }
    run.failures = stillFailed;
  })().catch((err) => { run.error = String((err && err.message) || err); })
    .finally(() => { unitFills.delete(id); });
  return run;
}
function fillMissingUnitsStatus(id) {
  const going = unitFills.get(id);
  if (going) {
    return { running: true, done: going.done, total: going.total, added: going.added, error: going.error };
  }
  const doc = getSet(id);
  if (!doc) return { idle: true };
  const gaps = missingUnitsOf(doc);
  return {
    idle: true,
    missing: gaps ? gaps.missing.length : 0,
    total: gaps ? gaps.total : 0,
    have: gaps ? gaps.have : 0,
    status: doc.status,
    why: unitFillRefusal(doc),
  };
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
  // A CHILD READS EXACTLY THE PRICE FILES ITS PARENT READ (3.84.0): the pin
  // is handed down, so the only question is whether those files are still
  // there with the same bytes. A bundle or a day that has appeared since is
  // not this chain's, and does not refuse it.
  if (!parent.dataManifest || parent.dataManifest.error || !parent.dataManifest.symbols) {
    throw new Error(`${parent.name} carries no readable price-file record, so nothing can prove the data is unchanged`);
  }
  const pinned = pinnedIntact(parent.dataManifest);
  if (!pinned.intact) {
    throw new Error(`${pinComplaint(pinned, parent.name)} — a mismatch refuses, it never mixes`);
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
  // used because it was migrated to say so — and a row written under a way of
  // weighing that reads no bar stores none, so it reads as not applying here
  // for the same reason a market row's gate does.
  _bar: (r) => (r.agreeBar == null ? 'does not apply' : r.agreeBar === 'own' ? 'its own history' : 'all of them'),
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

// SAVING THE FILTERS, the same contract the sort has (3.78.0). They have to
// live on the record set and not in the browser, because the stage 3 carry
// reads them: a filter that only existed on one screen could not be honoured
// by a launch, which is exactly how the carry came to ignore them.
//
// Validated through applyFilters itself, against no rows -- one definition of
// what a filter is and what it accepts, so a box the table offers and the
// launch refuses cannot exist.
function setSetFilters(id, filters) {
  const doc = getSet(String(id || ''));
  if (!doc) throw new Error('unknown record set');
  if (doc.status === 'running') throw new Error('the record set is still being written — the filters save after it finishes');
  const clean = {};
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === '' || v == null) continue;
    clean[k] = String(v);
  }
  applyFilters(doc.stage, [], clean);
  doc.filters = Object.keys(clean).length ? clean : null;
  saveSet(doc);
  return { id: doc.id, filters: doc.filters };
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
  claimOrRefuse(params);
  if (params.orderBy !== undefined) {
    throw new Error('order by is gone — the carry follows the sort saved on the parent record set\'s table '
      + '(the fixed rule when none is saved). Pick the sort on Boards.');
  }
  const parent = parentOrRefuse(params.from, 1);
  const carry = Math.max(0, Math.floor(num(params.carry, 0)));
  const ranking = rankingOf(parent.id);
  if (!ranking.length) throw new Error(`${parent.name} holds no ranking — nothing to carry`);
  const parentRecords = new Map(allRecords(parent.id).map((r) => [r.u, r]));
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
    exam: !!params.exam,
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
  // the stamp lists the parent's pinned files -- what this run reads -- with
  // their bytes as they are now, which parentOrRefuse has just proved equal
  doc.dataManifest = childStampFor(id, parent);
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
        geometry: rec.geometry, params: p, pin: pinOf(doc),
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
          // and the actual date ranges this stage used (3.85.0); pinned to its
          // parent's files, they are the parent's, and are stored on this record
          // in their own right
          windows: res.windows || rec.windows || null,
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
  // A NAME SAYS WHAT WAS ASKED FOR, not what one unit resolved it to. The
  // chunk's own hold length is 60 hours on a weekly unit and 41 on a daily
  // one, and a name carrying either would be wrong on the other half of the
  // same block -- so the name carries the choice, and each row carries the
  // number it was actually priced at.
  const t = cell.tHours === bracketLib.T_OWN ? 't own' : `t${cell.tHours}h`;
  return cell.entry === 'market'
    ? `market ${t}`
    : `${cell.gate} d${cell.dMult}x ${t}${trailBit}`;
}
// A QUORUM'S NAME. The bar is in it because the same share means two different
// things under the two bars — 75% of what exists, or the strongest 25% of what
// this committee reaches — and a name that hid the difference would put two
// unlike settings under one heading.
function agreeLabel(a) {
  // A WAY OF WEIGHING THAT READS NO BAR CARRIES NO BAR IN ITS NAME. Printing a
  // share and a bar on a setting that never consults either is the same fault
  // as printing the one-voice threshold on a rule that cannot read it, one
  // step further along: it would say two settings differ when they are one
  // trade, and it would tell the owner a number was used when it was not.
  if (agreement.READS_NO_BAR.has(a.rule)) {
    return `${a.rule}${a.bothModels ? ' +both' : ''}${a.persist ? ` +hold${a.persist}` : ''}`;
  }
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
      // A WAY OF WEIGHING THAT READS NO BAR HAS NO BAR AND NO SHARE, so it is
      // ONE setting however many of either are being permuted -- and the two
      // it does not read are stored as nothing rather than as whichever value
      // the boxes happened to hold, so a record can never say a number was
      // used when the rule never looked at it (RULE NINE: a record says what
      // it is). Only both kinds and hold still multiply it; those it reads.
      if (agreement.READS_NO_BAR.has(rule)) {
        for (const bothModels of boths) {
          for (const persist of persists) {
            out.push({ rule, bar: null, pct: null, copy, bothModels, persist });
          }
        }
        continue;
      }
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
// THE KEY IS WHAT THIS UNIT WILL ACTUALLY BE ASKED TO DO, so t is resolved
// here and not carried as written (3.72.0). On a daily 3-day unit the chunk's
// own hold length IS 41 hours, so a setting asking for it and a setting asking
// for 41h place the identical orders there and are one setting on that unit --
// and on a weekly unit, where it is 60, they are two. Keying on the unresolved
// value would price the same trade twice on every daily unit in the run.
function foldKeyRest(st, wk, geometry) {
  return [st.decision, wk ? 1 : 0, st.entry, st.gate, bracketLib.tHoursOn(st.tHours, geometry),
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
      const key = `${repOf.get(shapeKeyOf(st))}|${foldKeyRest(st, wkApplies ? !!st.weekdaysOnly : false, rec.geometry)}`;
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
    for (const i of heldOn[0]) firstOn0.set(`${repOf.get(shapeKeyOf(settings[i]))}|${foldKeyRest(settings[i], wk0 ? !!settings[i].weekdaysOnly : false, records[0].geometry)}`, settings[i].label);
    for (let i = 0; i < settings.length; i++) {
      if (keptOnAny[i]) continue;
      const st = settings[i];
      folded.push({ dropped: st.label, kept: firstOn0.get(`${repOf.get(shapeKeyOf(st))}|${foldKeyRest(st, wk0 ? !!st.weekdaysOnly : false, records[0].geometry)}`) || null });
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
    dMults: bracketLib.D_MULTS,
    // THE STAGE 3 GRID, AND ONLY THIS ONE, OFFERS THE CHUNK'S OWN HOLD LENGTH
    // (3.72.0). Stage 3 prices unit by unit and knows each unit's chunk shape,
    // so it can resolve it; the old sweep path prices before the units exist
    // and passes the plain numeric ladder, so it refuses the value outright
    // rather than being taught a second meaning for it.
    tHours: [...bracketLib.T_HOURS, bracketLib.T_OWN],
    gates: bracketLib.GATES,
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
  return require('./declared').expandDeclared(shapeCell, shapePermute, grid);
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
  // does not apply, and neither do the filters -- a tick is the owner naming
  // that record, and nothing may quietly take it back off the list.
  if (Array.isArray(selected)) {
    const want = new Set(selected.map(Number));
    records = records.filter((r) => want.has(r.u));
    return { records, savedS2, selected: records.map((r) => r.u) };
  }
  // THE CARRY IS OVER THE TABLE AS THE OWNER HAS IT (3.78.0, owner order
  // 2026-09-06: "the carry from table 2 must NOT ignore filters!").
  //
  // It used to read the raw records, so the filters on the screen were a view
  // and nothing more: the owner could cut the table to the rows they meant to
  // carry, press start, and get the top N of a table they were not looking at.
  // Now it goes through the same three steps the screen does -- the same rows,
  // the same order, the same filters -- so `N records` means the top N of what
  // is in front of them, and `carry forward` 0 means all of it.
  // PAIRED BY POSITION, NOT BY THE UNIT NUMBER. stage2Rows maps the records
  // one for one and in order, so the place in that list is the record --
  // keying on `u` would quietly collapse every record of a set that does not
  // carry one into a single entry, and hand the launch one unit instead of
  // hundreds.
  const rows = stage2Rows(parent.id).map((row, i) => ({ ...row, _at: i }));
  const shown = applyFilters(2, stage2Ordered(parent, rows), parent.filters || null);
  const held = shown.length;
  const of = records.length;
  records = (carry > 0 ? shown.slice(0, carry) : shown).map((row) => records[row._at]).filter(Boolean);
  return { records, savedS2, filtered: { held, of }, selected: null };
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
  // THE UNREAD WINDOW HAS A START AND NO END (3.85.0, owner order 2026-09-07:
  // "future runs that look at the last /13 should use all available data --
  // so if more data has become available it must be automatically included").
  // It runs from where the seal began to the newest candle the box holds for
  // these units' coins on the day it is read; seenToTs is only how far the
  // data reached when the units were written.
  const starts = units.map((x) => x && x.reserve && Number(x.reserve.fromTs)).filter(Number.isFinite);
  const seen = units.map((x) => x && x.reserve && Number(x.reserve.toTs)).filter(Number.isFinite);
  const coins = coinsOfUnits(units);
  return {
    layout,
    sealed: missing === 0,
    units,
    missing,
    why: missing ? `${missing} of ${units.length} units carry no sealed window` : null,
    fromTs: starts.length ? Math.min(...starts) : null,
    latestFromTs: starts.length ? Math.max(...starts) : null,
    seenToTs: seen.length ? Math.max(...seen) : null,
    dataToTs: newestDataOf(coins),
  };
}
// the newest candle the box holds across some coins: what "all available
// data" reaches today
function newestDataOf(coins) {
  const { newestCandleTs } = require('./binance');
  let best = null;
  for (const c of coins || []) {
    let t = null;
    try { t = newestCandleTs(c); } catch (_) { t = null; }
    if (Number.isFinite(t) && (best == null || t > best)) best = t;
  }
  return best;
}

// THE DATE RANGES A SET USED, READ OFF ITS OWN RECORDS (3.85.0, owner order
// 2026-09-07: "on all s1/2/3 sweep runs the three actual date ranges for
// 70/15/15 and 61/13/13 should be stored"). Stage 1 and 2 sets carry them per
// record; a stage 3 set keeps them per unit beside itself. Each window is
// reported as the span across the units that carry it, with how many do; the
// unread window with its start and the newest candle the box holds today,
// which is where it ends for anything that reads it.
function windowsOfSet(doc) {
  if (!doc) return null;
  let per = [];
  let total = 0;
  if (doc.stage === 3) {
    per = Object.values(((doc.windows || {}).units) || {}).filter(Boolean);
    total = Number((doc.plan || {}).units || 0) || per.length;
  } else {
    let recs = [];
    try { recs = rowstore.readAll(doc.id, 'records'); } catch (_) { recs = []; }
    per = recs.map((r) => r.windows).filter(Boolean);
    total = recs.length;
  }
  const span = (key) => {
    const xs = per.map((w) => w[key]).filter((x) => x && Number.isFinite(x.fromTs) && Number.isFinite(x.toTs));
    if (!xs.length) return null;
    return {
      fromTs: Math.min(...xs.map((x) => x.fromTs)), toTs: Math.max(...xs.map((x) => x.toTs)),
      latestFromTs: Math.max(...xs.map((x) => x.fromTs)), earliestToTs: Math.min(...xs.map((x) => x.toTs)),
      units: xs.length,
    };
  };
  const unreads = per.map((w) => w.unread).filter((x) => x && Number.isFinite(x.fromTs));
  return {
    layout: per.length ? (per[0].layout || ((doc.params || {}).windowLayout || null)) : ((doc.params || {}).windowLayout || null),
    units: total,
    known: per.length,
    train: span('train'), test: span('test'), hold: span('hold'),
    unread: unreads.length ? {
      fromTs: Math.min(...unreads.map((x) => x.fromTs)), latestFromTs: Math.max(...unreads.map((x) => x.fromTs)),
      seenToTs: Math.max(...unreads.map((x) => Number(x.seenToTs) || 0)) || null,
      dataToTs: newestDataOf(coinsFingerprinted(doc)), units: unreads.length,
    } : null,
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

function noiseTwinOf(doc) {
  const bn = (doc || {}).boardNull;
  if (!(bn && typeof bn === 'object')) {
    throw new Error(`${(doc || {}).id || 'this set'} carries no board-wide noise stamp — `
      + 'every set is stamped at birth, so this one cannot be read');
  }
  return { available: !!bn.captured, why: bn.captured ? null : (bn.why || 'not captured') };
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
      // t IS LEFT UNRESOLVED HERE ON PURPOSE (3.72.0): the chunk's own hold
      // length is a different number on each unit, so it can only be resolved
      // inside the per-record loop below -- the same place the launch's fold
      // resolves it.
      for (const cell of cells) items.push({ g: `${cell.entry}|${cell.gate}`, t: cell.tHours, wk, shape: { band, dMult: cell.dMult ?? null, trailMult: cell.trailMult ?? null, armMult: cell.armMult ?? null } });
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
      const key = `${it.g}|${bracketLib.tHoursOn(it.t, rec.geometry)}|${repOf.get(shapeKeyOf(it.shape))}|${wkApplies ? (it.wk ? 1 : 0) : 0}`;
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
    let filtered = null;
    ({ records, filtered } = pick === 'selected' ? stage3UnitsFor(parent, 0, pickedOf(parent)) : stage3UnitsFor(parent, carry));
    // A FILTER SAVED ON THE PARENT'S TABLE CUTS THE CARRY, so the cost line has
    // to say so before a start. A filter set days ago and forgotten would
    // otherwise change what a launch prices with nothing on screen about it.
    out.filtered = filtered && filtered.held !== filtered.of ? filtered : null;
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
  claimOrRefuse(params);
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
    exam: !!params.exam,
    measurements: MEASUREMENTS_VERSION,
    // WHAT THIS RUN KEPT, stamped at launch in the shape every reader already
    // asks. A run that keeps ten and stamps 'none' would fill the columns and
    // still tell the Funnel there is nothing to compare against.
    boardNull: keepN > 0
      ? { captured: true, kept: keepN, why: null }
      : { captured: false, kept: 0, why: 'null set money kept was 0 when this set was priced' },
    // THE GATES ITS RECORDS HOLD -- every one the engine has. A set priced
    // before the always gate was removed carries no stamp, and is migrated the
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
  // the stamp lists the parent's pinned files -- what this run reads -- with
  // their bytes as they are now, which parentOrRefuse has just proved equal
  doc.dataManifest = childStampFor(id, parent);
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
  // what the run holds in memory and nowhere else, so a pause or a failure
  // can write it down (3.82.0)
  let live = null;
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
    // EVERYTHING A UNIT STILL NEEDS, per unit: at a launch that is every
    // setting it holds, each carrying its place in the block (3.52.0)
    const work = parentRecords.map((rec, pi) => ({ rec, settings: heldOn[pi].map((i) => ({ ...settings[i], si: i })), drop: null }));
    live = liveStateFor(parentRecords, {}, {}, {}, w);
    const landed = await runStage3Parts({ doc, parent, pool, w, parentRecords, work, fee, nullN, keepN, live, t0, tRead });
    if (!landed) return;
    await finishStage3({ doc, pool, w, parentRecords, settings, coinsN, live });
  })().catch((err) => {
    // a run that failed keeps its checkpoint too: what it had priced is on
    // disk, and this is what lets it be started again once the cause is fixed
    if (live) { try { writeCheckpoint(doc, live); } catch (_) { /* the failure itself is what is reported */ } }
    finishFail(doc, err, pool);
  });
  // the count the gates read and the plan was written with — the built
  // block lives in the background part and is held equal to this count there
  return { id, name: doc.name, units: parentRecords.length, settings: counted.kept };
}

// ---- THE PRICING, SHARED BY A LAUNCH AND A START-AGAIN (3.82.0) --------------
//
// One loop, one tail. A launch prices every setting of every unit; a
// start-again prices what its store does not yet hold. Two copies of this
// loop would be two places for a pause to lose something.

// What a run holds in memory and nowhere else while it prices, and what the
// checkpoint is written from. `pricedBase` is what was already on disk when a
// paused run was started again, so the progress line and the cycle count
// carry on from where they were rather than starting at nothing.
function liveStateFor(parentRecords, agreedMap, controlsMap, windowsMap, w, pricedBase = 0) {
  return {
    units: parentRecords.map((r) => r.u),
    agreedMap, controlsMap, windowsMap,
    workersN: null, priced: 0, pricedBase, checkpointedAt: 0,
    pricedSettings() { return this.pricedBase + this.priced; },
    storeRows: () => w.records.count,
    storeBlocks: () => w.records.blockCount,
  };
}

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
//
// `work` is one entry per unit still to price: its parent record, the
// settings to price (each carrying its place in the block), and `drop`, the
// setting numbers whose rows are NOT wanted -- a setting priced again only so
// its agreements and comparisons come back, because those two come back with
// the pricing and from nowhere else (continueStage3). A launch drops nothing.
//
// Resolves true when every part landed; false when the run was paused on the
// way, in which case the set has already been finished off as paused.
async function runStage3Parts({ doc, parent, pool, w, parentRecords, work, fee, nullN, keepN, live, t0, tRead }) {
  const { agreedMap, controlsMap, windowsMap } = live;
  const workersN = pool.parallel ? pool.workers.length : 1;
  const parts = [];                     // { k: index into work, from, to } -- into the unit's OWN list
  const partsOf = [];                   // how many parts each unit was cut into
  const payloads = [];
  for (let k = 0; k < work.length; k++) {
    const { rec, settings: mine } = work[k];
    const partsPerUnit = Math.max(1, Math.min(mine.length, workersN * 4));
    const partSize = Math.max(1, Math.ceil(mine.length / partsPerUnit));
    const whole = s3Payload({ doc, parent, rec, settings: mine, fee, nullN });     // the votes are read once per unit
    let n = 0;
    for (let from = 0; from < mine.length; from += partSize) {
      const to = Math.min(mine.length, from + partSize);
      payloads.push({ ...whole, settings: mine.slice(from, to) });
      parts.push({ k, from, to });
      n++;
    }
    partsOf.push(n);
    if (k % 5 === 4 || k === work.length - 1) {
      phaseNote(doc, { phase: 'reading the kept votes', done: k + 1, total: work.length, word: 'units', startedMs: tRead });
      saveSet(doc);
    }
  }
  live.workersN = workersN;
  // the pricing clock starts when the pricing does, and the screen is told
  // at once that this phase has begun with nothing finished yet — otherwise
  // the previous phase's line sits there looking like the current one
  const tPrice = Date.now();
  doc.perf.partsTotal = parts.length;
  doc.perf.partsDone = 0;
  phaseNote(doc, { phase: 'pricing the settings', done: 0, total: parts.length, word: 'parts', startedMs: tPrice,
    extra: `${doc.perf.unitsDone} of ${parentRecords.length} units` });
  saveSet(doc);
  // the state as the pricing begins, so a restart in its first minute loses nothing
  writeCheckpoint(doc, live);
  const landed = new Array(work.length).fill(0);
  const failedUnits = new Set();
  await pool.forEach('s3Unit', payloads, (settled, i) => {
    if (doc.cancelRequested) return;
    const part = parts[i];
    const { rec, drop } = work[part.k];
    if (settled.ok && settled.value) {
      let kept = 0;
      for (const row of settled.value.rows) {
        // a row already on disk, priced again only for what rides with it
        if (drop && drop.has(row.si)) continue;
        // storedRecordOf, not a spread: the pricing hands back everything it
        // worked out, and exactly one place decides what reaches disk
        // (ruling 4 — stage 3 does not grow). A spread here would put the
        // analysis block on 5.2 million records.
        w.records.push({
          ...require('./stagework').storedRecordOf(row),
          u: rec.u, trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size, geometry: rec.geometry,
        });
        kept++;
      }
      if (kept) { w.records.flush(); live.priced += kept; }
      // the unit's realised agreements, already worked out on the same walk
      // the pricing used — kept beside the set, never on 329,280 records
      for (const [k, v] of Object.entries(settled.value.agreed || {})) agreedMap[`${rec.u}|${k}`] = v;
      if (settled.value.controls) {
        const key = unitKeyOf(rec);
        controlsMap[key] = { ...(controlsMap[key] || {}), ...settled.value.controls };
      }
      // the actual date ranges this unit was priced on (3.85.0), kept beside
      // the set like the comparisons -- they come back with any part of it
      if (settled.value.windows) windowsMap[unitKeyOf(rec)] = settled.value.windows;
    } else if (!settled.ok && !failedUnits.has(part.k)) {
      // one failure per unit, whichever of its parts failed first: the set is
      // short that unit, and the count of failures is the count of units
      failedUnits.add(part.k);
      doc.failures.push({ unit: `${rec.trade}|${rec.geometry}`, error: String(settled.error || 'failed') });
    }
    landed[part.k]++;
    if (landed[part.k] === partsOf[part.k]) doc.perf.unitsDone++;
    doc.perf.partsDone++;
    doc.perf.elapsedMs = Date.now() - t0;
    doc.perf.etaMs = doc.perf.partsDone ? Math.round(((Date.now() - tPrice) / doc.perf.partsDone) * (parts.length - doc.perf.partsDone)) : null;
    // the SAME per-setting count cyclesTotal was built from, or a run that
    // keeps scrambles reports a progress bar that never reaches its end
    doc.perf.cyclesDone = live.pricedSettings() * (1 + nullN + keepN);
    phaseNote(doc, {
      phase: 'pricing the settings', done: doc.perf.partsDone, total: parts.length, word: 'parts', startedMs: tPrice,
      extra: `${doc.perf.unitsDone} of ${parentRecords.length} units · ${doc.perf.cyclesDone.toLocaleString()} of ${doc.perf.cyclesTotal.toLocaleString()} pricings`,
    });
    saveSet(doc);
    checkpointIfDue(doc, live);
  });
  if (doc.cancelRequested) {
    // paused: the memory-only state goes to disk BEFORE the set is marked, so
    // the mark can say what can be done with it
    writeCheckpoint(doc, live);
    doc.progress = `paused at ${Number(doc.perf.partsDone).toLocaleString()} of ${Number(doc.perf.partsTotal).toLocaleString()} parts · `
      + `${Number(doc.perf.unitsDone).toLocaleString()} of ${parentRecords.length.toLocaleString()} units priced`;
    finishFail(doc, null, pool);
    return false;
  }
  return true;
}

// The tail every stage 3 run ends through: the store closed, the counts and
// the status written, the agreements and the four comparisons kept beside the
// set, the tables totalled, and the checkpoint gone because a finished set has
// nothing to start again from.
async function finishStage3({ doc, pool, w, parentRecords, settings, coinsN, live }) {
  const { agreedMap, controlsMap, windowsMap } = live;
  const id = doc.id;
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
  doc.controls = { at: new Date().toISOString(), units: controlsMap };
  doc.windows = { at: new Date().toISOString(), units: windowsMap || {} };
  if (tallyGate.band === 'refuse') doc.tallyError = tallyGate.message;
  else { try { await buildTally(doc, pool, tallyNote); } catch (err) { doc.tallyError = String(err.message || err); } }
  doc.progress = doc.status === 'incomplete' ? doc.progress : '';
  doc.finishedAt = new Date().toISOString();
  saveSet(doc);
  dropCheckpoint(id);
  if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
  pool.abort();
}

// A PAUSED RUN, STARTED AGAIN (3.82.0, owner order 2026-09-07: "an entry
// written to the stage 3 sweep drop down list as in a paused record set which
// can then be selected for start again perhaps using the existing start
// button").
//
// What it keeps: every record its store already holds, and the agreements and
// comparisons its checkpoint holds. What it prices: every setting of every
// unit that is not on disk, plus one setting per agreement or comparison a
// unit is missing (they land with the pricing and from nowhere else, and the
// checkpoint is written once a minute). What it refuses: a set that is not
// paused (or interrupted, or failed) with a checkpoint; a parent that no
// longer holds the same units; price files that moved since the launch; a
// block that no longer rebuilds to the one the run declared; a store with a
// duplicate row.
//
// IT ANSWERS AT ONCE (3.83.0, owner report 2026-09-07: "i did the start stage
// 3 on the paused set and it just timed out"). Reading 2.18 million rows back
// to learn what was on disk took over a minute inside the request, the
// gateway gave up at sixty seconds, and the press came back as a failure
// while the run had in fact started. So the split is the launch's own
// (3.47.0): everything that can refuse in an instant still refuses in the
// answer -- the set, its checkpoint, one heavy job at a time, the parent, the
// price files, the units -- and everything slow happens after the answer,
// on the running line: rebuilding the block, reading the store block by
// block with the service answering in between, building the work list. A
// refusal found there puts the set back exactly as it was, with the sentence
// on it, because nothing has been priced.
function continueStage3(id) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 3) throw new Error(`unknown stage 3 record set '${id}'`);
  if (!['paused', 'interrupted', 'error'].includes(doc.status)) {
    throw new Error(`${doc.name} is ${doc.status} — only a paused run can be started again`);
  }
  const cp = readCheckpoint(id);
  if (!cp) {
    throw new Error(`${doc.name} kept no record of where it stopped — it was stopped by code that did not keep one, `
      + 'so it cannot be started again. Delete it and launch it afresh.');
  }
  claimOrRefuse();
  const parent = getSet((doc.parent || {}).id || (doc.params || {}).from || '');
  if (!parent || parent.stage !== 2) throw new Error('the stage 2 record set this was priced from is no longer on the box');
  // THE SAME PRICES (3.84.0). The rest of this run reads exactly the price
  // files the first part read -- the pin -- so the only question is whether
  // those files are still there with the same bytes. A bundle that has
  // appeared beside them since, a day that was filled in, a new day of data:
  // none of it is this run's, and none of it refuses.
  let pinWidened = null;
  if (doc.dataManifest && !doc.dataManifest.error && doc.dataManifest.symbols) {
    const pinned = pinnedIntact(doc.dataManifest);
    if (!pinned.intact) {
      throw new Error(`${pinComplaint(pinned, doc.name)} — the rest of this run would be priced on different prices from the part already done`);
    }
    // A NARROW PIN IS WIDENED TO THE PARENT'S (3.84.1). A set stamped before
    // 3.77.1 can name one coin where its units read seventeen; the coins its
    // own record does not name are read from its parent's files from here on,
    // its own files win for the coins it does name, the launch's own detail
    // file stays where it was, and the start-again's record says so.
    const ownPin = pinnedFilesOf(doc.dataManifest) || {};
    const parentPin = pinnedFilesOf(parent.dataManifest);
    const missing = parentPin ? Object.keys(parentPin).filter((c) => !ownPin[c]) : [];
    if (missing.length) {
      const pc = pinnedIntact(parent.dataManifest);
      if (!pc.intact) {
        throw new Error(`${pinComplaint(pc, parent.name)} — this run's own record names ${Object.keys(ownPin).length} coin(s) and its units read `
          + `${missing.length} more from its parent's files, and those have moved`);
      }
      const merged = { ...parentPin, ...ownPin };
      doc.dataManifest = stampManifest(`${id}-widened`, Object.keys(merged).sort(), { onlyFiles: merged });
      pinWidened = { from: Object.keys(ownPin).length, to: Object.keys(merged).length, added: missing.sort() };
    }
  }
  // THE SAME UNITS, IN THE ORDER THE RUN HAD THEM: by record number on the
  // parent, never by the parent's table, which may have been re-sorted or
  // filtered since the launch (3.78.0).
  const units = cp.units.length ? cp.units : ((doc.plan || {}).unitSettings || []).map((x) => x.u);
  if (!units.length) throw new Error(`${doc.name} does not record which units it priced, so it cannot be started again`);
  const byU = new Map(stage3UnitsFor(parent, 0, units).records.map((r) => [r.u, r]));
  const parentRecords = units.map((u) => byU.get(u)).filter(Boolean);
  if (parentRecords.length !== units.length) {
    throw new Error(`${units.length - parentRecords.length} of the ${units.length} units this run priced are no longer on ${parent.name}`);
  }
  const fee = Number((doc.params || {}).fee) || 0;
  const nullN = Math.max(0, Math.floor(num((doc.params || {}).nullN, 19)));
  const keepN = Math.max(0, Math.floor(num((doc.params || {}).keepN, 0)));
  // CLAIMED, AND ANSWERED. From here the set is the one heavy job, a second
  // press refuses by sentence, and the pause control can end it.
  const before = doc.status;
  doc.status = 'running';
  doc.cancelRequested = null;
  doc.error = null;
  doc.finishedAt = null;
  delete doc.pausedBy;                        // the tool's mark on the 3.81 run, spent
  doc.failures = [];                          // a unit that failed last time is tried again
  doc.progress = 'starting again: reading what is already on disk';
  activeSet = doc;
  saveSet(doc);
  const pool = createPool();
  activePool = pool;
  doc.perf = { ...(doc.perf || {}), workers: pool.parallel ? pool.workers.length : 1, etaMs: null };
  saveSet(doc);
  // a refusal found after the answer: nothing was priced, so the set goes
  // back exactly as it was, with the sentence on it
  const notStarted = (m) => { const e = new Error(m); e.notStarted = true; return e; };
  const yieldNow = () => new Promise((resolve) => { setImmediate(resolve); });
  let live = null;
  (async () => {
    await yieldNow();
    // THE SAME BLOCK: the same count and the same names in the same places, or
    // a setting's number on disk would mean a different setting from here on.
    doc.progress = 'starting again: rebuilding the block';
    saveSet(doc);
    await yieldNow();
    const sizes = [...new Set(parentRecords.map((r) => r.size || (r.ctx1 ? (r.ctx2 ? 3 : 2) : 1)))];
    const { kept: settings, heldOn } = foldSameTradeSettings(settingsFor(doc.params || {}, sizes), parentRecords);
    const labels = (doc.plan || {}).settingLabels || [];
    if (settings.length !== (doc.plan || {}).settings || labels.length !== settings.length || settings.some((st, i) => st.label !== labels[i])) {
      throw notStarted(`the block rebuilds to ${settings.length.toLocaleString()} settings and this run declared ${Number((doc.plan || {}).settings || 0).toLocaleString()} — `
        + 'not the same block, so nothing was priced');
    }
    // WHAT IS ON DISK. A block the writer reserved but never finished (a
    // restart in mid-write) is cut off so the file and its sidecar agree; then
    // every row's unit and setting number is read, and a duplicate refuses,
    // because a store that already holds a row twice cannot be added to safely.
    //
    // BLOCK BY BLOCK, WITH A BREATH BETWEEN (3.83.0). One synchronous walk of
    // the whole store held the service for over a minute; a few blocks at a
    // time with the loop let go in between keeps the screens answering and
    // puts the reading on the running line as it goes.
    const trimmed = rowstore.trimToMeta(id, 'records');
    const have = new Map();
    let dup = 0;
    const seen = (r) => {
      let set = have.get(r.u);
      if (!set) { set = new Set(); have.set(r.u, set); }
      if (set.has(r.si)) dup++; else set.add(r.si);
    };
    const blocks = rowstore.blocksOf(id, 'records');
    if (blocks && blocks.length) {
      const tScan = Date.now();
      let lastSave = 0;
      const STEP = 4;
      for (let bi = 0; bi < blocks.length; bi += STEP) {
        if (doc.cancelRequested) throw notStarted('paused before it priced anything');
        const idx = [];
        for (let k = bi; k < Math.min(blocks.length, bi + STEP); k++) idx.push(k);
        for (const { row } of (rowstore.readBlocks(id, 'records', idx) || [])) seen(row);
        const done = Math.min(blocks.length, bi + STEP);
        phaseNote(doc, { phase: 'starting again: reading what is already on disk', done, total: blocks.length, word: 'blocks', startedMs: tScan });
        const now = Date.now();
        if (now - lastSave > 1000 || done === blocks.length) { lastSave = now; saveSet(doc); }
        await yieldNow();
      }
    } else {
      rowstore.each(id, 'records', seen);   // a store that was never squashed is a small one
    }
    if (dup) throw notStarted(`the records of ${doc.name} hold ${dup.toLocaleString()} duplicate row(s), so it cannot be started again without a repair`);
    const agreedMap = { ...cp.agreedMap };
    const controlsMap = { ...cp.controlsMap };
    const windowsMap = { ...(cp.windowsMap || {}) };
    const swk = require('./stagework');
    const work = [];
    let doneUnits = 0;
    let pricedBase = 0;
    let settingsRepriced = 0;
    for (let pi = 0; pi < parentRecords.length; pi++) {
      const rec = parentRecords[pi];
      const mine = heldOn[pi].map((i) => ({ ...settings[i], si: i }));
      const got = have.get(rec.u) || new Set();
      const todo = mine.filter((st) => !got.has(st.si));
      pricedBase += mine.length - todo.length;
      // THE AGREEMENTS AND THE COMPARISONS COME BACK WITH THE PRICING AND FROM
      // NOWHERE ELSE, and a part hands back only the ones its own settings read:
      // one agreement per decision-and-rule, one set of comparisons per 24/7-or-
      // 24/5-and-hold-length. The checkpoint is written once a minute, so a
      // restart can leave a unit with rows on disk whose agreements and
      // comparisons were still in memory. Each one missing is recovered by
      // pricing ONE setting on disk that reads it, its row thrown away -- never
      // the whole unit again, and never guessed.
      const prefix = `${rec.u}|`;
      const haveA = new Set(Object.keys(agreedMap).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
      const haveC = new Set(Object.keys(controlsMap[unitKeyOf(rec)] || {}));
      const aKey = (st) => swk.agreedKey(st.decision, swk.agrOf(st));
      const cKey = (st) => controlKeyOf({ weekdaysOnly: st.weekdaysOnly, tHours: bracketLib.tHoursOn(st.tHours, rec.geometry) });
      const coveredA = new Set(todo.map(aKey));
      const coveredC = new Set(todo.map(cKey));
      const drop = new Set();
      const extra = [];
      for (const st of mine) {
        if (!got.has(st.si)) continue;                       // not on disk: it is in todo already
        const ka = aKey(st);
        const kc = cKey(st);
        if ((haveA.has(ka) || coveredA.has(ka)) && (haveC.has(kc) || coveredC.has(kc))) continue;
        extra.push(st);
        drop.add(st.si);
        coveredA.add(ka);
        coveredC.add(kc);
      }
      // a unit whose date ranges were never kept (a set from before 3.85.0)
      // prices one setting again for them, its row thrown away, like the rest
      if (!windowsMap[unitKeyOf(rec)] && !todo.length && !extra.length) {
        const st = mine.find((x) => got.has(x.si));
        if (st) { extra.push(st); drop.add(st.si); }
      }
      if (!todo.length && !extra.length) { doneUnits++; continue; }
      settingsRepriced += extra.length;
      work.push({ rec, settings: [...todo, ...extra].sort((a, b) => a.si - b.si), drop: drop.size ? drop : null });
    }
    if (doc.cancelRequested) throw notStarted('paused before it priced anything');
    doc.continued = [...(doc.continued || []), {
      at: new Date().toISOString(), from: before, release: ENGINE_VERSION,
      unitsKept: doneUnits, settingsKept: pricedBase, unitsToPrice: work.length, settingsRepriced, rowsTrimmed: trimmed,
      ...(pinWidened ? { pinWidened } : {}),
    }];
    doc.perf = {
      ...(doc.perf || {}), unitsDone: doneUnits, unitsTotal: parentRecords.length,
      etaMs: null, cyclesDone: pricedBase * (1 + nullN + keepN),
    };
    doc.progress = `starting again: ${doneUnits.toLocaleString()} of ${parentRecords.length.toLocaleString()} units were already priced`;
    saveSet(doc);
    const t0 = Date.now() - Number((doc.perf || {}).elapsedMs || 0);   // the clock carries on from where it was
    const tRead = Date.now();
    const w = { records: rowstore.writer(id, 'records', { offThread: true }) };
    const coinsN = new Set(parentRecords.map((r) => r.trade)).size;
    live = liveStateFor(parentRecords, agreedMap, controlsMap, windowsMap, w, pricedBase);
    if (work.length) {
      const landed = await runStage3Parts({ doc, parent, pool, w, parentRecords, work, fee, nullN, keepN, live, t0, tRead });
      if (!landed) return;
    }
    await finishStage3({ doc, pool, w, parentRecords, settings, coinsN, live });
  })().catch((err) => {
    if (err && err.notStarted) {
      // nothing was priced: the set goes back to what it was, or to paused if
      // that is what was asked, and says why on its own line
      if (doc.cancelRequested) {
        doc.status = 'paused';
        doc.progress = `paused at ${Number((doc.perf || {}).partsDone || 0).toLocaleString()} of ${Number((doc.perf || {}).partsTotal || 0).toLocaleString()} parts · `
          + `${Number((doc.perf || {}).unitsDone || 0).toLocaleString()} of ${parentRecords.length.toLocaleString()} units priced`;
        doc.error = null;
      } else {
        doc.status = before;
        doc.progress = `not started again — ${err.message}`;
        doc.error = err.message;
      }
      doc.finishedAt = new Date().toISOString();
      saveSet(doc);
      if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }
      pool.abort();
      return;
    }
    if (live) { try { writeCheckpoint(doc, live); } catch (_) { /* the failure itself is what is reported */ } }
    finishFail(doc, err, pool);
  });
  return { id, name: doc.name, units: parentRecords.length };
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
  // what each unit holds moves with the drop: the set says what it now holds
  stampUnitSettingsFromRows(doc);
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
// worth having: dropping and filling in both change that list and neither of
// them can change what the block DECLARES, so the answer stands
// through both of them — which are exactly the moments the owner is sat
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
  // and what each unit holds moves with it: the set says what it now holds
  const wasPerUnit = Array.isArray(plan.unitSettings) ? plan.unitSettings : [];
  plan.unitSettings = records.map((rec, i) => {
    const was = wasPerUnit.find((x) => x.u === rec.u);
    return { u: rec.u, held: (was ? Number(was.held) || 0 : 0) + addedPerUnit[i] };
  });
  plan.pricings = plan.unitSettings.reduce((a, x) => a + x.held, 0);
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
  const shape = relaunchShapeOf(doc);
  const { parent, settings } = shape;
  // ONE UNIT ONLY, when asked (3.88.0, the ride on Verify): a Stage 4 set's
  // survivors on the set's own unit are priced without the other units, which
  // is what makes minutes of it rather than the whole board again
  let { records, heldOn } = shape;
  if (opts.unit) {
    const keep = records.map((_, i) => i).filter((i) => unitKeyOf(records[i]) === String(opts.unit));
    if (!keep.length) throw new Error(`this stage 3 set holds no unit called '${opts.unit}'`);
    records = keep.map((i) => records[i]);
    heldOn = keep.map((i) => heldOn[i]);
  }
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
    return s3Payload({ doc, parent, rec, settings: use.filter((st) => mine.has(st.si)), fee, nullN, wantTestControls: true });
  });

  // si is per-BLOCK on the way back — the worker numbers what it was handed
  // from zero — so the label is what identifies a setting across units.
  const perSetting = new Map();
  // THE FOUR ON THE TEST WINDOW, PER UNIT (3.107.0). They do not depend on the
  // setting at all -- being long every period, being short every period, buying
  // the coin and going away and shorting it and going away are properties of
  // the unit's TEST window and the hold length -- so they ride back beside the
  // settings rather than on every one of them.
  const testControls = {};
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
      if (settled.value.testControls && Object.keys(settled.value.testControls).length) {
        testControls[unitKeyOf(rec)] = settled.value.testControls;
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
  return { perSetting, failures, testControls, units: records.length, settings: use.length };
}

// ONE UNIT'S PAYLOAD, BUILT ONE WAY. The launch, the rebuild of what actually
// agreed, and the pass that fills in settings a block was priced without all
// hand the workers the same thing — so anything priced later is priced exactly
// as the first rows were. Only what is being ASKED for differs: which
// settings, how many null-set deals, and whether anything is priced at all.
function s3Payload({ doc, parent, rec, settings, fee, nullN, agreedOnly = false, wantTestControls = false }) {
  const votes = unitRows(parent.id, 'votes', rec.blocks.votes, rec.u);
  const tau = unitRows(parent.id, 'tau', rec.blocks.tau, rec.u);
  return {
    combo: { trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size },
    geometry: rec.geometry, params: doc.params, pin: pinOf(doc),
    unit: {
      bandPct: rec.bandPct,
      probs: rec.specs.map((_, mi) => votes.map((v) => v.m[mi])),
      ts: { test: votes.filter((v) => v.w === 0).map((v) => v.ts), hold: votes.filter((v) => v.w === 1).map((v) => v.ts) },
      members: rec.specs.map((spec, mi) => ({ spec, tauProbs: (tau.find((t) => t.mi === mi) || {}).probs || [] })),
    },
    settings, fee, nullN, keepN: agreedOnly ? 0 : (Number((doc.params || {}).keepN) || 0), seed: doc.seed,
    // THE FOUR ON THE TEST WINDOW, only when asked (3.107.0): the rebuild wants
    // them, a launch must not pay four more simulations a unit for something
    // nothing on a launch reads.
    ...(wantTestControls ? { wantTestControls: true } : {}),
    unitKey: `${rec.trade}|${rec.ctx1 || ''}|${rec.ctx2 || ''}|${rec.geometry}`,
    pin: pinOf(doc),
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
  if (activeSet) {
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
function readTally(id) {
  // A totalling in flight is about to replace this very file — nothing reads
  // it meanwhile, least of all the screens' four-second polls.
  if (tallyRun && tallyRun.id === id && !tallyRun.error) return null;
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
  dropCheckpoint(doc.id);
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
    rows: rows.slice(from, from + n).map(({ _i, ...rest }) => rest),
  };
}

// THE STAGE 2 TABLE, IN ONE DEFINITION (3.78.0, owner order 2026-09-06: "the
// carry from table 2 must NOT ignore filters!").
//
// The screen draws these rows and the stage 3 carry reads them, and the
// owner's filters have to mean the same thing on both. They could not before:
// the carry read RAW RECORDS, and half the filters name a field that only
// exists once the row is built -- `members` is counted here, `moneyAll` is
// called `money` on the record, and the place is not known until the table is
// in order. A filter applied to a raw record would have matched nothing at
// all. So the rows, the order and the place are worked out here, once, and
// both callers take them.
function stage2Rows(id) {
  return allRecords(id).map((r) => ({
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
}
// the saved sort orders the whole table; best all-members forecast score
// first when none is saved. Ties keep their carry position either way, so the
// order is total and two reads page identically. The place is settled BEFORE
// the filters, so a filtered table still says where each row stands in the
// whole set -- and `stage 1 order at most` filters on that same number.
function stage2Ordered(doc, rows) {
  const out = Array.isArray(doc.sort) && doc.sort.length
    ? applySort(2, rows, doc.sort, (a, b) => a.carriedRank - b.carriedRank)
    : rows.slice().sort((a, b) => ((b.scoreAll ?? -1e9) - (a.scoreAll ?? -1e9)) || (a.carriedRank - b.carriedRank));
  return out.map((r, i) => ({ ...r, rank: i + 1 }));
}
function stage2Table(id, from, n, filters = null) {
  const doc = getSet(id);
  if (!doc) return null;
  const ordered = stage2Ordered(doc, stage2Rows(id));
  const of = ordered.length;
  const rows = applyFilters(2, ordered, filters);
  return {
    total: rows.length, of, from, sort: doc.sort || [], picked: pickedOf(doc),
    // what the launch will read: the filters saved on the set, and how many
    // rows they leave. The screen has to be able to say so before a start.
    saved: doc.filters || null,
    rows: rows.slice(from, from + n).map(({ carriedRank, ...rest }) => rest),
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
const acrossBusy = () => (acrossRun && !acrossRun.result && !acrossRun.error ? 'the Funnel is reading the other units' : null);
// and Verify's own read of the other units (3.88.0): the same boards, so
// neither reads while the other does
let othersRun = null;   // { id, token, done, of, result, error, promise }
const othersBusy = () => (othersRun && !othersRun.result && !othersRun.error ? `the other units of ${othersRun.id} are being read on Verify` : null);
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
  // 3.81.0, owner order: no other load while step 6's press is working.
  const richNow = richBusy();
  if (richNow) throw new Error(`${richNow} — reading across the other units would fight it for the same workers`);
  if (othersBusy()) throw new Error(`${othersBusy()} — the same boards, one reading at a time`);
  if (holdBusy()) throw new Error(`${holdBusy()} — the same boards, one reading at a time`);
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

// ---- WHICH CROSSES ARE WORTH READING, STARTED AND POLLED (§18) -------------
//
// Same shape as `read the other units`: one reading at a time, keyed on
// everything that could change the answer, polled by the page. Keyed on the
// FLOOR as well as the rule and the bar, because a thin-square floor changes
// which squares count and so changes every block on every pair.
let crossesRun = null;
function crossesKeyOf(id, state) {
  const S4 = require('./funnelset');
  return JSON.stringify([id, state.unit == null ? '' : String(state.unit), S4.normaliseRule(state.rule),
    require('./funnel').barPctOf(state), Math.max(0, Math.floor(Number(state.floor) || 0))]);
}
const crossesStatus = (run) => ({
  running: !run.result && !run.error,
  token: run.token, done: run.done, of: run.of, msEach: run.msEach,
  startedAt: new Date(run.startedAt).toISOString(),
  error: run.error, result: run.result,
});
async function funnelCrosses(id, state = {}, note = null) {
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  const t = readTally(id);
  if (!t) throw new Error('this set has no totalled tables yet');
  const F = require('./funnel');
  const S4 = require('./funnelset');
  const board = await funnelBoard(id, t, state.unit);
  const all = withFunnelRich(board.all, readFunnelRich(id));
  const rows = S4.applyRule(all, S4.normaliseRule(state.rule));
  return F.crossesWorthReading(rows, { floor: state.floor, barPct: state.barPct, seed: state.seed || id }, note);
}
function funnelCrossesStart(id, state = {}) {
  // 3.81.0, owner order: no other load while step 6's press is working.
  const richNow = richBusy();
  if (richNow) throw new Error(`${richNow} — reading the pairs would fight it for the same workers`);
  const key = crossesKeyOf(id, state);
  if (crossesRun) {
    if (crossesRun.key === key && !crossesRun.error) return crossesStatus(crossesRun);
    if (!crossesRun.result && !crossesRun.error) throw new Error('the crosses are still being read for another rule — one reading at a time');
  }
  const startedAt = Date.now();
  const run = { key, token: `${id}:${startedAt}`, id, startedAt, done: 0, of: 0, msEach: null, result: null, error: null, promise: null };
  crossesRun = run;
  run.promise = funnelCrosses(id, state, (done, of) => {
    run.done = done; run.of = of;
    // THE ESTIMATE CORRECTS ITSELF off the pairs actually read, so a box slower
    // than the one this was measured on stops promising the measured time.
    run.msEach = done > 0 ? (Date.now() - startedAt) / done : null;
  })
    .then((result) => { run.result = result; run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return crossesStatus(run);
}
function funnelCrossesStatus(id) {
  if (!crossesRun || crossesRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, msEach: null, error: null, result: null };
  return crossesStatus(crossesRun);
}

async function funnelRead(id, state = {}) {
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  if (doc.stage !== 3) throw new Error(`${doc.name || id} is a stage ${doc.stage} set — the Funnel reads stage 3`);
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
  // HOW MUCH OF THE PRESS'S WORK IS ALREADY DONE (3.81.0, owner order 2026-09-07:
  // "when the services are resting using the button fires the entire process
  // again ... code it right"). Same lookup withFunnelRich uses, so the press
  // can be DEAD when there is nothing left to work out, instead of telling the
  // owner to press it again and then quietly pricing the lot a second time.
  // `run` is the press already going, so a page that was reloaded in the middle
  // of one picks it back up rather than offering to start it.
  //
  // COUNTED ON THE WHOLE BOARD, NOT THE SURVIVORS (3.102.0, owner order
  // 2026-09-10: prep the entire record set before the funnel is walked). While
  // it counted survivors, the press read as done the moment today's rule
  // happened to keep only settings a previous walk had priced -- and the
  // ranking read (Part 4) needs every setting on the board, not the ones some
  // rule kept.
  const richHas = (r) => {
    const x = (rich && rich.settings) ? rich.settings[r.label] : null;
    if (!x) return false;
    return !(r.unit && x.units && !x.units[r.unit]);
  };
  const richOn = { have: all.filter(richHas).length, need: all.length, run: funnelRichStatus(id) };
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
  // THE FOUR PARTS GO WITH THE KEY (3.80.0, owner order 2026-09-07: the coin
  // and shape box becomes a field per part). The page cannot offer a coin
  // list, an alongside list or a shape list out of a joined-up name without
  // taking the name apart again -- and a screen that re-derives what the
  // service already knows is a second place for the two to disagree.
  const units = unitsOfSet(t, id).map((u) => ({
    key: u.key, name: u.name, trade: u.trade, ctx1: u.ctx1 || null, ctx2: u.ctx2 || null, geometry: u.geometry,
  }));
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

  // WHAT THIS BOARD HAS TO BEAT BESIDES LUCK (3.70.0, owner order). Both
  // readings, on every step: the whole board, so the owner knows before
  // choosing anything whether there is a rule worth hunting here at all, and
  // the survivors, so it cannot drift out of sight while they narrow.
  // ON TEST MONEY, NOT HELD-BACK (3.107.0, owner order). The Funnel is a
  // screen for CHOOSING, and a held-back figure read while choosing is a look
  // spent before the rule exists (SELECTION-DESIGN.md Part 3). Both readings
  // are here for the same reason they were before: the whole board, so it is
  // known before anything is narrowed whether there is a rule worth hunting,
  // and the survivors, so it cannot drift out of sight while they narrow.
  const against = board.unit
    ? { board: againstTestControls(id, board.unit, all), keeping: againstTestControls(id, board.unit, rows) }
    : { board: { known: false, why: 'the four things a rule has to beat are kept per coin and shape, and this is the blend of all of them' }, keeping: { known: false } };
  // AND IT IS A MARK, not a note that scrolls away. Losing to buying the coin
  // and going away is not a detail about a rule; it is a reason the rule has
  // no business existing, and the set has to carry it.
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
    richOn,
    // THE STAGE 4 SETS ALREADY CUT FROM THIS COIN AND SHAPE (3.58.0). One read,
    // one truth about which sets belong to the board on screen.
    cuts: funnelCutsFor(id, board.unit),
    // what this board and these survivors have to beat besides luck (3.70.0)
    against,
    reading: null,
    // the conditions a mark is recorded for, worked out for THIS step (§16.5)
    conditions: {},
  };
  // ON EVERY STEP, not only where the rule is finished: a rule that already
  // loses to buying the coin and going away is not going to be rescued by the
  // next narrowing, and the owner should be able to stop.
  if (against.keeping.known) {
    out.conditions.losesToBuyHold = against.keeping.beatsBuyHold === false;
    out.conditions.losesToShortHold = against.keeping.beatsShortHold === false;
  }
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
  // IN THE STAGE 4 VIEW THERE IS NO STEP TO READ (3.58.0). The heading there
  // still wants the check, the units and the cut sets; the grid, the region and
  // the rest are minutes of work for a screen that is not drawn.
  if (state.view === 'cut') return out;
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
    // WHAT READING EVERY PAIR WOULD COST, on the screen before it is started
    // (§18.5). Cheap: one pass over the survivors to see which dials still
    // have two values, and arithmetic from there.
    out.reading.crossesOffer = F.crossesOffer(rows, { floor });
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
    // THE BAR A SETTING HAS TO CLEAR (3.64.0). Zero is what it has always been.
    // The SAME bar goes to every scrambled copy below, or a region grown under
    // a looser bar would be compared against copies measured under a stricter
    // one, which is not a comparison.
    const atLeast = Number.isFinite(Number(state.regionAtLeast)) ? Number(state.regionAtLeast) : 0;
    // THE TWO WALLS THAT ARE NOT MONEY (3.65.0, owner order 2026-09-04: "write
    // some code that expands the REGION SIZE as i wanted"). Loosening the money
    // bar alone can only fill holes inside one slice of the board, and a board
    // still free on a word-valued dial is cut into slices a region may never
    // cross -- so the size can sit dead still however low the bar goes. `across`
    // lets the region step over a named word-valued dial; `reach` lets a step
    // span more than one notch, so a setting simply missing from the board is
    // not a wall either. Both default to what they have always been.
    const across = (Array.isArray(state.regionAcross) ? state.regionAcross : []).filter((d) => F.CATEGORICAL_DIALS.includes(d));
    const reach = Number.isFinite(Number(state.regionReach)) && Number(state.regionReach) >= 1 ? Math.floor(Number(state.regionReach)) : 1;
    const region = (list, moneyOf = F.money) => require('./plateau').widestRegion(
      list.map((r) => ({ ...r, pnl: moneyOf(r), trades: r.avgTrades == null ? 1 : r.avgTrades })),
      { minTrades: 0, atLeast, across, reach, orderedAxes: ordered, categoricalAxes: F.CATEGORICAL_DIALS },
    );
    out.reading = region(rows);
    out.reading.atLeast = atLeast;
    out.reading.regionReach = reach;
    out.reading.regionAcross = across;
    // WHICH WORD-VALUED DIALS THE SCREEN MAY OFFER, read off this board and
    // never typed (RULE FIVE). A dial the rule already pinned has one value
    // here and crossing it would do nothing, so it is not offered.
    out.reading.canCross = F.CATEGORICAL_DIALS
      .filter((d) => new Set(rows.map((r) => (r[d] == null ? 'none' : String(r[d])))).size > 1)
      .map((d) => ({ dial: d, values: [...new Set(rows.map((r) => (r[d] == null ? 'none' : String(r[d]))))].sort() }));
    // THE REGION AS A RULE (§16.4, step 5): its edges on every ordered dial and
    // its values on every word-valued one, with what keeping it would leave
    const keep = S4.regionRule(out.reading, { ordered, categorical: F.CATEGORICAL_DIALS });
    const keepRule = { ...rule, ranges: keep.ranges, allowed: keep.allowed };
    // BOTH RULES AND BOTH COUNTS (3.106.0, owner order 2026-09-10). The two
    // presses on this step end on 72 of 2,752 apiece and neither said so, and
    // a rule that keeps the same rows TODAY is still a different rule: it is
    // the rule that gets re-applied to the scrambled copies and written onto
    // the Stage 4 set, so on a shuffle the two keep different rows.
    //
    // `same` is the honest answer to "does this press change anything": the two
    // rules compared as rules, not as the rows they happen to pick.
    const sameRule = JSON.stringify(S4.normaliseRule(keepRule)) === JSON.stringify(S4.normaliseRule(rule));
    out.reading.keep = {
      ...keep,
      keeps: out.reading.size ? S4.applyRule(all, keepRule).length : 0,
      sentence: out.reading.size ? S4.ruleSentence(keepRule) : null,
      // the rule the owner arrived with: what it keeps on this board is what
      // the region was read over, so it is already counted
      mineKeeps: rows.length,
      mineSentence: S4.ruleSentence(rule),
      same: out.reading.size ? sameRule : null,
    };
    // WHAT THE THRESHOLD PAPERED OVER, marked on the walk (owner: "and noted of
    // course"). The count itself is the region reader's, taken on the region's
    // own members: the settings it holds that do NOT make money, and the worst
    // of them. At the bar's old value there are none of either.
    out.conditions.regionPapered = (out.reading.papered || {}).n > 0;
    out.conditions.regionAcross = across.length > 0;
    out.conditions.regionReach = reach > 1;
    // ALL of the copies here, unlike the readings above that only compare: "wider
    // than luck" off one copy is a coin toss; "wider than all ten" is the claim
    // the count on Sweep exists to buy. With halves, the size on each half.
    // AND WHAT EACH ONE MADE, not only how wide it was (3.106.0, owner order
    // 2026-09-10). A size on its own cannot be read: a scrambled copy with a
    // WIDER region than yours could be seventy-two settings each making a
    // penny, and the line looked identical either way. No new figure is
    // exposed by this -- every number on this screen is already test money.
    const each = [];
    if (kind === 'scrambles') {
      for (let d = 0; d < keptN; d++) {
        const r = region(rows, F.moneyAt(d));
        each.push({ size: r && r.size != null ? r.size : null, avg: r ? r.avgPnl : null });
      }
    } else {
      for (const x of [ha, hb]) { const r = region(x); each.push({ size: r && r.size != null ? r.size : null, avg: r ? r.avgPnl : null }); }
    }
    const mine = out.reading && out.reading.size != null ? out.reading.size : null;
    out.reading.noise = {
      of: keptN, used: kind === 'scrambles' ? keptN : 2, kind, copies: each,
      widest: each.reduce((a, v) => (v.size != null && (a == null || v.size > a) ? v.size : a), null),
      beatenBy: mine == null ? null : each.filter((v) => v.size != null && mine > v.size).length,
      // AS MANY AS REACHED IT, said as a count rather than left to be worked
      // out from a subtraction: this is the number the owner asked about.
      matched: mine == null ? null : each.filter((v) => v.size != null && v.size >= mine).length,
      // and the bar the owner set on this step, so one line cannot say 75% is
      // the bar while the next says nothing short of every copy counts
      barPct: check.barPct == null ? null : check.barPct,
    };
    out.conditions.regionNotWider = mine == null ? null : out.reading.noise.beatenBy < each.length;
    out.reading.regionAtLeast = atLeast;
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

// HOW MANY THE RULE ON SCREEN WOULD KEEP, WHILE IT IS BEING TYPED (3.81.0,
// owner order 2026-09-07: "when putting numbers in the worst losing streak
// allowed and fewest trades the remaining settings size needs to be
// continuously displayed so we can try for our target without shooting in the
// dark").
//
// It takes a WHOLE RULE and answers with a count. It does not know about those
// two boxes and must not: the page merges what is typed into the rule it
// already holds and sends that, so the number under the boxes comes out of the
// same applyRule the walk itself uses. A second filter written here to mean
// "the same thing" is how two numbers that must agree stop agreeing.
//
// Cheap enough to ask on every keystroke: the board is the one already in hand
// (unitBoardInHand, keyed on the set, its totalling and the unit), so this is a
// pass over rows that are already in memory.
async function funnelKeeps(id, state = {}) {
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  const t = readTally(id);
  if (!t) return null;                       // no tables yet; the caller starts a totalling as the read does
  const S4 = require('./funnelset');
  const board = await funnelBoard(id, t, state.unit);
  const all = withFunnelRich(board.all, readFunnelRich(id));
  const rule = S4.normaliseRule(state.rule);
  return { keeps: S4.applyRule(all, rule).length, of: all.length };
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

// ---- DOES THE RANKING HOLD? (3.102.0, SELECTION-DESIGN.md Part 4) -----------
//
// Rank every setting of one coin and shape on one part of the test window and
// score them on another part. If the order survives the boundary, the way of
// choosing has not been ruled out; if it does not, everything chosen by that
// order is chosen by nothing.
//
// READS NOTHING FROM THE HELD-BACK WINDOW OR THE RESERVE, which is what makes
// it legal on a screen used for choosing. Every number comes out of the test
// window, worked out in three parts by the pricing that already ran.
//
// TWO STEPS, ON PURPOSE. The reading is one board at a time off disk and costs
// seconds a board; the three numbers the owner sets are arithmetic on what came
// back. So the reading is kept and the numbers re-apply to it -- moving a bar
// never re-reads a board.
let holdRun = null;   // { id, token, startedAt, done, of, result, error, promise }
const holdBusy = () => (holdRun && !holdRun.result && !holdRun.error
  ? `the ranking of ${holdRun.id} is being read` : null);

async function funnelRankHoldRead(id, note = null) {
  const RH = require('./rankhold');
  const t = readTally(String(id));
  if (!t) throw new Error('this set has no totalled tables yet, so there is no board to rank');
  const rich = readFunnelRich(String(id));
  if (!rich || !rich.settings) {
    throw new Error('nothing in this set carries what each setting made in each part of the test window — press work out the missing numbers first');
  }
  const units = unitsOfSet(t, String(id));
  // HOW LONG EACH UNIT'S TEST WINDOW ACTUALLY WAS, read off what the run
  // recorded (3.85.0's per-unit windows) and never re-derived from the layout:
  // a weekly shape gets about sixteen chunks a part where a daily one gets over
  // a hundred, and that is the difference between a reading and noise. The
  // parts are cut at floor(n/3) and floor(2n/3), so the SMALLEST of the three
  // is floor(n/3) -- the honest number to put a floor against.
  const doc = getSet(id);
  const recorded = (((doc || {}).windows || {}).units) || {};
  const chunksAPartOf = (key) => {
    const w = recorded[key];
    const n = w && w.test && Number(w.test.chunks);
    return Number.isFinite(n) && n > 0 ? Math.floor(n / 3) : null;
  };
  const out = [];
  if (note) note(0, units.length);
  for (const u of units) {
    // eslint-disable-next-line no-await-in-loop
    const rows = withFunnelRich(await loadUnitBoard(String(id), t, u.key), rich);
    out.push({ unit: u.key, name: u.name, ...RH.holdOfUnit(rows, chunksAPartOf(u.key)) });
    if (note) note(out.length, units.length);
  }
  return out;
}
// The reading, with the owner's three numbers laid on it. Kept in ONE place
// (lib/rankhold.js) so a screen can never work out a pass for itself.
const holdAnswer = (run, bar) => {
  const RH = require('./rankhold');
  return {
    running: !run.result && !run.error,
    token: run.token,
    done: run.done,
    of: run.of,
    startedAt: new Date(run.startedAt).toISOString(),
    error: run.error,
    result: run.result ? { ...RH.withBar(run.result, bar), setId: run.id } : null,
  };
};
const holdNone = (id) => ({ running: false, none: true, token: null, done: 0, of: 0, startedAt: null, error: null, result: null, setId: String(id) });

// START, OR ANSWER THE ONE ALREADY READ. The reading does not depend on the
// rule, the board on screen or the bar, so the same set asked again is answered
// from what is in hand however the numbers have moved since.
function funnelRankHoldStart(id, bar = {}) {
  if (holdRun && !holdRun.result && !holdRun.error) {
    if (holdRun.id === String(id)) return holdAnswer(holdRun, bar);
    throw new Error(`the ranking of ${holdRun.id} is being read — one reading at a time`);
  }
  if (holdRun && holdRun.result && holdRun.id === String(id)) return holdAnswer(holdRun, bar);
  const richNow = richBusy();
  if (richNow) throw new Error(`${richNow} — reading the ranking would fight it for the same boards`);
  if (othersBusy()) throw new Error(`${othersBusy()} — the same boards, one reading at a time`);
  if (acrossBusy()) throw new Error(`${acrossBusy()} — the same boards, one reading at a time`);
  if (holdBusy()) throw new Error(`${holdBusy()} — the same boards, one reading at a time`);
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  const startedAt = Date.now();
  const run = { id: String(id), token: `${id}:${startedAt}`, startedAt, done: 0, of: 0, result: null, error: null, promise: null };
  holdRun = run;
  run.promise = funnelRankHoldRead(String(id), (done, of) => { run.done = done; run.of = of; })
    .then((result) => { run.result = result; run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return holdAnswer(run, bar);
}
// A READING ALREADY TAKEN IS THROWN AWAY when the numbers beside the set are
// worked out again, because those numbers are what it was read from.
function funnelRankHoldForget(id) { if (holdRun && holdRun.id === String(id)) holdRun = null; }
function funnelRankHoldStatus(id, bar = {}) {
  if (!holdRun || holdRun.id !== String(id)) return holdNone(id);
  return holdAnswer(holdRun, bar);
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
// 3 (3.107.0): the file also carries the four things a rule has to beat, read
// on the TEST window, per unit. A file of the older shape reads as absent and
// the screen offers the rebuild again (RULE NINE) -- nothing translates.
const FUNNEL_RICH_V = 3;
// IT ADDS TO WHAT IS ALREADY THERE. IT NEVER REPLACES IT (3.68.0, owner order
// 2026-09-05: "if we support multiple passes through the same stage 3 data,
// saving stage 4 data sets to look for alternate rules, and then your design
// doesn't bother saving the stage 4 data properly, THEN THAT'S JUST BAD
// DESIGN").
//
// This used to write only the settings the press had just worked out, over the
// top of every setting any earlier press had worked out. So a second walk on
// the same stage 3 records silently took these numbers away from the first
// walk's Stage 4 set -- and the two limits on step 6 read them, so that set's
// rule went from keeping 116 settings to keeping none, while its screen went on
// showing the 116 names it wrote down. Measured on the owner's box: 116 written
// down, 116 still on the board, 0 still carrying a worst losing streak.
//
// Adding is safe because these numbers are a property of the setting and the
// records it was priced from, not of the press: the same setting priced again
// gives the same answer, which is what the proof beside the press checks.
function saveFunnelRich(id, perSetting, testControls = null) {
  const had = readFunnelRich(id);
  const out = {
    v: FUNNEL_RICH_V, savedAt: new Date().toISOString(), release: require('../package.json').version,
    settings: had && had.settings ? { ...had.settings } : {},
    // THE FOUR ON THE TEST WINDOW, PER UNIT (3.107.0). Keyed by unit and by
    // hold length, exactly as the held-back ones are on the set, and merged the
    // same way the settings are: a pass over one unit tops its own entry up and
    // leaves the others alone.
    testControls: { ...((had && had.testControls) || {}), ...(testControls || {}) },
  };
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
  return {
    settings: Object.keys(out.settings).length,
    added: [...perSetting.keys()].length,
    kept: had && had.settings ? Object.keys(had.settings).length : 0,
    fields: RICH_FIELDS,
    testControlUnits: Object.keys(out.testControls).length,
  };
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
// A STAGE 4 SET'S OWN COPY OF THE REBUILT NUMBERS, laid onto board rows
// (3.68.0). The parent's file goes on first and this fills what it did not: so
// the set's own screen is complete whatever has happened to the parent's file
// since, and a set whose parent has been re-totalled still shows its columns.
function withOwnRich(rows, own) {
  if (!own || !Object.keys(own).length) return rows;
  return rows.map((r) => {
    const x = own[r.label];
    if (!x) return r;
    const o = { ...r };
    // == null, not === undefined: the parent's file leaves a field it does not
    // hold absent, and a board row can carry an explicit null. Both are "not
    // there" and both are what this exists to fill.
    for (const [f, v] of Object.entries(x)) if (o[f] == null) o[f] = Array.isArray(v) ? v.slice() : v;
    return o;
  });
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
async function cutFunnelSet(parentId, state = {}, note = null) {
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
  // THE RULE THE OWNER BUILT (3.61.0). The page hands it over at the moment step
  // 5 replaced it; a walk that never pressed that button has none, and its final
  // rule IS the owner's.
  doc.userRule = state.userRule ? S4.normaliseRule(state.userRule) : null;
  // the stage-engine check's own sets are marked, and kept off every screen's list (3.87.0)
  doc.exam = !!state.exam;
  const closed = S4.ruleWithClosing(ranked, state.rule, state.closing, doc.target);
  doc.rule = closed.rule;
  // IN CHUNKS, LETTING GO OF THE THREAD BETWEEN THEM (3.67.0, owner order). A
  // pass over the whole parent board is not long on its own; this one runs on
  // the thread that answers every other screen, so it hands it back as it goes.
  const survivors = await S4.applyRuleSlowly(ranked, doc.rule, note);
  S4.finishFunnelSet(doc, survivors, { key: closed.key, detail: closed.detail });
  // THE REPLAY IS CHECKED BEFORE THE SET IS SAVED, not asserted in a test and
  // hoped for in production. A set whose rule does not reproduce its own
  // survivors is a story about a decision rather than the decision.
  // It is handed the survivors just worked out rather than working the same
  // list out a second time over the same board.
  const check = S4.replay(doc, ranked, survivors);
  if (!check.same) {
    throw new Error(`the rule does not reproduce its own survivors (${check.got} vs ${check.had}) — refusing to write it`);
  }
  doc.replayChecked = { at: new Date().toISOString(), ...check };
  // AND THE SET KEEPS ITS OWN COPY OF THE REBUILT NUMBERS (3.68.0, owner order).
  // The shared file beside the parent adds rather than replaces now, but it is
  // still the PARENT's, and the parent can be re-totalled, re-folded or deleted
  // -- every one of which takes it away. A Stage 4 set is a record of a
  // decision; it does not get to depend on a file somebody else owns. Its own
  // survivors' numbers ride on the set, and its screen reads them from there.
  doc.rich = richForSurvivors(survivors);
  saveSet(doc);
  return doc;
}

// The rebuilt numbers of a list of board rows, by setting name -- only the
// fields the rebuild produces, and only where there is a number to keep. A row
// that never had them contributes nothing rather than a row of nulls.
function richForSurvivors(rows) {
  const out = {};
  for (const r of rows || []) {
    const one = {};
    for (const f of RICH_FIELDS) {
      const v = r[f];
      if (v == null || !Number.isFinite(Number(v))) continue;
      one[f] = Number(v);
    }
    if (Array.isArray(r.pnlThirds) && r.pnlThirds.some((x) => x != null)) one.pnlThirds = r.pnlThirds.slice();
    if (Object.keys(one).length) out[r.label] = one;
  }
  return out;
}

// ---- WHAT A RULE HAS TO BEAT BESIDES LUCK (3.70.0, owner order 2026-09-05) --
//
// "if those XRPUSDT funnels were just working under conditions that don't make
// sense for building rules then better to know that up front and not waste a
// bunch of time trying to make rules."
//
// The scrambled copies only ask "is this better than noise". They never ask
// "is this better than the obvious thing" -- and buying the coin and going
// away IS the obvious thing. A rule that loses to it has no reason to exist,
// whatever it does against a shuffle.
//
// The four numbers are on the set, per unit, per 24/7-or-24/5, per hold length
// (they are properties of the window and the horizon, never of a setting). A
// reading takes the hold lengths the rows in front of the owner actually use:
// one number when they agree, the span when they do not, because a single
// number over several horizons would be a number about nothing.
const CONTROL_KEYS = ['alwaysLong', 'alwaysShort', 'buyHold', 'shortHold'];
// EVERY SETTING IS HELD UP TO THE FOUR AT ITS OWN HORIZON AND ITS OWN 24/7 or
// 24/5. A rule keeping settings at three hold lengths is not being read at one
// of them, and a single number over three would be a number about nothing.
const controlKeyOf = (r) => `${r && r.weekdaysOnly ? 'wk' : 'all'}|${Number(r && r.tHours)}`;
function controlsOf(doc, unitKey, keys) {
  const table = ((doc || {}).controls || {}).units || null;
  if (!table) return { known: false, why: 'this record set was priced before the four things a rule has to beat were kept' };
  const mine = table[unitKey] || null;
  if (!mine) return { known: false, why: `this record set kept nothing to beat for ${unitKey}` };
  const want = [...new Set(keys || [])].sort();
  const rows = want.map((k) => mine[k]).filter(Boolean);
  if (!rows.length) return { known: false, why: 'nothing was kept at the hold lengths these settings use' };
  const out = { known: true, keys: want, of: rows.length, missing: want.length - rows.length };
  for (const k of CONTROL_KEYS) {
    const vals = rows.map((r) => r[k]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
    out[k] = vals.length ? { lo: Math.min(...vals), hi: Math.max(...vals) } : null;
  }
  return out;
}
// THE SAME FOUR, ON TEST MONEY (3.107.0, owner order 2026-09-10). The Funnel
// draws this and the held-back reading is gone from that screen: the four are
// the one question that settles whether money came from the forecast or from
// the coin's direction, and asking it needed the held-back window opened --
// which is after the choosing is done, so it could not be asked at all while
// it still mattered (SELECTION-DESIGN.md Part 3).
//
// Read out of the rebuilt-numbers file beside the set, not off the records: the
// four do not depend on the setting, only on the unit's test window and the
// hold length, so they ride there per unit. A set whose file predates them
// says so and offers the press, exactly as a missing column does.
function againstTestControls(id, unitKey, rows) {
  const F = require('./funnel');
  const rich = readFunnelRich(String(id));
  const table = (rich && rich.testControls) || null;
  const none = (why) => ({ known: false, why, real: null, of: 0 });
  if (!table) {
    return none('the numbers beside this set do not carry what the four things a rule has to beat made on the test window — press work out the test history numbers');
  }
  const mine = unitKey ? table[String(unitKey)] : null;
  if (!mine) {
    return none(unitKey
      ? `nothing was worked out for ${unitKey} — press work out the test history numbers`
      : 'the four are kept per coin and shape, and this is the blend of all of them');
  }
  const want = [...new Set((rows || []).map(controlKeyOf))].sort();
  const got = want.map((k) => mine[k]).filter(Boolean);
  if (!got.length) return none('nothing was worked out at the hold lengths these settings use');
  let sum = 0;
  let n = 0;
  for (const r of rows) { const v = r.avgTest; if (v != null && Number.isFinite(Number(v))) { sum += Number(v); n++; } }
  const real = n ? sum / n : null;
  const out = { known: true, keys: want, of: n, missing: want.length - got.length, real };
  for (const k of CONTROL_KEYS) {
    const vals = got.map((r) => r[k]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
    out[k] = vals.length ? { lo: Math.min(...vals), hi: Math.max(...vals) } : null;
  }
  if (real == null) return { ...out, known: false, why: 'these settings carry no test money to compare' };
  // BEATEN MEANS BEATEN AT THE WORST OF THE HOLD LENGTHS IN USE, the same rule
  // the held-back reading uses -- a rule that only clears the kindest horizon
  // it touches has not cleared the bar it is read at.
  for (const k of CONTROL_KEYS) out[`beats${k[0].toUpperCase()}${k.slice(1)}`] = out[k] ? F.beats(real, out[k].hi) : null;
  // and the best of the four, so the gate is against the hardest of them and
  // never against a pair the rule happens to clear (Part 2)
  const known = CONTROL_KEYS.filter((k) => out[k] != null);
  out.best = known.length === CONTROL_KEYS.length
    ? known.map((k) => ({ key: k, hi: out[k].hi })).reduce((a, b) => (b.hi > a.hi ? b : a))
    : null;
  out.beatsBest = out.best ? F.beats(real, out.best.hi) : null;
  return out;
}

// The rows' own money against them. `real` and the controls are the same
// arithmetic on the same window at the same stake, so they subtract.
function againstControls(doc, unitKey, rows) {
  const F = require('./funnel');
  const got = controlsOf(doc, unitKey, (rows || []).map(controlKeyOf));
  let sum = 0;
  let n = 0;
  for (const r of rows) { const v = r.avgHold; if (v != null && Number.isFinite(Number(v))) { sum += Number(v); n++; } }
  const real = n ? sum / n : null;
  const out = { ...got, real, of: n };
  if (!got.known || real == null) return out;
  // BEATEN MEANS BEATEN AT THE WORST OF THE HOLD LENGTHS IN USE, not at the
  // kindest of them: a rule that only clears the easiest horizon it touches
  // has not cleared the bar it is actually being read at.
  for (const k of CONTROL_KEYS) {
    const c = got[k];
    out[`beats${k[0].toUpperCase()}${k.slice(1)}`] = c ? F.beats(real, c.hi) : null;
  }
  return out;
}

// ---- THE CUT, STARTED AND POLLED (3.67.0, owner order 2026-09-04) ----------
//
// "when i use a button such as 'write the Stage 4 set' you must not allow the
// page processing to freeze ... items like that need to leave a few cpu cycles
// to service going to the Setup | Compute tab for example without this kind of
// thing: NO ANSWER IN TIME ... HTTP 504".
//
// Yielding keeps the box answering while the cut runs; it does not make the cut
// FINISH sooner, so the browser can still give up waiting on the one request.
// The reading of every pair on step 3 and the reading across the other units
// already work this way: the press starts it, the page asks how far it is, and
// nothing is held open. The cut is the third.
let cutRun = null;
function cutStatus(run) {
  return {
    running: !run.result && !run.error,
    token: run.token, done: run.done, of: run.of,
    error: run.error, result: run.result,
  };
}
function cutFunnelSetStart(parentId, state = {}) {
  // 3.81.0, owner order: no other load while step 6's press is working.
  const richNow = richBusy();
  if (richNow) throw new Error(`${richNow} — writing a Stage 4 set would fight it for the same workers`);
  if (cutRun && !cutRun.result && !cutRun.error) {
    if (cutRun.id === String(parentId)) return cutStatus(cutRun);
    throw new Error('another Stage 4 set is being written right now — one at a time');
  }
  const run = { id: String(parentId), token: `${parentId}:${Date.now()}`, done: 0, of: 0, result: null, error: null, promise: null };
  cutRun = run;
  run.promise = cutFunnelSet(parentId, state, (done, of) => { run.done = done; run.of = of; })
    .then((doc) => {
      run.result = {
        id: doc.id, name: doc.name, seq: doc.seq, unit: doc.unit || null, unitName: doc.unitName || null,
        survivors: doc.counts.survivors, target: doc.counts.target,
        ruleSentence: doc.ruleSentence, warnings: doc.warnings,
        closing: doc.closing, replayChecked: doc.replayChecked, marks: doc.marks || [],
      };
      run.done = run.of;
    })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return cutStatus(run);
}
function cutFunnelSetStatus(parentId) {
  if (!cutRun || cutRun.id !== String(parentId)) {
    return { running: false, none: true, token: null, done: 0, of: 0, error: null, result: null };
  }
  return cutStatus(cutRun);
}

// ---- WHAT THE BOX IS ACTUALLY DOING, WHILE IT DOES IT (3.81.0, owner order
// 2026-09-07: "needs to put on the screen beside or under the button the
// progress and the total cpu load") ----------------------------------------
//
// Not the one-minute load average: that is an average over the minute just
// gone, so at the start of a run it reports the idle box before it and at the
// end it still reports the run that has stopped. This is the REAL share of
// every core that was busy between this reading and the last one, read off the
// kernel's own per-core counters -- so a page asking every two seconds gets a
// two-second average, which is what somebody watching a progress line wants.
//
// Deterministic and local: os.cpus() and nothing else (RULE SEVEN).
// REQUIRED HERE, EXPLICITLY. It worked without this line -- something else
// on the box had put os on the global -- and code that runs because of an
// accident somewhere else is code that stops running when that accident is
// tidied up.
const os = require('os');
let cpuWas = null;
function cpuSample() {
  const cores = os.cpus() || [];
  let idle = 0; let total = 0;
  for (const c of cores) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total, cores: cores.length };
}
function cpuLoad() {
  const now = cpuSample();
  const was = cpuWas;
  cpuWas = now;
  // the first reading has nothing to difference against, and neither has one
  // taken in the same millisecond as the last -- say so rather than print a 0%
  // that reads as "the box is idle"
  if (!was || now.total <= was.total) return { busy: null, cores: now.cores };
  const busy = 1 - ((now.idle - was.idle) / (now.total - was.total));
  return { busy: Math.max(0, Math.min(1, busy)), cores: now.cores };
}

// ---- STEP 6's PRESS, STARTED AND POLLED (3.81.0, owner order: "needs to not
// time out after 1 minute") --------------------------------------------------
//
// It used to be done inside the POST, which held the request open for as long
// as the pricing took. The web server in front allows sixty seconds, so any
// set big enough to matter timed out and the owner was told nothing -- while
// the work carried on behind the dead request. Every other pressing thing on
// this screen was moved to started-and-polled in 3.67.0; this was the one left.
//
// AND NOTHING ELSE MAY LOAD THE BOX WHILE IT RUNS (same order: "other loads
// are not allowed"). It is claimed through claimOrRefuse, so it will not start
// on top of a sweep, a stage run or a totalling; and stageBusy() names it, so
// those refuse on top of IT. The other four pressed jobs on this screen refuse
// by name where they start.
let richRun = null;
function richStatus(run) {
  return {
    running: !run.result && !run.error,
    token: run.token, done: run.done, of: run.of,
    // beside the count, so the owner can see the box working and not just a
    // number that has not moved
    cpu: cpuLoad(),
    error: run.error, result: run.result,
  };
}
// the held-back ride on Verify (3.88.0) is the same pricing pass, aimed at one
// unit, so it is named here and every refusal built on richBusy() covers it
let rideRun = null;   // { id, token, done, of, result, error, promise }
const rideBusy = () => (rideRun && !rideRun.result && !rideRun.error ? `the held-back ride of ${rideRun.id} is being worked out` : null);
// and the reserve grade on a Stage 4 set's unread window (3.89.0), the same pricing pass
let unreadRun = null;   // { id, token, done, of, result, error, promise }
const unreadBusy = () => (unreadRun && !unreadRun.result && !unreadRun.error ? `the reserve grade of ${unreadRun.id} is being priced` : null);
// What is stopping another load, in words fit for a refusal, or null.
// and the per-trade capture of a Stage 4 set for Tune (3.92.0), the same pricing pass again
let captureRun = null;   // { id, token, done, of, result, error, promise }
const captureBusy = () => (captureRun && !captureRun.result && !captureRun.error ? `the per-trade capture of ${captureRun.id} is being worked out` : null);
// and the History half-life run (3.94.0), the same pricing pass again per half-life
let halfLifeRun = null;   // { id, token, done, of, result, error, promise }
const halfLifeBusy = () => (halfLifeRun && !halfLifeRun.result && !halfLifeRun.error ? `the half-life run of ${halfLifeRun.id} is being worked out` : null);
const richBusy = () => (richRun && !richRun.result && !richRun.error
  ? `the missing numbers of ${richRun.id} are being worked out` : (rideBusy() || unreadBusy() || captureBusy() || halfLifeBusy()));
function funnelRichStart(id, state = {}) {
  if (richRun && !richRun.result && !richRun.error) {
    if (richRun.id === String(id)) return richStatus(richRun);
    throw new Error('another record set is having its missing numbers worked out right now — one at a time');
  }
  // and not on top of a ranking being read (3.102.0): the same boards, and this
  // one would move the very numbers that reading is being taken from
  if (holdBusy()) throw new Error(`${holdBusy()} — the same boards, one at a time`);
  const doc = getSet(id);
  if (!doc) throw new Error(`unknown record set '${id}'`);
  claimOrRefuse();
  const run = { id: String(id), token: `${id}:${Date.now()}`, done: 0, of: 0, result: null, error: null, promise: null };
  richRun = run;
  run.promise = (async () => {
    // THE WHOLE RECORD SET, NOT THE RULE'S SURVIVORS (3.102.0, owner order
    // 2026-09-10: "do an entire stage three record set prep before we start
    // running the funnel ... then get rid of that call further down").
    //
    // It used to rebuild only what the rule kept at that moment, which is why
    // the numbers beside a set covered a different slice of the board after
    // every walk. Part 4 of SELECTION-DESIGN.md cannot be read off a partial
    // board at all: it asks whether ranking the settings on one part of the
    // test window still picks winners on another part, and a ranking over the
    // survivors of a rule already made by ranking is no test of anything.
    //
    // saveFunnelRich MERGES, so on a set earlier walks have touched this tops
    // up what is missing rather than re-pricing what is there. That is why no
    // migration and no repair is needed for the sets already on the box.
    // ENSURE ANSWERS WHETHER, readTally ANSWERS WITH WHAT (fixed 3.103.1, owner
    // report: "FAILED -- this record set has no settings on its board"). This
    // read `ensureTally` into `t` and handed that to the board -- and on a set
    // whose tables are fine ensureTally answers `{ ready: true }`, which has no
    // `ranked` on it, so every press on every set came back with an empty board
    // and the refusal below. Two calls, because they answer two questions.
    const state = ensureTally(String(id));
    if (state.totalling || state.waiting || state.failed) {
      return { totalling: state.totalling || null, waiting: state.waiting || null, failed: state.failed || null };
    }
    const t = readTally(String(id));
    if (!t) throw new Error('the tables of this record set cannot be read, so there is nothing to work out');
    const board = await funnelBoard(String(id), t, 'all');
    const labels = (board.all || []).map((r) => String(r.label));
    if (!labels.length) throw new Error('this record set has no settings on its board, so there is nothing to work out');
    // THE PROOF STILL TRAVELS WITH THE ANSWER, and over the whole board rather
    // than the survivors, so it is a stronger check than the one it replaces.
    // What it checks against is the board's own stored money for each setting.
    const expect = {};
    for (const r of (board.all || [])) {
      if (r.avgTest != null && Number.isFinite(Number(r.avgTest))) expect[String(r.label)] = Number(r.avgTest);
    }
    run.of = labels.length;
    const got = await rebuildRichFor(doc, labels, { note: (done, of) => { run.done = done; run.of = of; } });
    const proof = proveRebuild(got.perSetting, expect);
    const kept = saveFunnelRich(doc.id, got.perSetting, got.testControls);
    // A RANKING ALREADY READ WAS READ FROM THESE NUMBERS, so it is dropped
    // rather than served beside numbers it never saw (3.102.0).
    funnelRankHoldForget(doc.id);
    return { settings: got.settings, units: got.units, failures: got.failures, proof, kept };
  })()
    .then((out) => { run.result = out; if (run.of) run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return richStatus(run);
}
function funnelRichStatus(id) {
  if (!richRun || richRun.id !== String(id)) {
    return { running: false, none: true, token: null, done: 0, of: 0, cpu: cpuLoad(), error: null, result: null };
  }
  return richStatus(richRun);
}

// ---- PUTTING A STAGE 4 SET'S REBUILT NUMBERS BACK (3.68.0, owner order) -----
//
// A set cut before 3.68.0 kept no copy of its own, and a later pass over the
// same stage 3 records replaced the shared file beside the parent. Those
// numbers are then nowhere on the box -- they cannot be copied from anything,
// only worked out again from the parent's records, which is exactly what the
// press on step 6 does. This aims that same machinery at ONE Stage 4 set's own
// survivors, adds the answer to the shared file and stamps the set's own copy.
//
// Started and polled: it prices, so it takes minutes, and a press must never
// hold a request open (3.67.0). It refuses while a sweep is going, the same as
// the step 6 press, because it reads the same units.
let setRichRun = null;
function setRichStatus(run) {
  return { running: !run.result && !run.error, token: run.token, done: run.done, of: run.of, error: run.error, result: run.result };
}
function rebuildSetRichStart(setId) {
  // 3.81.0, owner order: no other load while step 6's press is working.
  const richNow = richBusy();
  if (richNow) throw new Error(`${richNow} — working out a Stage 4 set's numbers would fight it for the same workers`);
  if (setRichRun && !setRichRun.result && !setRichRun.error) {
    if (setRichRun.id === String(setId)) return setRichStatus(setRichRun);
    throw new Error('another record set is having its numbers worked out right now — one at a time');
  }
  const doc = getSet(setId);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${setId}'`);
  const parent = getSet((doc.parent || {}).id);
  if (!parent) throw new Error(`the stage 3 set this was cut from is gone, so its numbers cannot be worked out again`);
  const labels = (doc.survivors || []).map((x) => x.label);
  if (!labels.length) throw new Error('this set wrote down no settings, so there is nothing to work out');
  const run = { id: String(setId), token: `${setId}:${Date.now()}`, done: 0, of: labels.length, result: null, error: null, promise: null };
  setRichRun = run;
  run.promise = rebuildRichFor(parent, labels, { note: (done, of) => { run.done = done; run.of = of; } })
    .then((got) => {
      const kept = saveFunnelRich(parent.id, got.perSetting);
      // and the set's own copy is written from the board it was just priced on
      const t = readTally(parent.id);
      return funnelBoard(parent.id, t, doc.unit || 'all').then((b) => {
        const all = withFunnelRich(b.all, readFunnelRich(parent.id));
        const want = new Set(labels);
        const fresh = getSet(setId);
        fresh.rich = richForSurvivors(all.filter((r) => want.has(r.label)));
        saveSet(fresh);
        run.result = { settings: got.settings, units: got.units, failures: got.failures, kept, own: Object.keys(fresh.rich).length };
        run.done = run.of;
      });
    })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return setRichStatus(run);
}
function rebuildSetRichStatus(setId) {
  if (!setRichRun || setRichRun.id !== String(setId)) return { running: false, none: true, token: null, done: 0, of: 0, error: null, result: null };
  return setRichStatus(setRichRun);
}

// ---- VERIFY: THE VERDICT ON A STAGE 4 RECORD SET (3.86.0, VERIFY-DESIGN.md) ----
//
// The set is read as a whole, never one row (owner decision 1, 2026-09-07). A
// dry read (funnelVerifyDry) draws the record's footing and hands back no
// held-back figure. The press (funnelVerifyStart) is the stamped look: it
// declares its rules BEFORE any number exists, reads every survivor joined to
// its parent's board -- never a page of them -- computes the readings in
// lib/funnelverify.js, appends one block to the set (newest first, nothing
// overwritten) and writes heldBackReadAt on the first press only. Started and
// polled, like every other press on the Funnel.

// every survivor of the set, joined to the board it was cut from
async function funnelVerifyJoin(doc) {
  const parentId = (doc.parent || {}).id || null;
  const parent = parentId ? getSet(parentId) : null;
  if (!parent) throw new Error(`the stage 3 set this was cut from (${parentId || 'unnamed'}) is gone, so its rows cannot be read back`);
  const t = readTally(parentId);
  if (!t) throw new Error(`${parent.name} has no totalled tables yet — open this set on the Funnel first, which starts the totalling`);
  const S4 = require('./funnelset');
  const board = await funnelBoard(parentId, t, doc.unit || 'all');
  const all = withFunnelRich(board.all, readFunnelRich(parentId));
  const mine = withOwnRich(all, doc.rich || {});
  const wanted = doc.survivors || [];
  const want = new Set(wanted.map((x) => x.label));
  const byLabel = new Map();
  for (const r of mine) if (want.has(r.label)) byLabel.set(r.label, r);
  // EVERY SURVIVOR, in the record's own order, and never a page of them; one no
  // longer on the board is counted as gone, never invented
  const rows = wanted.map((x) => byLabel.get(x.label) || null);
  const gone = rows.filter((r) => !r).length;
  const rule = S4.normaliseRule(doc.rule);
  // DOES THE RULE STILL GIVE THIS LIST? Asked of the set's OWN copy of the
  // numbers (3.68.0): a limit on the worst losing streak reads a rebuilt
  // number, and the parent's shared file can lose that column to a later pass
  // while the set's own copy keeps it. The parent's board is asked too, and
  // the two answers are both reported; only the set's own decides (review,
  // 2026-09-08 -- the first cut refused on the parent's file alone).
  const now = S4.applyRule(mine, rule);
  const same = now.length === wanted.length && now.every((r) => want.has(r.label));
  const nowAll = S4.applyRule(all, rule);
  const sameOnParent = nowAll.length === wanted.length && nowAll.every((r) => want.has(r.label));
  return { parent, t, all, mine, rows: rows.filter(Boolean), gone, same, now: now.length, sameOnParent, nowOnParent: nowAll.length, had: wanted.length, rule, unit: board.unit || null };
}
// the sealed window on this set's own unit, read off what the cut recorded
function sealedOnUnitOf(doc) {
  const s = doc.sealed || null;
  if (!s) return { sealed: false, of: 0, missing: 0, why: 'this set recorded no sealed window', fromTs: null, chunks: null };
  const us = Array.isArray(s.units) ? s.units : [];
  const mine = doc.unit ? us.filter((u) => unitKeyOf(u) === doc.unit) : us;
  if (doc.unit && !mine.length) return { sealed: false, of: 0, missing: 0, why: `its parent's records name no unit '${doc.unit}'`, fromTs: null, chunks: null };
  const missing = mine.filter((u) => !u || !u.reserve).length;
  const starts = mine.map((u) => u && u.reserve && Number(u.reserve.fromTs)).filter(Number.isFinite);
  const chunks = mine.map((u) => u && u.reserve && Number(u.reserve.chunks)).filter(Number.isFinite);
  return {
    sealed: mine.length > 0 && missing === 0, of: mine.length, missing,
    why: missing ? (s.why || 'a unit has no reserved window') : null,
    fromTs: starts.length ? Math.min(...starts) : null, chunks: chunks.length ? Math.max(...chunks) : null,
  };
}
// the date ranges the parent priced this unit on (3.85.0), beside the seal
function windowsForVerify(doc, parent) {
  const sealed = sealedOnUnitOf(doc);
  const per = doc.unit ? (((parent || {}).windows || {}).units || {})[doc.unit] || null : null;
  return {
    sealed: { intact: sealed.sealed, fromTs: sealed.fromTs, chunks: sealed.chunks, why: sealed.why },
    train: per ? per.train || null : null, test: per ? per.test || null : null, hold: per ? per.hold || null : null,
    unread: per && per.unread ? { fromTs: per.unread.fromTs, chunks: per.unread.chunks, seenToTs: per.unread.seenToTs ?? null } : null,
  };
}
// how many times the held-back number was on a screen before any stamp: every
// step and step back of the walk printed it, and the cut view did once more
function verifyLooksOf(doc, keys, stamped) {
  const steps = (doc.steps || []).length;
  const back = (doc.backSteps || []).length;
  const what = [
    `every step and step back of the walk printed the held-back line (${steps} step(s), ${back} step(s) back)`,
    'the cut view printed it once more',
    'Boards offers a sort and a filter on avg held-back $ over the whole board',
  ];
  if (keys && keys.readsHeldBackTrades) what.push('one floor of the rule read the held-back trade count');
  // the held-back ride (3.88.0) prints held-back numbers per survivor: a look, stamped
  const rides = (doc.ride || []).length;
  if (rides) what.push(`the held-back ride was worked out ${rides} time(s) on Verify, each a stamped look`);
  // a tool run on Tune that read the captured held-back entries (3.92.0): a look, stamped on the capture
  const tuneReads = (((doc.capture || {}).reads) || []).filter((r) => r && r.look != null).length;
  if (tuneReads) what.push(`a scan on Tune read the captured held-back trades ${tuneReads} time(s), each a stamped look`);
  // a half-life run judged on the Held window (a 70/15/15 set) read it once per press (3.94.0)
  const halfLifeReads = (doc.halflife || []).filter((r) => r && r.judge === 'hold').length;
  if (halfLifeReads) what.push(`the half-life run on History priced the held-back window ${halfLifeReads} time(s), each a stamped look`);
  return { unstamped: steps + back + 1, stamped: stamped || 0, rides, tuneReads, halfLifeReads, what };
}
function verifyFooting(doc, join) {
  const V = require('./funnelverify');
  const S4 = require('./funnelset');
  const keys = V.ruleKeys(join.rule);
  const firstDigit = (v) => String(v || '').split('.')[0] || null;
  const setRel = doc.release || null;
  const parentRel = (doc.parent || {}).release || ((join.parent.params || {}).engineVersion) || null;
  const releases = { set: setRel, parent: parentRel, reader: ENGINE_VERSION };
  releases.sameFirstDigit = !!(setRel && parentRel) && firstDigit(setRel) === firstDigit(parentRel) && firstDigit(parentRel) === firstDigit(ENGINE_VERSION);
  // the stage engine's own check (3.87.0): PASS belongs to the exact release
  const sg = require('./stagegate').status(ENGINE_VERSION, { running: examBusy() });
  const stageGate = { state: sg.state, release: sg.last ? sg.last.release : null, at: sg.last ? sg.last.at : null };
  const check = doc.check || {};
  let why = null;
  if (!doc.rich) why = 'this set keeps no copy of its rebuilt numbers yet — open it on the Funnel first';
  else if (!join.same || join.gone) why = `the rule does not give back its own survivors today (${join.now} now, ${join.had} on the record, ${join.gone} gone)`;
  else if (!keys.ok) why = `the rule carries keys that are not dials or the two limits (${keys.bad.join(', ')}), so a scrambled copy might not keep the same survivors`;
  return {
    ok: !why, why,
    same: join.same, now: join.now, had: join.had, gone: join.gone,
    // the parent's shared file can lose a column the rule reads; the set's own copy is what decides
    sameOnParent: join.sameOnParent, nowOnParent: join.nowOnParent,
    parentFileDiffers: join.same && !join.sameOnParent
      ? `the parent's shared file gives ${join.nowOnParent} today (a number the rule reads has gone from it); the set's own copy still gives ${join.had}` : null,
    keys,
    check: { kind: check.kind || null, copies: check.k ?? null, barPct: check.barPct ?? null, bar: check.bar ?? null },
    sealed: sealedOnUnitOf(doc),
    marks: (doc.marks || []).length, markKeys: (doc.marks || []).map((m) => m.key),
    steps: (doc.steps || []).length, backSteps: (doc.backSteps || []).length,
    userRuleDiffers: doc.userRule ? S4.ruleSentence(S4.normaliseRule(doc.userRule)) !== S4.ruleSentence(join.rule) : null,
    releases,
    stageGate,
  };
}
const BLEND_REFUSAL = 'this set was cut on all units together; a verdict is read on one coin and shape — cut the rule on one unit on the Funnel and verify that set';
let verifyRun = null;   // { id, token, result, error, promise }
const verifyBusy = () => stageBusy();
async function funnelVerifyDry(id) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  const S4 = require('./funnelset');
  const V = require('./funnelverify');
  const out = {
    id: doc.id, name: doc.name, unit: doc.unit || null, unitName: doc.unitName || null, release: doc.release || null,
    parent: doc.parent || null,
    ruleSentence: doc.ruleSentence || S4.ruleSentence(doc.rule),
    userSentence: doc.userRule ? S4.ruleSentence(S4.normaliseRule(doc.userRule)) : null,
    counts: doc.counts || null, closing: doc.closing || null, warnings: doc.warnings || [],
    marks: doc.marks || [], check: doc.check || null,
    heldBackReadAt: doc.heldBackReadAt || null,
    // every block already stamped, newest first; the OLDEST is the verdict
    blocks: doc.verify || [],
    rules: V.declareRules(doc.check, {}),
    refused: null, footing: null, looks: null,
    // the rule on the other units and the held-back ride (3.88.0), newest first
    others: doc.others || [], ride: doc.ride || [],
    // what the rule DROPPED, on the same window (V8, 3.100.0), newest first
    dropped: doc.dropped || [],
    othersRefused: null, rideRefused: null, droppedRefused: null,
    othersRunning: othersRun && othersRun.id === doc.id && !othersRun.result && !othersRun.error ? { token: othersRun.token, done: othersRun.done, of: othersRun.of } : null,
    rideRunning: rideRun && rideRun.id === doc.id && !rideRun.result && !rideRun.error ? { token: rideRun.token, done: rideRun.done, of: rideRun.of } : null,
  };
  if (!doc.unit) { out.refused = BLEND_REFUSAL; out.othersRefused = BLEND_REFUSAL; out.rideRefused = BLEND_REFUSAL; out.droppedRefused = BLEND_REFUSAL; return out; }
  if (doc.derived) { const why = derivedRefusalOf(doc); out.refused = why; out.othersRefused = why; out.rideRefused = why; out.droppedRefused = why; out.derived = doc.derived; return out; }
  let join;
  try { join = await funnelVerifyJoin(doc); } catch (err) { out.refused = err.message; out.othersRefused = err.message; out.rideRefused = err.message; out.droppedRefused = err.message; return out; }
  out.footing = verifyFooting(doc, join);
  out.looks = verifyLooksOf(doc, out.footing.keys, (doc.verify || []).length);
  const busy = verifyBusy();
  if (busy) out.refused = `${busy} — the read waits for the box to be free`;
  else if (verifyRun && !verifyRun.result && !verifyRun.error) out.refused = 'a Stage 4 record set is being read right now — one at a time';
  else if (othersBusy()) out.refused = `${othersBusy()} — one reading at a time`;
  else if (!out.footing.ok) out.refused = out.footing.why;
  out.othersRefused = othersRefusalOf(doc, out.footing);
  out.rideRefused = rideRefusalOf(doc);
  out.droppedRefused = droppedRefusalOf(doc);
  // HOW MANY THE RULE DROPPED, so the box on screen can say what "all of them"
  // means before anything is pressed. Counted off the board already in hand.
  try {
    const S4d = require('./funnelset');
    out.droppedOf = Math.max(0, join.mine.length - S4d.applyRule(join.mine, join.rule).length);
  } catch { out.droppedOf = null; }
  return out;
}
async function funnelVerifyRun(doc, asked) {
  const V = require('./funnelverify');
  const S4 = require('./funnelset');
  // THE RULES FIRST, before any number exists
  const rules = V.declareRules(doc.check, asked);
  const join = await funnelVerifyJoin(doc);
  const footing = verifyFooting(doc, join);
  if (!footing.ok) throw new Error(footing.why);
  const rows = join.rows;
  const got = controlsOf(join.parent, doc.unit, rows.map(controlKeyOf));
  const heldBack = V.heldBackRead(rows, got);
  // a rule with a top-N cut lets each copy take its own top N by its own scrambled money
  const copyRowsAt = join.rule.cut ? (d) => S4.nullCopy(join.mine, join.rule, d) : null;
  const copies = V.copiesRead(rows, rules, copyRowsAt);
  const survivors = V.perSurvivor(rows, rules);
  const sanity = V.sanity(join.mine, rows, rules);
  const lineA = V.lineA(rows, rules, copyRowsAt);
  const lineB = V.lineB(join.mine, rows.length, rules);
  // the stamp goes onto what is on disk NOW, so two presses in a row append two blocks
  const fresh = getSet(doc.id);
  if (!fresh) throw new Error('the set went away while it was being read');
  const blocks = fresh.verify || [];
  const { stageGate, ...rest } = footing;
  const block = V.buildBlock({
    id: `${doc.id}-v${blocks.length + 1}`, at: new Date().toISOString(), release: ENGINE_VERSION, look: blocks.length + 1,
    rules, stageGate, footing: rest,
    looks: verifyLooksOf(fresh, footing.keys, blocks.length),
    heldBack, copies, survivors, sanity, lineA, lineB,
    // the newest reading of the rule on the other units, when one exists (3.88.0)
    others: othersSummaryOf(fresh),
    fee: { feePerLeg: (join.parent.params || {}).fee ?? null, feeUnits: 'fraction' },
    windows: windowsForVerify(doc, join.parent),
    marks: (doc.marks || []).map((m) => ({ key: m.key, what: m.what, step: m.step ?? null, detail: m.detail ?? null })),
  });
  fresh.verify = [block, ...blocks];
  if (!fresh.heldBackReadAt) fresh.heldBackReadAt = block.at;
  saveSet(fresh);
  return { id: block.id, look: block.look, pass: block.verdict.pass, sentence: block.verdict.sentence };
}
function funnelVerifyStatus(id) {
  if (!verifyRun || verifyRun.id !== id) return { running: false, none: true, token: null, error: null, result: null };
  return { running: !verifyRun.result && !verifyRun.error, token: verifyRun.token, error: verifyRun.error, result: verifyRun.result };
}
function funnelVerifyStart(id, asked = {}) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  if (verifyRun && !verifyRun.result && !verifyRun.error) {
    throw new Error(verifyRun.id === id ? 'this set is being read right now' : 'another Stage 4 record set is being read right now — one at a time');
  }
  if (!doc.unit) throw new Error(BLEND_REFUSAL);
  if (doc.derived) throw new Error(derivedRefusalOf(doc));
  const busy = verifyBusy();
  if (busy) throw new Error(`${busy} — the read waits for the box to be free`);
  if (othersBusy()) throw new Error(`${othersBusy()} — one reading at a time`);
  const run = { id, token: `${id}:${Date.now()}`, result: null, error: null, promise: null };
  verifyRun = run;
  run.promise = funnelVerifyRun(doc, asked || {})
    .then((result) => { run.result = result; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return funnelVerifyStatus(id);
}
// one line per set for the set list: how many blocks, and what the verdict said
// ---- V8: what the settings the rule DROPPED did on the same window (3.100.0) ----
//
// SELECTION-DESIGN.md Part 7. A count of survivors that cleared a bar is
// unreadable without the same count for what did not survive: if nearly every
// setting on the board was positive on the held-back window, "all the survivors
// positive" says the window rose and says nothing about the picking.
//
// It prices NOTHING. Every figure it reads is already on the board. But it IS a
// read of the held-back window, so it is a counted look like any other, and it
// is information only -- it never gates a set.
async function funnelDropped(doc, asked = {}) {
  const V = require('./funnelverify');
  const S4 = require('./funnelset');
  const join = await funnelVerifyJoin(doc);
  const footing = verifyFooting(doc, join);
  if (!footing.ok) throw new Error(footing.why);
  const kept = S4.applyRule(join.mine, join.rule);
  const keptLabels = new Set(kept.map((r) => r.label));
  const droppedAll = join.mine.filter((r) => !keptLabels.has(r.label));
  // HOW MANY OF THE DROPPED TO READ, the owner's box. Blank, zero, or anything
  // at or above the count means all of them. The sample is taken with an even
  // stride through the board's own order -- never the first N, which reads one
  // region of the board, and never the top N by any figure, which would be the
  // shopping this reading exists to detect.
  const askedN = Math.floor(Number(asked.sample));
  const want = Number.isFinite(askedN) && askedN > 0 && askedN < droppedAll.length ? askedN : droppedAll.length;
  const dropped = want < droppedAll.length
    ? Array.from({ length: want }, (_, i) => droppedAll[Math.floor((i * droppedAll.length) / want)])
    : droppedAll;
  // EACH SIDE AGAINST THE FOUR AT ITS OWN HOLD LENGTHS. A dropped setting may
  // hold for a length no survivor uses, and beating a bar priced for somebody
  // else's hold length is not beating anything.
  const keysOf = (rows) => [...new Set(rows.map((r) => controlKeyOf(r)))];
  const keptControls = controlsOf(join.parent, doc.unit, keysOf(kept));
  const droppedControls = controlsOf(join.parent, doc.unit, keysOf(dropped));
  return V.keptVsDropped(kept, dropped, keptControls, droppedControls, { read: dropped.length, of: droppedAll.length });
}
function droppedRefusalOf(doc) {
  if (!doc.unit) return BLEND_REFUSAL;
  if (doc.derived) return derivedRefusalOf(doc);
  const busy = verifyBusy();
  if (busy) return `${busy} — the read waits for the box to be free`;
  if (acrossBusy()) return `${acrossBusy()} — the same boards, one reading at a time`;
  if (holdBusy()) return `${holdBusy()} — the same boards, one reading at a time`;
  if (verifyRun && !verifyRun.result && !verifyRun.error) return 'a Stage 4 record set is being read right now — one at a time';
  if (othersRun && !othersRun.result && !othersRun.error) return `${othersBusy()} — one at a time`;
  return null;
}
async function funnelDroppedStart(id, asked = {}) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  const why = droppedRefusalOf(doc);
  if (why) throw new Error(why);
  const got = await funnelDropped(doc, asked || {});
  const fresh = getSet(id);
  if (!fresh) throw new Error('the set went away while the settings it dropped were being read');
  const had = fresh.dropped || [];
  const reading = {
    id: `${id}-d${had.length + 1}`,
    at: new Date().toISOString(),
    release: ENGINE_VERSION,
    look: had.length + 1,
    unit: doc.unit,
    unitName: doc.unitName || null,
    ...got,
  };
  // appended, never overwritten: a later reading over a different sample is
  // another reading, and both stay on the record
  fresh.dropped = [reading, ...had];
  saveSet(fresh);
  return reading;
}

function verifySummaryOf(doc) {
  const blocks = (doc && doc.verify) || [];
  if (!blocks.length) return null;
  const first = blocks[blocks.length - 1];
  return { blocks: blocks.length, at: first.at, pass: !!(first.verdict && first.verdict.pass), release: first.release || null };
}

// ---- V6: THE RULE ON THE OTHER UNITS, HELD-BACK WINDOW (3.88.0, VERIFY-DESIGN.md) ----
//
// The same rule on each OTHER coin-and-shape unit of the stage 3 set this was
// cut from, each on its own held-back window against its own scrambled copies
// at the verdict's declared bar. The Funnel's "read the other units" asks this
// of the test window; this is the same walk over the same boards with the
// held-back fields, one board at a time and let go, started and polled.
// Two counts, information only, never a gate; every press appends a reading.
async function funnelOthers(doc, rules, note = null) {
  const V = require('./funnelverify');
  const S4 = require('./funnelset');
  const join = await funnelVerifyJoin(doc);
  const footing = verifyFooting(doc, join);
  if (!footing.ok) throw new Error(footing.why);
  const parent = join.parent;
  const t = join.t;
  const others = unitsOfSet(t, parent.id).filter((u) => u.key !== doc.unit);
  const rich = readFunnelRich(parent.id);
  const units = [];
  if (note) note(0, others.length);
  for (const u of others) {
    // eslint-disable-next-line no-await-in-loop
    const board = withFunnelRich(await loadUnitBoard(parent.id, t, u.key), rich);
    const kept = S4.applyRule(board, join.rule);
    // a rule with a top-N cut lets each copy take its own top N on that unit, as the verdict does
    const copyRowsAt = join.rule.cut ? (d) => S4.nullCopy(board, join.rule, d) : null;
    units.push({ unit: u.key, name: u.name, of: board.length, ...V.othersUnitRead(kept, rules, copyRowsAt) });
    if (note) note(units.length, others.length);
  }
  // the set's own board comes back into hand for the next read
  await loadUnitBoard(parent.id, t, doc.unit);
  return { units, ...V.othersSummary(units), rule: join.rule };
}
// why the press would refuse, in words, or null
function othersRefusalOf(doc, footing) {
  if (!doc.unit) return BLEND_REFUSAL;
  if (doc.derived) return derivedRefusalOf(doc);
  const busy = verifyBusy();
  if (busy) return `${busy} — the read waits for the box to be free`;
  if (acrossBusy()) return `${acrossBusy()} — the same boards, one reading at a time`;
  if (holdBusy()) return `${holdBusy()} — the same boards, one reading at a time`;
  if (verifyRun && !verifyRun.result && !verifyRun.error) return 'a Stage 4 record set is being read right now — one at a time';
  if (othersRun && !othersRun.result && !othersRun.error) return othersRun.id === doc.id ? 'the other units are being read for this set right now' : `${othersBusy()} — one at a time`;
  if (footing && !footing.ok) return footing.why;
  return null;
}
const othersStatus = (run) => ({ running: !run.result && !run.error, token: run.token, done: run.done, of: run.of, error: run.error, result: run.result });
function funnelOthersStart(id, asked = {}) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  if (othersRun && othersRun.id === id && !othersRun.result && !othersRun.error) return othersStatus(othersRun);
  const why = othersRefusalOf(doc, null);
  if (why) throw new Error(why);
  const V = require('./funnelverify');
  // THE RULES FIRST: the verdict's own declared bar, the set's share or the typed one
  const rules = V.declareRules(doc.check, asked || {});
  const run = { id, token: `${id}:${Date.now()}`, done: 0, of: 0, result: null, error: null, promise: null };
  othersRun = run;
  run.promise = funnelOthers(doc, rules, (done, of) => { run.done = done; run.of = of; })
    .then((got) => {
      const fresh = getSet(id);
      if (!fresh) throw new Error('the set went away while the other units were being read');
      const had = fresh.others || [];
      const reading = {
        id: `${id}-o${had.length + 1}`, at: new Date().toISOString(), release: ENGINE_VERSION, look: had.length + 1,
        rules: { copies: rules.copies, bar: rules.bar, barPct: rules.barPct, ownBarPct: rules.ownBarPct, barChanged: rules.barChanged, chance: rules.chance, tags: { bar: rules.tags.bar } },
        unit: doc.unit, unitName: doc.unitName || null, ruleSentence: doc.ruleSentence || null,
        units: got.units, positive: got.positive, of: got.of, clearBar: got.clearBar, keepsNothing: got.keepsNothing, mark: got.mark,
      };
      // appended, never overwritten: a later reading under another bar is another reading
      fresh.others = [reading, ...had];
      saveSet(fresh);
      run.result = { id: reading.id, look: reading.look, positive: reading.positive, of: reading.of, clearBar: reading.clearBar, keepsNothing: reading.keepsNothing, mark: reading.mark };
      run.done = run.of;
    })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return othersStatus(run);
}
function funnelOthersStatus(id) {
  if (!othersRun || othersRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, error: null, result: null };
  return othersStatus(othersRun);
}
// the newest reading's counts, for the verdict block stamped after it
function othersSummaryOf(doc) {
  const o = ((doc && doc.others) || [])[0] || null;
  return o ? { id: o.id, at: o.at, look: o.look, positive: o.positive, of: o.of, clearBar: o.clearBar, keepsNothing: o.keepsNothing, mark: o.mark } : null;
}

// ---- V7: THE RIDE ON THE HELD-BACK WINDOW (3.88.0, VERIFY-DESIGN.md) ----------------
//
// The same pass that works out the missing numbers on the Funnel, aimed at this
// set's survivors on this set's unit only, keeping the held-back half the worker
// already computes beside the test half. Written onto the set as its own record
// with the release that computed it -- never into the set's copy of the test
// numbers, whose shape every set on the box is read by, and never into the
// parent's shared file, where a one-unit rebuild would replace the other units'
// numbers. Every press appends; it is a look at the held-back window and the
// next verdict counts it. Never a gate.
function rideRefusalOf(doc) {
  if (!doc.unit) return BLEND_REFUSAL;
  if (doc.derived) return derivedRefusalOf(doc);
  if (!(doc.survivors || []).length) return 'this set wrote down no settings, so there is no ride to work out';
  const busy = verifyBusy();               // a sweep, a stage run, a totalling, a rebuild, the exam, another ride
  if (busy) return `${busy} — the ride waits for the box to be free`;
  if (setRichRun && !setRichRun.result && !setRichRun.error) return 'a Stage 4 record set is having its numbers worked out right now — one at a time';
  if (acrossBusy()) return `${acrossBusy()} — one heavy job at a time`;
  if (holdBusy()) return `${holdBusy()} — one heavy job at a time`;
  if (othersBusy()) return `${othersBusy()} — one heavy job at a time`;
  if (verifyRun && !verifyRun.result && !verifyRun.error) return 'a Stage 4 record set is being read right now — one at a time';
  if (!getSet((doc.parent || {}).id)) return 'the stage 3 set this was cut from is gone, so its ride cannot be worked out';
  return null;
}
const rideStatus = (run) => ({ running: !run.result && !run.error, token: run.token, done: run.done, of: run.of, cpu: cpuLoad(), error: run.error, result: run.result });
function funnelRideStart(id) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  if (rideRun && rideRun.id === id && !rideRun.result && !rideRun.error) return rideStatus(rideRun);
  const why = rideRefusalOf(doc);
  if (why) throw new Error(why);
  const parent = getSet((doc.parent || {}).id);
  const labels = (doc.survivors || []).map((x) => x.label);
  const run = { id, token: `${id}:${Date.now()}`, done: 0, of: labels.length, result: null, error: null, promise: null };
  rideRun = run;
  run.promise = rebuildRichFor(parent, labels, { unit: doc.unit, note: (done, of) => { run.done = done; run.of = of; } })
    .then((got) => {
      const V = require('./funnelverify');
      const ride = V.rideOf(got.perSetting, { unitKey: doc.unit, keyOf: unitKeyOf, labels });
      const fresh = getSet(id);
      if (!fresh) throw new Error('the set went away while its ride was being worked out');
      const had = fresh.ride || [];
      const rec = {
        id: `${id}-r${had.length + 1}`, at: new Date().toISOString(), release: ENGINE_VERSION, look: had.length + 1,
        unit: doc.unit, unitName: doc.unitName || null, settings: labels.length,
        missing: ride.missing, failures: got.failures || [], fields: V.RIDE_FIELDS.slice(),
        rows: ride.rows,
      };
      fresh.ride = [rec, ...had];
      saveSet(fresh);
      run.result = { id: rec.id, look: rec.look, rows: rec.rows.length, missing: rec.missing.length, failures: rec.failures.length };
      run.done = run.of;
    })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return rideStatus(run);
}
function funnelRideStatus(id) {
  if (!rideRun || rideRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, cpu: cpuLoad(), error: null, result: null };
  return rideStatus(rideRun);
}

// ---- THE RESERVE GRADE ON A STAGE 4 RECORD SET (3.89.0, VERIFY-DESIGN.md section 6) ----
//
// The unread window -- the sealed 13% that was cut away before anything
// trained, running from the seal's start to whatever the box holds on the day
// -- priced for the set's survivors on the set's own unit, through the stage 3
// pricing path with the unread window in the held-back window's place
// (lib/stagework.js, s3UnitTask with task.unread), the members forecasting it
// from their saved models. Read by the verdict's four rules on that window;
// every grade is a counted look, appended and never overwritten; it refuses in
// words without a verdict that PASSED under this release line, without an
// intact seal, and while anything heavy is going.
const UNREAD_NO_PASS = 'no verdict on this set is PASS under this release line — read the rule against nothing on Verify first; a set whose verdict has not stood is neither graded nor greenlighted';
const firstDigitOfRelease = (v) => String(v || '').split('.')[0] || null;
// the newest verdict block that PASSED under the reader's first digit, or null
function unreadGateOf(doc) {
  const b = ((doc && doc.verify) || []).find((x) => x.verdict && x.verdict.pass && firstDigitOfRelease(x.release) === firstDigitOfRelease(ENGINE_VERSION)) || null;
  return b ? { id: b.id, at: b.at, release: b.release, look: b.look } : null;
}
// A HALF-LIFE SET (3.95.0) stands on the set it was built from: its gate is that
// set's PASS, and the readings that would show its own numbers under the
// source's name -- the verdict, the other units, the ride, the reserve grade,
// another half-life run -- refuse it in words and point at the source.
const derivedRefusalOf = (doc) => (doc && doc.derived
  ? `this is a half-life set built from ${doc.derived.fromName || doc.derived.from}; it stands on that set's verdict, and its own figures are the retrained ones on its table there — read the set it came from here`
  : null);
function gateOfSet(doc) {
  if (!doc) return null;
  if (doc.derived) { const src = getSet(doc.derived.from); return src ? unreadGateOf(src) : null; }
  return unreadGateOf(doc);
}
function unreadRefusalOf(doc) {
  if (!doc.unit) return BLEND_REFUSAL;
  if (doc.derived) return derivedRefusalOf(doc);
  if (!unreadGateOf(doc)) return UNREAD_NO_PASS;
  const sealed = sealedOnUnitOf(doc);
  if (!sealed.sealed) return `the sealed window is not intact on this unit — ${sealed.why}`;
  const parent = getSet((doc.parent || {}).id);
  if (!parent) return 'the stage 3 set this was cut from is gone, so its unread window cannot be priced';
  if (!getSet((parent.parent || {}).id)) return 'the stage 2 set the stage 3 set was priced from is gone, so the members cannot forecast the unread window';
  const busy = stageBusy();                // a stage run, the exam, a totalling, a rebuild, a ride, another grade
  if (busy) return `${busy} — the grade waits for the box to be free`;
  if (setRichRun && !setRichRun.result && !setRichRun.error) return 'a Stage 4 record set is having its numbers worked out right now — one at a time';
  if (acrossBusy()) return `${acrossBusy()} — one heavy job at a time`;
  if (holdBusy()) return `${holdBusy()} — one heavy job at a time`;
  if (othersBusy()) return `${othersBusy()} — one heavy job at a time`;
  if (verifyRun && !verifyRun.result && !verifyRun.error) return 'a Stage 4 record set is being read right now — one at a time';
  return null;
}
// the four comparisons the task priced on the unread window, in the shape the reader wants
function unreadControlsOf(taskControls, unitKey, rows) {
  return controlsOf({ controls: { units: { [unitKey]: taskControls || {} } } }, unitKey, (rows || []).map(controlKeyOf));
}
async function unreadGradeRun(doc, asked, note = null) {
  const V = require('./funnelverify');
  // THE RULES FIRST, before any number exists: the verdict's own declaration on this window
  const rules = V.declareRules(doc.check, asked || {});
  const gate = unreadGateOf(doc);
  if (!gate) throw new Error(UNREAD_NO_PASS);
  const sealed = sealedOnUnitOf(doc);
  if (!sealed.sealed) throw new Error(`the sealed window is not intact on this unit — ${sealed.why}`);
  const join = await funnelVerifyJoin(doc);
  const footing = verifyFooting(doc, join);
  if (!footing.ok) throw new Error(footing.why);
  const parent = join.parent;                                   // the stage 3 set
  const shape = relaunchShapeOf(parent);                        // refuses when the stage 2 set is gone
  const idx = shape.records.findIndex((r) => unitKeyOf(r) === doc.unit);
  if (idx < 0) throw new Error(`the stage 3 set holds no unit called '${doc.unit}'`);
  const rec = shape.records[idx];
  const want = new Set(join.rows.map((r) => r.label));
  const held = new Set(shape.heldOn[idx]);
  const settings = shape.settings.filter((st) => want.has(st.label) && held.has(st.si));
  const missing = [...want].filter((L) => !settings.some((st) => st.label === L));
  const K = rules.copies;
  const fee = Number((parent.params || {}).fee) || 0;
  const payload = s3Payload({ doc: parent, parent: shape.parent, rec, settings, fee, nullN: K });
  payload.keepN = K;                                            // every copy kept: the verdict reads them all
  const models = unitRows(shape.parent.id, 'models', rec.blocks.models, rec.u);
  payload.unit.members = payload.unit.members.map((m, mi) => ({ ...m, saved: (models.find((x) => x.mi === mi) || {}).saved || null }));
  payload.unread = { fromTs: sealed.fromTs };
  if (note) note(0, 1);
  const pool = createPool();
  activePool = pool;
  let res = null;
  let error = null;
  try {
    await pool.forEach('s3Unit', [payload], (settled) => { if (settled.ok) res = settled.value; else error = settled.error; if (note) note(1, 1); });
  } finally { activePool = null; pool.abort(); }
  if (!res) throw new Error(`the unit could not be priced on the unread window: ${String(error || 'no answer')}`);
  // the unread window in the held-back window's place, in the reader's shape
  const rows = (res.rows || []).map((r) => ({
    si: r.si, label: r.label, tHours: r.tHours, weekdaysOnly: r.weekdaysOnly,
    avgHold: r.holdout ? r.holdout.pnl : null, avgTrades: r.holdout ? r.holdout.trades : null, avgVsLong: r.holdout ? r.holdout.vsAlwaysLong : null,
    noiseHold: r.noiseHold, beat: r.beat, pairs: r.pairs, avgLead: r.lead,
    pnlThirds: r.rich && r.rich.hold ? r.rich.hold.pnlThirds : null,
    stops: r.holdout ? r.holdout.stops : null,
    ride: r.rich && r.rich.hold ? { ...r.rich.hold } : null,
  }));
  const controls = unreadControlsOf(res.controls, doc.unit, rows);
  const read = V.heldBackRead(rows, controls);
  const copies = V.copiesRead(rows, rules);
  const survivors = V.perSurvivor(rows, rules);
  const sanity = V.sanity(rows, rows, rules);
  const fresh = getSet(doc.id);
  if (!fresh) throw new Error('the set went away while its unread window was being priced');
  const had = fresh.unread || [];
  const { stageGate: _sg, ...rest } = footing;
  const block = V.buildUnreadBlock({
    id: `${doc.id}-u${had.length + 1}`, at: new Date().toISOString(), release: ENGINE_VERSION, look: had.length + 1,
    rules, gate, footing: rest,
    window: res.unread, read, copies, survivors, sanity,
    controls: { keys: controls.keys || null, alwaysLong: controls.alwaysLong || null, alwaysShort: controls.alwaysShort || null, buyHold: controls.buyHold || null, shortHold: controls.shortHold || null },
    fee: { feePerLeg: fee, feeUnits: 'fraction' },
    missing, failures: [],
    rows: rows.map((r) => ({ label: r.label, money: r.avgHold, trades: r.avgTrades, stops: r.stops, vsLong: r.avgVsLong, ride: r.ride })),
  });
  fresh.unread = [block, ...had];
  saveSet(fresh);
  return { id: block.id, look: block.look, pass: block.verdict.pass, sentence: block.verdict.sentence };
}
async function unreadGradeDry(id) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  const sealed = sealedOnUnitOf(doc);
  const grades = doc.unread || [];
  return {
    id: doc.id, name: doc.name, unit: doc.unit || null, unitName: doc.unitName || null, release: doc.release || null,
    ruleSentence: doc.ruleSentence || null, survivors: ((doc.counts || {}).survivors) ?? (doc.survivors || []).length,
    gate: unreadGateOf(doc), verdicts: (doc.verify || []).length,
    sealed: { intact: sealed.sealed, fromTs: sealed.fromTs, chunks: sealed.chunks, why: sealed.why },
    rules: require('./funnelverify').declareRules(doc.check, {}),
    looks: grades.length, grades,
    refused: unreadRefusalOf(doc),
    running: unreadRun && unreadRun.id === doc.id && !unreadRun.result && !unreadRun.error ? { token: unreadRun.token } : null,
  };
}
const unreadStatus = (run) => ({ running: !run.result && !run.error, token: run.token, done: run.done, of: run.of, cpu: cpuLoad(), error: run.error, result: run.result });
function unreadGradeStart(id, asked = {}) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  if (unreadRun && unreadRun.id === id && !unreadRun.result && !unreadRun.error) return unreadStatus(unreadRun);
  const why = unreadRefusalOf(doc);
  if (why) throw new Error(why);
  const run = { id, token: `${id}:${Date.now()}`, done: 0, of: 1, result: null, error: null, promise: null };
  unreadRun = run;
  run.promise = unreadGradeRun(doc, asked || {}, (done, of) => { run.done = done; run.of = of; })
    .then((result) => { run.result = result; run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return unreadStatus(run);
}
function unreadGradeStatus(id) {
  if (!unreadRun || unreadRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, cpu: cpuLoad(), error: null, result: null };
  return unreadStatus(unreadRun);
}

// ---- THE GREENLIGHT SOURCE OF A STAGE 4 RECORD SET (3.90.0, VERIFY-DESIGN.md section 6) ----
//
// Everything a greenlight minted from a Stage 4 set is built from, read off
// the set and its parents and never re-typed: the verdict block that stood
// (the same gate the reserve grade uses), the unit, one survivor chosen by
// depth inside the rule or named by the owner, the members exactly as the
// stage 2 set trained them, how they were trained, the fee, and the survivor's
// own held-back and unread readings when they exist. lib/live/greenlight.js
// turns it into the frozen configuration and refuses in words what the live
// vocabulary cannot carry.
async function stage4GreenlightSource(setId, asked = {}) {
  const S4 = require('./funnelset');
  const doc = getSet(setId);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${setId}'`);
  if (!doc.unit) throw new Error(BLEND_REFUSAL);
  // A HALF-LIFE SET STANDS ON ITS SOURCE'S PASS (3.95.0), and each of its records carries its half-life forward
  const source = doc.derived ? getSet(doc.derived.from) : null;
  if (doc.derived && !source) throw new Error('the set this half-life set was built from is gone, so its standing cannot be read');
  const gate = gateOfSet(doc);
  if (!gate) throw new Error(UNREAD_NO_PASS);
  const HL = require('./halflife');
  const hlOf = (label) => (doc.derived ? ((doc.survivors || []).find((x) => x.label === label) || null) : null);
  const join = await funnelVerifyJoin(doc);
  const parent = join.parent;
  const stage2 = getSet((parent.parent || {}).id);
  if (!stage2) throw new Error('the stage 2 set the stage 3 set was priced from is gone, so the members cannot be named');
  const rec = rowstore.readAll(stage2.id, 'records').find((r) => unitKeyOf(r) === doc.unit);
  if (!rec) throw new Error(`the stage 2 set holds no unit called '${doc.unit}'`);
  const rows = join.rows;
  if (!rows.length) throw new Error('this set wrote down no settings, so there is no survivor to greenlight');
  const rule = join.rule;
  let pick;
  if (asked.pick == null || asked.pick === '' || asked.pick === 'depth') {
    pick = { by: 'depth', ...S4.pickByDepth(rows, rule), of: rows.length };
  } else {
    const i = rows.findIndex((r) => r.label === String(asked.pick));
    if (i < 0) throw new Error(`'${asked.pick}' is not one of this set's ${rows.length} survivors`);
    const d = S4.depthOf(rows[i], rule);
    pick = { by: 'named', index: i, si: rows[i].si, label: rows[i].label, worst: d.worst, mean: d.mean, per: d.per, of: rows.length };
  }
  const survivor = rows[pick.index];
  const gateBlock = (doc.verify || []).find((b) => b.id === gate.id) || null;
  const heldOf = (label) => ((((gateBlock || {}).survivors || {}).rows) || []).find((r) => r.label === label) || null;
  const unreadRec = (doc.unread || [])[0] || null;
  const unreadOf = (label) => (unreadRec ? (unreadRec.rows || []).find((r) => r.label === label) || null : null);
  const held = heldOf(survivor.label);
  const un = unreadOf(survivor.label);
  const hl = hlOf(survivor.label);
  const p1 = stage2.params || {};
  const size = rec.size || (rec.ctx1 ? (rec.ctx2 ? 3 : 2) : 1);
  return {
    set: {
      id: doc.id, stage: 4, name: doc.name, release: doc.release || null, unit: doc.unit, unitName: doc.unitName || null,
      ruleSentence: doc.ruleSentence || S4.ruleSentence(rule), counts: doc.counts || null,
      parent: { id: parent.id, name: parent.name }, stage2: { id: stage2.id, name: stage2.name },
      campaign: (parent.params || {}).campaign || null,
      derived: doc.derived || null,
    },
    gate,
    unit: { trade: rec.trade, ctx1: rec.ctx1 || null, ctx2: rec.ctx2 || null, size, geometry: rec.geometry },
    survivor: { ...survivor, bandPct: survivor.bandMode === 'auto' || survivor.bandMode == null ? rec.bandPct : Math.abs(Number(survivor.bandMode)), halfLife: hl ? hl.halfLife : null },
    pick,
    survivors: rows.map((r, i) => { const d = S4.depthOf(r, rule); const h = heldOf(r.label); const x = unreadOf(r.label); const y = hlOf(r.label); return { index: i, label: r.label, worst: d.worst, mean: d.mean, held: h ? h.held : null, trades: h ? h.trades : null, unread: x ? x.money : null, halfLife: y ? y.halfLife : null, retrained: y && y.money ? y.money.judge : null }; }),
    members: (rec.specs || []).map((sp) => ({ model: sp.model, view: sp.view })),
    // how the members were trained, so the live path can train the same way -- with the record's half-life when it carries one
    training: { trainOn: p1.trainOn ?? null, weightCap: p1.weightCap ?? null, windowLayout: p1.windowLayout ?? null, startMonth: p1.startMonth ?? null, endMonth: p1.endMonth ?? null, allLoaded: !!p1.allLoaded, nullN: p1.nullN ?? null,
      halfLife: hl ? HL.daysOfMonths(hl.halfLife) : null, halfLifeMonths: hl ? hl.halfLife : null },
    fee: Number.isFinite(Number((parent.params || {}).fee)) ? Number((parent.params || {}).fee) : null,
    readings: {
      heldBack: held ? { money: held.held, trades: held.trades } : null,
      unread: un ? { money: un.money, trades: un.trades, look: unreadRec.look } : null,
      halfLife: hl ? { months: hl.halfLife, judge: doc.derived.judgeWord || null, money: hl.money ? hl.money.judge : null, unweighted: hl.money ? hl.money.unweighted : null } : null,
    },
  };
}
// the screen's dry read: what would be greenlighted, and why it could not be, in words
async function stage4GreenlightDry(setId) {
  const gl = require('./live/greenlight');
  const doc = getSet(setId);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${setId}'`);
  let src = null;
  let refused = null;
  try { src = await stage4GreenlightSource(setId, { pick: 'depth' }); } catch (err) { refused = err.message; }
  if (src && !refused) refused = gl.stage4Refusal(src);
  return {
    id: doc.id, name: doc.name, unit: doc.unit || null, unitName: doc.unitName || null,
    ruleSentence: doc.ruleSentence || null, gate: gateOfSet(doc), verdicts: (doc.verify || []).length, derived: doc.derived || null,
    unitSize: src ? src.unit.size : null, members: src ? src.members.length : null,
    depthPick: src ? { label: src.pick.label, worst: src.pick.worst, mean: src.pick.mean } : null,
    survivors: src ? src.survivors : [],
    refused,
  };
}

// ---- THE PER-TRADE CAPTURE OF A STAGE 4 RECORD SET (3.92.0, VERIFY-DESIGN.md section 6, section 9 step 8) ----
//
// The two tools on Tune -- the stop tuner and the conviction ladder -- take a
// list of entries and price them themselves. A Stage 4 set holds money per
// window and never the trades, so this writes them down: the same pricing pass
// as the reserve grade with a flag (lib/stagework.js, s3UnitTask with
// task.capture), every survivor that enters at market with no trailing stop,
// on the training, test and held-back slices. The entries live in a file
// beside the set; the set holds the summary. A tool run that reads the
// held-back entries is a look, stamped on the capture. Refuses in words
// without a verdict that PASSED under this release line, on a blend set,
// without the parents, without a survivor of the right shape, and while
// anything heavy is going.
const CAPTURE_V = 1;
const CAPTURE_WINDOWS = ['train', 'test', 'hold'];
const CAPTURE_WINDOW_WORDS = { train: 'training', test: 'test', hold: 'held-back' };
const captureFile = (id) => path.join(SETS_DIR, `${id}-capture.json.gz`);
function readCapture(id) {
  try {
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(captureFile(id))).toString('utf8'));
    return raw && raw.v === CAPTURE_V && Array.isArray(raw.survivors) ? raw : null;
  } catch (_) { return null; }
}
function writeCapture(id, rec) {
  const tmp = `${captureFile(id)}.tmp${process.pid}-${++tmpSeq}`;
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(rec))));
  fs.renameSync(tmp, captureFile(id));
  return rec;
}
// why a setting cannot be captured, in words, or null when it can
const captureShapeWhy = (st) => {
  if ((st.entry || 'breakout') !== 'market') return 'it enters on a price level rather than at the hour, and the two scans on Tune price an entry at the hour, open to open';
  if ((st.trailMult ?? null) != null) return 'it carries a trailing stop, so it already has a stop of its own';
  return null;
};
const CAPTURE_NONE = 'no survivor of this set enters at market without a trailing stop, and those are the only trades the two scans on Tune price';
const CAPTURE_NOT_YET = 'this set carries no per-trade capture yet — press "Capture the trades of this set" on Tune first';
function captureRefusalOf(doc) {
  if (!doc.unit) return BLEND_REFUSAL;
  if (doc.derived && !getSet(doc.derived.from)) return 'the set this half-life set was built from is gone, so its standing cannot be read';
  if (doc.derived && !readHalfLifeRun(doc.derived.from, doc.derived.run)) return 'the retrained members this half-life set was built from are missing beside its source — press the half-life run on History again and build it again';
  if (!gateOfSet(doc)) return UNREAD_NO_PASS;
  const parent = getSet((doc.parent || {}).id);
  if (!parent) return 'the stage 3 set this was cut from is gone, so its trades cannot be captured';
  if (!getSet((parent.parent || {}).id)) return 'the stage 2 set the stage 3 set was priced from is gone, so the members cannot forecast their training window';
  if (!(doc.survivors || []).length) return 'this set wrote down no settings, so there is nothing to capture';
  const busy = stageBusy();                // a stage run, the exam, a totalling, a rebuild, a ride, a grade, another capture
  if (busy) return `${busy} — the capture waits for the box to be free`;
  if (setRichRun && !setRichRun.result && !setRichRun.error) return 'a Stage 4 record set is having its numbers worked out right now — one at a time';
  if (acrossBusy()) return `${acrossBusy()} — one heavy job at a time`;
  if (holdBusy()) return `${holdBusy()} — one heavy job at a time`;
  if (othersBusy()) return `${othersBusy()} — one heavy job at a time`;
  if (verifyRun && !verifyRun.result && !verifyRun.error) return 'a Stage 4 record set is being read right now — one at a time';
  return null;
}
async function tuneCaptureRun(doc, note = null) {
  const S4 = require('./funnelset');
  const gate = gateOfSet(doc);
  if (!gate) throw new Error(UNREAD_NO_PASS);
  const join = await funnelVerifyJoin(doc);
  // a half-life set is not a rule's output, so the rule is not asked to give it back
  if (!doc.derived) {
    const footing = verifyFooting(doc, join);
    if (!footing.ok) throw new Error(footing.why);
  }
  // THE RETRAINED MEMBERS A HALF-LIFE SET'S RECORDS ARE CAPTURED FROM (3.95.0):
  // the run file beside the source, one member set per half-life, and each
  // record's own half-life from the set
  const hlFile = doc.derived ? readHalfLifeRun(doc.derived.from, doc.derived.run) : null;
  if (doc.derived && !hlFile) throw new Error('the retrained members this half-life set was built from are missing beside its source — press the half-life run on History again and build it again');
  const hlOf = new Map((doc.derived ? (doc.survivors || []) : []).map((sv) => [sv.label, sv.halfLife]));
  const parent = join.parent;                                   // the stage 3 set
  const shape = relaunchShapeOf(parent);                        // refuses when the stage 2 set is gone
  const idx = shape.records.findIndex((r) => unitKeyOf(r) === doc.unit);
  if (idx < 0) throw new Error(`the stage 3 set holds no unit called '${doc.unit}'`);
  const rec = shape.records[idx];
  const want = new Set(join.rows.map((r) => r.label));
  const held = new Set(shape.heldOn[idx]);
  const onUnit = shape.settings.filter((st) => want.has(st.label) && held.has(st.si));
  const missing = [...want].filter((L) => !onUnit.some((st) => st.label === L));
  const notCaptured = [];
  const settings = [];
  for (const st of onUnit) {
    const why = captureShapeWhy(st);
    if (why) notCaptured.push({ label: st.label, why }); else settings.push(st);
  }
  if (!settings.length) throw new Error(CAPTURE_NONE);
  const fee = Number((parent.params || {}).fee) || 0;
  // no scrambled copies: the capture is the real calendar's trades and nothing else
  const base = s3Payload({ doc: parent, parent: shape.parent, rec, settings, fee, nullN: 0 });
  base.keepN = 0;
  const models = unitRows(shape.parent.id, 'models', rec.blocks.models, rec.u);
  base.unit.members = base.unit.members.map((m, mi) => ({ ...m, saved: (models.find((x) => x.mi === mi) || {}).saved || null }));
  base.capture = true;
  let payloads = [base];
  if (doc.derived) {
    // one payload per half-life the records carry, each on the retrain layout with that half-life's members
    const groups = new Map();
    for (const st of settings) {
      const h = hlOf.get(st.label);
      if (!Number.isFinite(h)) throw new Error(`'${st.label}' carries no half-life on this set`);
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h).push(st);
    }
    payloads = [...groups.entries()].map(([h, list]) => {
      const members = hlFile.halfLives.find((x) => x.halfLifeMonths === h);
      if (!members) throw new Error(`the run file holds no members retrained at ${h} months`);
      return {
        ...base, settings: list,
        params: { ...(parent.params || {}), windowLayout: hlFile.layout },
        unit: { bandPct: hlFile.originalBandPct, probs: members.members.map((m) => m.probs), ts: members.ts, members: members.members.map((m) => ({ spec: m.spec, tauProbs: m.tauProbs, saved: m.saved })) },
      };
    });
  }
  if (note) note(0, payloads.length);
  const pool = createPool();
  activePool = pool;
  const settledAll = [];
  try {
    await pool.forEach('s3Unit', payloads, (settled, i) => { settledAll[i] = settled; if (note) note(settledAll.filter(Boolean).length, payloads.length); });
  } finally { activePool = null; pool.abort(); }
  const failed = settledAll.find((x) => !x || !x.ok);
  if (failed || settledAll.length !== payloads.length) throw new Error(`the unit's trades could not be captured: ${String((failed && failed.error) || 'no answer')}`);
  const res = { rows: settledAll.flatMap((x) => x.value.rows || []), windows: settledAll[0].value.windows };
  // one survivor without shopping: by depth inside the rule, among the CAPTURED survivors
  const capturedLabels = new Set(settings.map((st) => st.label));
  const pickRows = join.rows.filter((r) => capturedLabels.has(r.label));
  const pick = S4.pickByDepth(pickRows, join.rule);
  const survivors = (res.rows || []).map((r) => ({
    label: r.label, si: r.si, tHours: r.tHours, weekdaysOnly: !!r.weekdaysOnly, entry: r.entry, gate: r.gate, decision: r.decision, bandPct: r.bandPct,
    members: r.members, rung: r.rung ?? null, halfLife: doc.derived ? (hlOf.get(r.label) ?? null) : null,
    money: { test: r.pnl, hold: r.holdout ? r.holdout.pnl : null }, trades: { test: r.trades, hold: r.holdout ? r.holdout.trades : null },
    entries: (r.rich && r.rich.capture) || { train: [], test: [], hold: [] },
  }));
  const totals = { train: 0, test: 0, hold: 0 };
  for (const sv of survivors) for (const w of CAPTURE_WINDOWS) totals[w] += (sv.entries[w] || []).length;
  const at = new Date().toISOString();
  const fresh = getSet(doc.id);
  if (!fresh) throw new Error('the set went away while its trades were being captured');
  const had = fresh.capture || null;
  const times = (had ? Number(had.times) || 0 : 0) + 1;
  const file = {
    v: CAPTURE_V, id: doc.id, at, release: ENGINE_VERSION, times, gate, unit: doc.unit, unitName: doc.unitName || null,
    combo: { trade: rec.trade, ctx1: rec.ctx1 || null, ctx2: rec.ctx2 || null, size: rec.size || (rec.ctx1 ? (rec.ctx2 ? 3 : 2) : 1) }, geometry: rec.geometry,
    members: (rec.specs || []).length, fee: { feePerLeg: fee, feeUnits: 'fraction' }, windows: res.windows || null,
    pick: pick ? { by: 'depth', among: 'the captured survivors', label: pick.label, worst: pick.worst, mean: pick.mean } : null,
    survivors, notCaptured, missing,
  };
  writeCapture(doc.id, file);
  fresh.capture = {
    id: `${doc.id}-c${times}`, at, release: ENGINE_VERSION, times, gate, unit: doc.unit, members: file.members, fee: file.fee, windows: file.windows,
    survivors: join.rows.length, captured: survivors.length, notCaptured, missing, entries: totals, pick: file.pick,
    rows: survivors.map((sv) => ({ label: sv.label, tHours: sv.tHours, halfLife: sv.halfLife ?? null, entries: { train: sv.entries.train.length, test: sv.entries.test.length, hold: sv.entries.hold.length }, test: sv.money.test, held: sv.money.hold })),
    derived: doc.derived || null,
    // every scan on Tune that read this capture, newest first; a read of the held-back entries carries its look number
    reads: had && Array.isArray(had.reads) ? had.reads : [],
  };
  saveSet(fresh);
  return { id: fresh.capture.id, times, captured: survivors.length, notCaptured: notCaptured.length, missing: missing.length, entries: totals };
}
async function tuneCaptureDry(id) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  const cap = doc.capture || null;
  return {
    id: doc.id, name: doc.name, unit: doc.unit || null, unitName: doc.unitName || null, release: doc.release || null,
    ruleSentence: doc.ruleSentence || null, survivors: ((doc.counts || {}).survivors) ?? (doc.survivors || []).length,
    gate: unreadGateOf(doc), verdicts: (doc.verify || []).length,
    capture: cap,
    looks: cap ? (cap.reads || []).filter((r) => r && r.look != null).length : 0,
    refused: captureRefusalOf(doc),
    running: captureRun && captureRun.id === doc.id && !captureRun.result && !captureRun.error ? { token: captureRun.token } : null,
  };
}
const captureStatus = (run) => ({ running: !run.result && !run.error, token: run.token, done: run.done, of: run.of, cpu: cpuLoad(), error: run.error, result: run.result });
function tuneCaptureStart(id) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  if (captureRun && captureRun.id === id && !captureRun.result && !captureRun.error) return captureStatus(captureRun);
  const why = captureRefusalOf(doc);
  if (why) throw new Error(why);
  const run = { id, token: `${id}:${Date.now()}`, done: 0, of: 1, result: null, error: null, promise: null };
  captureRun = run;
  run.promise = tuneCaptureRun(doc, (done, of) => { run.done = done; run.of = of; })
    .then((result) => { run.result = result; run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return captureStatus(run);
}
function tuneCaptureStatus(id) {
  if (!captureRun || captureRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, cpu: cpuLoad(), error: null, result: null };
  return captureStatus(captureRun);
}
// the Stage 4 sets a scan on Tune can be aimed at: those carrying a capture, with what the picker needs and nothing heavy
function captureCandidates() {
  return listFunnelSets().filter((d) => !d.exam && d.capture && d.capture.captured > 0).map((d) => ({
    kind: 'stage4', id: d.id, name: d.name, unitName: d.unitName || null, at: d.capture.at, release: d.capture.release,
    survivors: d.capture.survivors, captured: d.capture.captured, members: d.capture.members, pick: d.capture.pick,
    rows: d.capture.rows || [], entries: d.capture.entries, looks: (d.capture.reads || []).filter((r) => r && r.look != null).length,
  }));
}
// WHAT A SCAN ON A CAPTURE IS AIMED AT, resolved before anything loads: the set, the
// survivor (by depth among the captured, or named) and the windows ticked.
function captureTargetOf(body) {
  const b = body || {};
  const doc = getSet(String(b.setId || ''));
  if (!doc || doc.stage !== 4) { const e = new Error(`unknown Stage 4 record set '${b.setId}'`); e.status = 404; throw e; }
  if (!doc.capture) { const e = new Error(`${doc.name}: ${CAPTURE_NOT_YET}`); e.status = 400; throw e; }
  const windows = Array.isArray(b.windows) ? b.windows.map(String) : [];
  const bad = windows.filter((w) => !CAPTURE_WINDOWS.includes(w));
  if (bad.length) { const e = new Error(`no window called '${bad[0]}' — the windows are ${CAPTURE_WINDOWS.map((w) => CAPTURE_WINDOW_WORDS[w]).join(', ')}`); e.status = 400; throw e; }
  if (!windows.length) { const e = new Error('tick at least one window for the scan to read: training, test or held-back'); e.status = 400; throw e; }
  const asked = b.pick == null || b.pick === '' || b.pick === 'depth' ? 'depth' : String(b.pick);
  const label = asked === 'depth' ? ((doc.capture.pick || {}).label || null) : asked;
  const row = (doc.capture.rows || []).find((r) => r.label === label) || null;
  if (!row) {
    const e = new Error(asked === 'depth' ? `${doc.name} has no survivor by depth among the captured` : `'${asked}' is not one of the ${doc.capture.captured} captured survivors of ${doc.name}`);
    e.status = 400; throw e;
  }
  return { doc, label, pick: asked === 'depth' ? 'depth' : 'named', windows: CAPTURE_WINDOWS.filter((w) => windows.includes(w)), bookId: `${doc.name} · ${label}` };
}
// A SCAN ON TUNE, RUN ON THE CAPTURED ENTRIES (3.92.0): the same tuner and the
// same ladder the older path runs, on the entries of one survivor over the
// windows ticked, at the survivor's own hold length and the set's fee, on the
// prices the chain was launched on. A read of the held-back entries is a look.
async function tuneOnCapture(body, tool) {
  if (tool !== 'stop' && tool !== 'conviction') throw new Error(`no scan called '${tool}'`);
  const t = captureTargetOf(body);
  const cap = readCapture(t.doc.id);
  if (!cap) throw new Error(`${t.doc.name}: the capture file beside the set is missing or unreadable — capture the trades of this set on Tune again`);
  const sv = cap.survivors.find((x) => x.label === t.label);
  if (!sv) throw new Error(`'${t.label}' is not in the capture file beside ${t.doc.name} — capture the trades of this set on Tune again`);
  const parent = getSet((t.doc.parent || {}).id);
  if (!parent) throw new Error('the stage 3 set this was cut from is gone, so the prices its trades were captured on cannot be read');
  const sw = require('./stagework');
  const { maps } = await sw.tradeMapFor(cap.combo, cap.geometry, parent.params || {}, pinOf(parent));
  const entries = t.windows.flatMap((w) => (sv.entries[w] || []).map((e) => ({ ...e, window: w }))).sort((a, b) => a.ts - b.ts);
  const fee = Number((cap.fee || {}).feePerLeg) || 0;
  const holdHours = sv.tHours;
  const isLook = t.windows.includes('hold');
  const fresh = getSet(t.doc.id);
  if (!fresh || !fresh.capture) throw new Error('the set or its capture went away while the scan was being set up');
  const reads = Array.isArray(fresh.capture.reads) ? fresh.capture.reads : [];
  const look = isLook ? reads.filter((r) => r && r.look != null).length + 1 : null;
  let out;
  if (tool === 'stop') {
    const { tuneFixedStop } = require('./stoptuner');
    const tune = tuneFixedStop(entries.map((e) => ({ entryTs: e.ts, side: e.side })), maps.trade, { holdHours, feePerLeg: fee });
    out = { setup: { id: t.bookId, combo: cap.combo, cell: { entry: 'market', gate: sv.gate, tHours: holdHours, trailMult: null, armMult: null }, holdHours }, ...tune };
  } else {
    const { entryOutcome } = require('./stoptuner');
    const { evalConviction } = require('./convictionsweep');
    const priced = [];
    let unpriced = 0;
    for (const e of entries) {
      const o = entryOutcome(e.ts, e.side, maps.trade, holdHours, fee);
      if (o.priced) priced.push({ entryTs: e.ts, side: e.side, agree: e.agree, netPct: o.netPct }); else unpriced++;
    }
    const members = Math.max(1, Number(cap.members) || 1);
    const ev = evalConviction(priced, { clipUsd: 10, ladder: Array.from({ length: members }, (_, i) => i + 1), holdHours });
    out = { setup: { id: t.bookId, combo: cap.combo, cell: { entry: 'market', gate: sv.gate, tHours: holdHours, trailMult: null, armMult: null }, members }, unpricedEntries: unpriced, ...ev };
  }
  const target = {
    kind: 'stage4', setId: t.doc.id, set: t.doc.name, unitName: t.doc.unitName || null, survivor: sv.label, pick: t.pick,
    windows: t.windows, windowWords: t.windows.map((w) => CAPTURE_WINDOW_WORDS[w]), entries: entries.length, captureAt: cap.at, captureRelease: cap.release, look,
  };
  fresh.capture.reads = [{ at: new Date().toISOString(), tool, survivor: sv.label, windows: t.windows, look }, ...reads];
  saveSet(fresh);
  return {
    ...out, target, trainThrough: null,
    fullHistory: {
      chunks: entries.length,
      firstChunkUtc: entries.length ? new Date(entries[0].ts).toISOString() : null,
      lastChunkUtc: entries.length ? new Date(entries[entries.length - 1].ts).toISOString() : null,
    },
    appliesToLiveRule: false,
  };
}

// ---- THE HISTORY HALF-LIFE RUN (3.94.0, AGEDIAL-DESIGN.md, owner design 2026-09-08) ----
//
// "4.h IS the same 199 records retrained." A Stage 4 record set's settings are
// kept exactly; only the forecasts behind them are retrained, once per
// half-life the owner ticked, with each training chunk's weight halving every
// H days of age multiplied into the set's own training weights; then the same
// records are priced again on the stretch the retraining never touched (the
// Reserve for a 61/13/13/13 set, the Held window for a 70/15/15 set), in ONE
// pass beside the unweighted column, through the stage 3 task. The arithmetic
// is lib/halflife.js's; the doors, the record on the set and the file beside it
// are here. Every press is a counted look; the count is information.
const HALFLIFE_V = 1;
const halfLifeFile = (setId, runId) => path.join(SETS_DIR, `${setId}-halflife-${runId}.json.gz`);
function readHalfLifeRun(setId, runId) {
  try {
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(halfLifeFile(setId, runId))).toString('utf8'));
    return raw && raw.v === HALFLIFE_V && Array.isArray(raw.halfLives) ? raw : null;
  } catch (_) { return null; }
}
function writeHalfLifeRun(setId, runId, rec) {
  const tmp = `${halfLifeFile(setId, runId)}.tmp${process.pid}-${++tmpSeq}`;
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(rec))));
  fs.renameSync(tmp, halfLifeFile(setId, runId));
  return rec;
}
// the set's own window layout is the chain's: read off the stage 3 parent
function layoutOfSet(doc) {
  const parent = getSet((doc.parent || {}).id);
  return parent ? ((parent.params || {}).windowLayout || null) : null;
}
// the ticked half-lives, checked against what is offered, sorted shortest first
function halfLifeMonthsOf(asked) {
  const HL = require('./halflife');
  const raw = Array.isArray(asked && asked.months) ? asked.months : [];
  const months = [...new Set(raw.map((m) => Number(m)))].filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (!months.length) throw new Error(`tick at least one half-life: ${HL.HALF_LIVES_MONTHS.join(', ')} months`);
  for (const m of months) if (!HL.HALF_LIVES_MONTHS.includes(m)) throw new Error(`${m} is not one of the half-lives offered (${HL.HALF_LIVES_MONTHS.join(', ')} months)`);
  return months;
}
function halfLifeRefusalOf(doc) {
  const HL = require('./halflife');
  if (!doc.unit) return BLEND_REFUSAL;
  if (doc.derived) return derivedRefusalOf(doc);
  if (!unreadGateOf(doc)) return UNREAD_NO_PASS;
  const parent = getSet((doc.parent || {}).id);
  if (!parent) return 'the stage 3 set this was cut from is gone, so its records cannot be retrained';
  if (!getSet((parent.parent || {}).id)) return 'the stage 2 set the stage 3 set was priced from is gone, so the members cannot be named';
  try { HL.retrainLayoutOf(layoutOfSet(doc)); } catch (err) { return err.message; }
  if (layoutOfSet(doc) === 'reserve61') {
    const sealed = sealedOnUnitOf(doc);
    if (!sealed.sealed) return `the sealed window is not intact on this unit — ${sealed.why}`;
  }
  if (!(doc.survivors || []).length) return 'this set wrote down no settings, so there is nothing to retrain';
  const busy = stageBusy();
  if (busy) return `${busy} — the half-life run waits for the box to be free`;
  if (setRichRun && !setRichRun.result && !setRichRun.error) return 'a Stage 4 record set is having its numbers worked out right now — one at a time';
  if (acrossBusy()) return `${acrossBusy()} — one heavy job at a time`;
  if (holdBusy()) return `${holdBusy()} — one heavy job at a time`;
  if (othersBusy()) return `${othersBusy()} — one heavy job at a time`;
  if (verifyRun && !verifyRun.result && !verifyRun.error) return 'a Stage 4 record set is being read right now — one at a time';
  return null;
}
async function halfLifeRunOn(doc, months, note = null) {
  const HL = require('./halflife');
  const gate = unreadGateOf(doc);
  if (!gate) throw new Error(UNREAD_NO_PASS);
  const join = await funnelVerifyJoin(doc);
  const footing = verifyFooting(doc, join);
  if (!footing.ok) throw new Error(footing.why);
  const parent = join.parent;                                   // the stage 3 set
  const shape = relaunchShapeOf(parent);                        // refuses when the stage 2 set is gone
  const stage2 = shape.parent;
  const idx = shape.records.findIndex((r) => unitKeyOf(r) === doc.unit);
  if (idx < 0) throw new Error(`the stage 3 set holds no unit called '${doc.unit}'`);
  const rec = shape.records[idx];
  const layout = HL.retrainLayoutOf((parent.params || {}).windowLayout);
  let sealed = null;
  if (layout.judge === 'reserve') {
    sealed = sealedOnUnitOf(doc);
    if (!sealed.sealed) throw new Error(`the sealed window is not intact on this unit — ${sealed.why}`);
  }
  const want = new Set(join.rows.map((r) => r.label));
  const held = new Set(shape.heldOn[idx]);
  const settings = shape.settings.filter((st) => want.has(st.label) && held.has(st.si));
  const missing = [...want].filter((L) => !settings.some((st) => st.label === L));
  if (!settings.length) throw new Error('none of this set\'s survivors is in the stage 3 set\'s block on this unit');
  const fee = Number((parent.params || {}).fee) || 0;
  const specs = (rec.specs || []).map((sp) => ({ model: sp.model, view: sp.view }));
  if (!specs.length) throw new Error('the stage 2 set names no members for this unit, so nothing can be retrained');
  const combo = { trade: rec.trade, ctx1: rec.ctx1 || null, ctx2: rec.ctx2 || null, size: rec.size || (rec.ctx1 ? (rec.ctx2 ? 3 : 2) : 1) };
  // EVERY OTHER TRAINING CHOICE THE SET WAS MADE WITH, from the stage 2 set that trained the members
  const p2 = stage2.params || {};
  const trainParams = { allLoaded: p2.allLoaded !== false, startMonth: p2.startMonth || null, endMonth: p2.endMonth || null, trainOn: p2.trainOn || null, weightCap: p2.weightCap ?? null, windowLayout: layout.layout };
  const pin = pinOf(parent);
  const of = months.length + 1 + months.length;
  let done = 0;
  const tick = () => { done++; if (note) note(done, of); };
  if (note) note(0, of);
  const pool = createPool();
  activePool = pool;
  const trained = new Array(months.length);
  const priced = [];
  try {
    // 1. the members retrained, once per half-life, across the workers
    await pool.forEach('hlTrain', months.map((m) => ({ combo, geometry: rec.geometry, specs, fee, halfLifeMonths: m, params: trainParams, pin })), (settled, i) => {
      trained[i] = settled.ok ? settled.value : { halfLifeMonths: months[i], halfLifeDays: HL.daysOfMonths(months[i]), effectiveDays: null, refused: `the retraining failed: ${String(settled.error || 'no answer')}` };
      tick();
    });
    // 2. the pricing, in one pass: the unweighted column from the set's own votes and models, then each half-life
    const base = s3Payload({ doc: parent, parent: stage2, rec, settings, fee, nullN: 0 });
    base.keepN = 0;
    const models = unitRows(stage2.id, 'models', rec.blocks.models, rec.u);
    base.unit.members = base.unit.members.map((m, mi) => ({ ...m, saved: (models.find((x) => x.mi === mi) || {}).saved || null }));
    if (layout.judge === 'reserve') base.unread = { fromTs: sealed.fromTs };
    const payloads = [{ key: HL.NONE, payload: base }];
    for (const t of trained) {
      if (!t || t.refused) continue;
      payloads.push({
        key: HL.keyOf(t.halfLifeMonths),
        payload: {
          ...base,
          params: { ...(parent.params || {}), windowLayout: layout.layout },
          // PRICED AT THE UNIT'S ORIGINAL BAND: the trade shapes are the set's own; only the forecasts changed
          unit: { bandPct: rec.bandPct, probs: t.members.map((m) => m.probs), ts: t.ts, members: t.members.map((m) => ({ spec: m.spec, tauProbs: m.tauProbs, saved: m.saved })) },
        },
      });
    }
    await pool.forEach('s3Unit', payloads.map((x) => x.payload), (settled, i) => { priced[i] = { key: payloads[i].key, ...settled }; tick(); });
  } finally { activePool = null; pool.abort(); }
  const none = priced.find((x) => x.key === HL.NONE);
  if (!none || !none.ok) throw new Error(`the unweighted column could not be priced: ${String((none && none.error) || 'no answer')}`);
  const noneRes = none.value;
  // 3. the table
  const columns = [];
  const byKey = {};
  for (const t of trained) {
    const key = HL.keyOf(t.halfLifeMonths);
    const pr = priced.find((x) => x.key === key) || null;
    let refused = t.refused || null;
    if (!refused && (!pr || !pr.ok)) refused = `the pricing failed: ${String((pr && pr.error) || 'no answer')}`;
    // ONE STRETCH FOR EVERY COLUMN: on the Reserve the box's data is read on the day, and two readings that reached different ends are not one table
    if (!refused && layout.judge === 'reserve' && pr.value.unread && noneRes.unread && pr.value.unread.seenToTs !== noneRes.unread.seenToTs) {
      refused = 'the box\'s data grew between this column and the unweighted one; press again so every column reads one stretch';
    }
    columns.push({ key, months: t.halfLifeMonths, days: t.halfLifeDays, effectiveDays: t.effectiveDays ?? null, weighedByMoney: t.weighedByMoney ?? null, trainedBandPct: t.trainedBandPct ?? null, refused });
    byKey[key] = refused ? null : pr.value;
  }
  columns.push({ key: HL.NONE, months: null, days: null, effectiveDays: null, refused: null });
  byKey[HL.NONE] = noneRes;
  const rowOf = (res, label) => ((res && res.rows) || []).find((r) => r.label === label) || null;
  const rows = settings.map((st) => {
    const money = {};
    const trades = {};
    const test = {};
    for (const c of columns) {
      const r = rowOf(byKey[c.key], st.label);
      money[c.key] = r && r.holdout ? r.holdout.pnl : null;
      trades[c.key] = r && r.holdout ? r.holdout.trades : null;
      test[c.key] = r ? r.pnl : null;
    }
    const r0 = rowOf(noneRes, st.label);
    return { si: st.si, label: st.label, tHours: r0 ? r0.tHours : null, money, trades, test };
  });
  const read = HL.readTable(rows, columns);
  const t0 = trained.find((t) => t && !t.refused) || null;
  const window = layout.judge === 'reserve'
    ? { ...noneRes.unread }
    : (() => { const w = ((((parent.windows || {}).units) || {})[doc.unit] || {}).hold || null; return w ? { fromTs: w.fromTs, toTs: w.toTs, chunks: w.chunks } : { chunks: noneRes.counts ? noneRes.counts.hold : null }; })();
  const at = new Date().toISOString();
  const fresh = getSet(doc.id);
  if (!fresh) throw new Error('the set went away while its records were being retrained');
  const had = fresh.halflife || [];
  const block = {
    id: `${doc.id}-h${had.length + 1}`, at, release: ENGINE_VERSION, look: had.length + 1,
    gate, judge: layout.judge, judgeWord: layout.judgeWord, layout: layout.layout, shares: { train: layout.train, test: layout.test, untouched: layout.untouched },
    months, columns, window,
    counts: { train: t0 ? t0.counts.train : null, test: t0 ? t0.counts.test : null, hold: t0 ? t0.counts.hold : null, original: noneRes.counts || null },
    unit: doc.unit, unitName: doc.unitName || null, members: specs.length, fee: { feePerLeg: fee, feeUnits: 'fraction' },
    survivors: join.rows.length, missing,
    rows: read.rows, wins: read.wins, averages: read.averages, figures: read.counts,
  };
  writeHalfLifeRun(doc.id, block.id, {
    v: HALFLIFE_V, id: block.id, setId: doc.id, at, release: ENGINE_VERSION, judge: layout.judge, layout: layout.layout,
    unit: doc.unit, combo, geometry: rec.geometry, fee: block.fee, params: trainParams, pin, originalBandPct: rec.bandPct,
    window, halfLives: trained.filter((t) => t && !t.refused),
  });
  fresh.halflife = [block, ...had];
  saveSet(fresh);
  return { id: block.id, look: block.look, rows: block.rows.length, wins: block.wins, columns: columns.map((c) => c.key), refused: columns.filter((c) => c.refused).map((c) => c.key) };
}
// THE 4.h SET, BUILT FROM A TABLE (3.95.0, owner design): every row whose
// green cell sits under a half-life column, each record carrying the
// half-life that won on it; rows the unweighted column won are left out. A
// Stage 4 record set document like any cut, marked as built from its source
// and its run, on the same unit and parent, with the source's rule and check;
// named by the owner. It stands on the source's PASS.
function buildHalfLifeSet(setId, asked = {}) {
  const HL = require('./halflife');
  const S4 = require('./funnelset');
  const src = getSet(setId);
  if (!src || src.stage !== 4) throw new Error(`unknown Stage 4 record set '${setId}'`);
  if (src.derived) throw new Error('a half-life set is built from the set it came from, not from another half-life set');
  const run = (src.halflife || []).find((r) => r.id === String(asked.runId || ''));
  if (!run) throw new Error('name which half-life table to build from');
  if (!readHalfLifeRun(src.id, run.id)) throw new Error('the retrained members for that table are missing beside the set — press the half-life run again');
  const kept = (run.rows || []).filter((r) => r.best && r.best !== HL.NONE);
  if (!kept.length) throw new Error('no record improved with any half-life on this table, so there is nothing to build');
  const name = String(asked.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('name the half-life set — something you will recognise on Tune and Greenlight');
  const taken = nameTaken(name);
  if (taken) throw new Error(`a record set called "${name}" already exists (${taken.id}) — pick another name`);
  const parent = getSet((src.parent || {}).id);
  if (!parent) throw new Error('the stage 3 set the source was cut from is gone');
  const seq = seqFor(4);
  const id = `s4-${Date.now().toString(36)}-${seq}`;
  const doc = S4.newFunnelSet({
    id, seq, name, parent, release: ENGINE_VERSION, target: src.target, seed: src.seed || id,
    boardNull: src.boardNull || null, sealed: src.sealed || null, unit: src.unit, unitName: src.unitName || null, check: src.check || null,
  });
  doc.derived = { kind: 'halflife', from: src.id, fromName: src.name, run: run.id, at: new Date().toISOString(), judge: run.judge, judgeWord: run.judgeWord, layout: run.layout, months: run.months || [] };
  doc.rule = src.rule;
  doc.userRule = src.userRule || null;
  doc.exam = !!src.exam;
  doc.survivors = kept.map((r) => ({
    si: r.si, label: r.label, halfLife: Number(String(r.best).slice(1)),
    money: { judge: (r.money || {})[r.best] ?? null, unweighted: (r.money || {})[HL.NONE] ?? null },
    trades: { judge: (r.trades || {})[r.best] ?? null, unweighted: (r.trades || {})[HL.NONE] ?? null },
  }));
  doc.counts = { survivors: kept.length, of: (run.rows || []).length, target: src.target };
  doc.closing = src.closing || null;
  doc.warnings = [];
  doc.marks = Array.isArray(src.marks) ? src.marks.slice() : [];
  doc.ruleSentence = `${src.ruleSentence || S4.ruleSentence(src.rule)} · retrained, a half-life per record`;
  doc.rich = src.rich || {};
  saveSet(doc);
  return { id: doc.id, name: doc.name, survivors: kept.length, of: (run.rows || []).length, from: src.id, run: run.id };
}
async function halfLifeDry(id) {
  const HL = require('./halflife');
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  let layout = null;
  let layoutWhy = null;
  try { layout = HL.retrainLayoutOf(layoutOfSet(doc)); } catch (err) { layoutWhy = err.message; }
  return {
    id: doc.id, name: doc.name, unit: doc.unit || null, unitName: doc.unitName || null, release: doc.release || null,
    ruleSentence: doc.ruleSentence || null, survivors: ((doc.counts || {}).survivors) ?? (doc.survivors || []).length,
    gate: unreadGateOf(doc), verdicts: (doc.verify || []).length,
    windowLayout: layoutOfSet(doc), layout, layoutWhy,
    halfLives: HL.HALF_LIVES_MONTHS.slice(),
    runs: doc.halflife || [], looks: (doc.halflife || []).length,
    // the half-life sets already built from this set, newest first
    built: listFunnelSets().filter((d) => d.derived && d.derived.from === doc.id).map((d) => ({ id: d.id, name: d.name, run: d.derived.run, at: d.derived.at, survivors: (d.counts || {}).survivors ?? (d.survivors || []).length, of: (d.counts || {}).of ?? null })),
    refused: halfLifeRefusalOf(doc),
    running: halfLifeRun && halfLifeRun.id === doc.id && !halfLifeRun.result && !halfLifeRun.error ? { token: halfLifeRun.token, done: halfLifeRun.done, of: halfLifeRun.of } : null,
  };
}
const halfLifeStatusOf = (run) => ({ running: !run.result && !run.error, token: run.token, done: run.done, of: run.of, cpu: cpuLoad(), error: run.error, result: run.result });
function halfLifeStart(id, asked = {}) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  if (halfLifeRun && halfLifeRun.id === id && !halfLifeRun.result && !halfLifeRun.error) return halfLifeStatusOf(halfLifeRun);
  const why = halfLifeRefusalOf(doc);
  if (why) throw new Error(why);
  const months = halfLifeMonthsOf(asked);
  const run = { id, token: `${id}:${Date.now()}`, done: 0, of: months.length * 2 + 1, result: null, error: null, promise: null };
  halfLifeRun = run;
  run.promise = halfLifeRunOn(doc, months, (done, of) => { run.done = done; run.of = of; })
    .then((result) => { run.result = result; run.done = run.of; })
    .catch((err) => { run.error = String((err && err.message) || err); });
  return halfLifeStatusOf(run);
}
function halfLifeStatus(id) {
  if (!halfLifeRun || halfLifeRun.id !== id) return { running: false, none: true, token: null, done: 0, of: 0, cpu: cpuLoad(), error: null, result: null };
  return halfLifeStatusOf(halfLifeRun);
}

// ---- V0: THE STAGE-ENGINE CHECK (3.87.0, VERIFY-DESIGN.md) ----------------------
//
// The declaration and the grading are lib/stagegate.js's, pure. Running it is
// this file's, because it owns every door the exam walks through: two coins
// fabricated with the check's own generator, stage 1, stage 2, a small
// stage 3 with every copy kept, the declared rule cut into a Stage 4 set on
// each coin, the verdict pressed on both, five gates graded, one record written
// in the exam's own directory -- and everything it made deleted, so nothing of
// it is ever on Boards. Started and polled; a heavy job like any other.
let examRun = null;   // { id, startedAt, step, sets, error, result, promise }
const examBusy = () => (examRun && !examRun.result && !examRun.error ? `the stage-engine check (${examRun.step})` : null);
async function examWait(id, label, ms = 20 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const doc = getSet(id);
    if (doc && doc.status !== 'running') return doc;
    if (Date.now() - t0 > ms) throw new Error(`${label} did not finish in ${Math.round(ms / 60000)} minutes`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
}
function examCleanup(run) {
  // children first: a set another set names as its parent is never deleted
  for (const id of run.sets.slice().reverse()) {
    try { deleteSet(id, id); } catch (_) { /* a set that was never written */ }
    try { fs.rmSync(funnelRichFile(id), { force: true }); } catch (_) { /* none */ }
    try { fs.rmSync(agreedFile(id), { force: true }); } catch (_) { /* none */ }
  }
  const G = require('./stagegate');
  const { CACHE_DIR } = require('./binance');
  let files = [];
  try { files = fs.readdirSync(CACHE_DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (G.SYMBOLS.some((s) => f.startsWith(`${s}-1h-`))) { try { fs.rmSync(path.join(CACHE_DIR, f), { force: true }); } catch (_) { /* best effort */ } }
  }
}
async function runStageGate(run) {
  const G = require('./stagegate');
  const { generateFabricated } = require('./fabricated');
  const tag = `stage-engine check ${run.id}`;
  run.step = 'fabricating the two coins';
  generateFabricated(G.SPAN, G.PLANT, G.SEEDS[G.PLANT], 0);   // the plant, alive the whole span
  generateFabricated(G.SPAN, G.FAIR, G.SEEDS[G.FAIR], 1);     // a fair coin, the rule never on
  run.step = 'stage 1';
  const s1 = startStage1({ ...G.STAGE1, exam: true, name: `${tag} S1` });
  run.sets.push(s1.id);
  const d1 = await examWait(s1.id, 'stage 1');
  if (d1.status !== 'done') throw new Error(`stage 1 ended ${d1.status}: ${JSON.stringify(d1.failures || [])}`);
  // what stage 1 itself saw on each coin, for the record
  const stage1 = {};
  for (const r of rowstore.readAll(s1.id, 'records')) {
    stage1[r.trade === G.PLANT ? 'planted' : 'fair'] = { score: r.score ?? null, beat: r.beat ?? null, pairs: r.pairs ?? null, money: r.money ?? null, moneyTrades: r.moneyTrades ?? null, beatMoney: r.beatMoney ?? null };
  }
  run.step = 'stage 2';
  const s2 = startStage2({ ...G.STAGE2, from: s1.id, exam: true, name: `${tag} S2` });
  run.sets.push(s2.id);
  const d2 = await examWait(s2.id, 'stage 2');
  if (d2.status !== 'done') throw new Error(`stage 2 ended ${d2.status}: ${JSON.stringify(d2.failures || [])}`);
  run.step = 'stage 3';
  const s3 = startStage3({ ...G.STAGE3, from: s2.id, exam: true, name: `${tag} S3` });
  run.sets.push(s3.id);
  const d3 = await examWait(s3.id, 'stage 3');
  if (d3.status !== 'done') throw new Error(`stage 3 ended ${d3.status}: ${JSON.stringify(d3.failures || [])}`);
  run.step = 'totalling';
  const t = readTally(s3.id) || await buildTally(getSet(s3.id));
  run.step = 'cutting the declared rule on each coin';
  const units = unitsOfSet(t, s3.id);
  const keyOf = (sym) => (units.find((u) => u.trade === sym) || {}).key || null;
  if (!keyOf(G.PLANT) || !keyOf(G.FAIR)) throw new Error('the stage 3 set does not hold both fabricated coins');
  const cuts = {};
  for (const [which, sym] of [['planted', G.PLANT], ['fair', G.FAIR]]) {
    // eslint-disable-next-line no-await-in-loop
    const cut = await cutFunnelSet(s3.id, { rule: G.RULE, closing: { key: 'rule' }, unit: keyOf(sym), barPct: 100, exam: true, name: `${tag} ${which}` });
    run.sets.push(cut.id);
    cuts[which] = cut;
  }
  run.step = 'the verdict on each coin';
  const blocks = {};
  for (const which of ['planted', 'fair']) {
    // the exam holds the box, so it presses the read directly rather than through the one-at-a-time door
    // eslint-disable-next-line no-await-in-loop
    await funnelVerifyRun(getSet(cuts[which].id), { barPct: 100 });
    blocks[which] = getSet(cuts[which].id).verify[0];
  }
  // for scale: a trader who follows the plant's label, through the same
  // simulator at the chunk's own hold and the exam's fee, on the same windows
  run.step = 'the label-following trader, for scale';
  let reference = null;
  try {
    const sw = require('./stagework');
    const p1 = { windowLayout: G.STAGE1.windowLayout, allLoaded: false, startMonth: G.STAGE1.startMonth, endMonth: G.STAGE1.endMonth, trainOn: G.STAGE1.trainOn, weightCap: sw.WEIGHT_CAP_DEFAULT, pinnedFiles: null };
    const { geo, maps, split } = await sw.unitChunks({ trade: G.PLANT, ctx1: null, ctx2: null, size: 1 }, G.STAGE1.geometry, p1);
    const labelCalls = (chunks) => chunks.map((c) => (c.label > 0 ? 1 : c.label < 0 ? -1 : 0));
    const on = (chunks) => { const m = sw.directionMoney(chunks, labelCalls(chunks), maps.trade, geo, G.STAGE3.fee); return { pnl: m.pnl, trades: m.trades }; };
    reference = { planted: { test: on(split.testChunks), hold: on(split.holdChunks) } };
  } catch (err) { reference = { error: String((err && err.message) || err) }; }
  const g = G.grade({ planted: blocks.planted, fair: blocks.fair, s3: d3, stage1, reference });
  const summary = (b) => ({
    survivors: (b.heldBack || {}).of ?? 0, real: (b.heldBack || {}).real ?? null,
    buyHold: (((b.heldBack || {}).comparisons || {}).buyHold || {}).hi ?? null,
    beats: (b.copies || {}).beats ?? 0, copies: (b.copies || {}).copies ?? 0, pass: !!(b.copies || {}).pass,
    // each survivor's own reading, so a FAIL names the setting and the money
    rows: (((b.survivors || {}).rows) || []).map((r) => ({ label: r.label, held: r.held, trades: r.trades, beats: r.beats, copiesKept: r.copiesKept })),
  });
  return G.writeRecord({
    id: run.id, at: new Date().toISOString(), release: ENGINE_VERSION, pass: g.pass,
    checks: g.checks, sentences: g.sentences, chance: g.chance, copies: g.copies, bar: g.bar,
    rule: G.RULE, span: { ...G.SPAN }, planted: summary(blocks.planted), fair: summary(blocks.fair),
    stage1, reference,
    stage3: { settings: (d3.plan || {}).settings ?? null, units: (d3.plan || {}).units ?? null, failures: (d3.failures || []).length },
    elapsedMs: Date.now() - run.startedAt,
  });
}
// WHAT THE BOX IS BUSY WITH, in one answer (3.98.0): a data job, a stage run, a
// totalling, the step-6 press or the check itself. The check's own press sleeps
// on it and the deploy gate reads it off the status, so the two cannot disagree.
// It was the planted check's status that carried this until that check went
// with the older sweep path (3.97.0). Null when the box is free.
function stageGateBlockedBy() {
  return require('./jobs').anyJobRunning() ? 'a data job is running' : (stageBusy() || require('./compute').sweepRunsHereOr());
}
function stageGateStatus() {
  const G = require('./stagegate');
  const out = G.status(ENGINE_VERSION, { running: examBusy() });
  out.blockedBy = stageGateBlockedBy();
  if (examRun) out.run = { id: examRun.id, step: examRun.step, error: examRun.error, done: !!examRun.result, startedAt: new Date(examRun.startedAt).toISOString() };
  return out;
}
function stageGateStart() {
  if (examRun && !examRun.result && !examRun.error) throw new Error('the stage-engine check is already running');
  const busy = stageGateBlockedBy();
  if (busy) throw new Error(`${busy} — the stage-engine check fabricates two coins and runs all three stages, so it waits for the box to be free`);
  const run = { id: `sg-${Date.now().toString(36)}`, startedAt: Date.now(), step: 'starting', sets: [], error: null, result: null, promise: null };
  examRun = run;
  run.promise = runStageGate(run)
    .then((rec) => { run.result = rec; })
    .catch((err) => { run.error = String((err && err.message) || err); })
    .finally(() => { try { examCleanup(run); } catch (_) { /* best effort */ } });
  return stageGateStatus();
}

function listFunnelSets(parentId = null) {
  return listSets()
    .filter((x) => String(x.id).startsWith('s4-'))
    .map((x) => getSet(x.id))
    .filter((d) => d && (!parentId || ((d.parent || {}).id === parentId)))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ---- THE STAGE 4 SETS OF ONE COIN AND SHAPE, AND THE ROWS ONE HOLDS ----------
//
// (3.58.0, owner order 2026-09-04: "for the given selected coin and shape at the
// top of Funnel ... there's an option to view the one or more Stage 4 record sets
// that have been generated".) The cut sets travel on the Funnel read itself,
// matched on the PARENT and on the UNIT, so the page never has to ask a second
// door which sets belong to what is on screen. A set cut on the blended board
// carries no unit; the page's word for that board is 'all', and they are the
// same board.
// EVERY STAGE 4 SET OF THIS STAGE 3 SET, WHATEVER COIN AND SHAPE IT WAS CUT ON
// (3.104.1, owner order 2026-09-10: "the Stage 4 record set selector must
// display ALL OF THE RECORD SETS ASSOCIATED WITH THE LOADED Stage 3 table
// WITHOUT FILTERING BY the coin, alongside 1, alongside 2, and chunk shape
// boxes. otherwise Stage 4 sets from previous funnel rules cannot be selected
// without remembering their parameters").
//
// The list used to be cut down to the board on screen, which made every set
// reachable only by first setting four boxes back to what they were when it was
// written -- a list you can only use if you already know what is in it.
//
// `mine` says whether a set belongs to the board on screen, and it is what the
// two things that must stay per-unit read: which set a first visit opens by
// itself, and whether the walk in hand is the walk that wrote one of them.
function funnelCutsFor(parentId, unitKey) {
  const want = unitKey == null || String(unitKey) === 'all' ? null : String(unitKey);
  return listFunnelSets(parentId)
    .filter((d) => !d.exam && !d.derived)
    .map((d) => ({
      id: d.id, seq: d.seq, name: d.name, createdAt: d.createdAt,
      unit: d.unit || null,
      mine: (d.unit || null) === want,
      survivors: (d.counts || {}).survivors ?? null, target: (d.counts || {}).target ?? null,
      // AND THE RULE IT WROTE, IN THE SAME WORDS THE WALK SAYS ITS OWN
      // (3.59.0). It is how the screen knows the walk it is holding is the
      // walk that produced this set -- and so that `new rule` starts a new
      // rule at step 1 rather than dropping back into a finished one at step
      // 7. Both sentences come from S4.ruleSentence, so they compare.
      ruleSentence: d.ruleSentence || null,
    }));
}

// THE ROWS OF ONE STAGE 4 SET. Membership comes from the RECORD -- the survivors
// it wrote down -- and the numbers are laid on from its parent's board for the
// same unit. Re-deriving membership from the rule would show today's answer under
// yesterday's name: a set is a decision, not a query. The rule IS re-applied,
// once, and the answer is REPORTED, so a set whose rule no longer reproduces its
// own survivors says so on the screen instead of quietly showing something else.
//
// The board is the same board the walk read -- funnelBoard, then the rebuilt
// numbers laid on -- so the figures here and the figures the rule was built on
// cannot be two different readings.
async function funnelSetRows(id, opts = {}) {
  const doc = getSet(id);
  if (!doc || doc.stage !== 4) throw new Error(`unknown Stage 4 record set '${id}'`);
  const parentId = (doc.parent || {}).id || null;
  const parent = parentId ? getSet(parentId) : null;
  if (!parent) throw new Error(`the stage 3 set this was cut from (${parentId || 'unnamed'}) is gone, so its rows cannot be read back`);
  const t = readTally(parentId);
  if (!t) return { needsTally: parentId };
  const S4 = require('./funnelset');
  const F = require('./funnel');
  const board = await funnelBoard(parentId, t, doc.unit || 'all');
  // TWO VIEWS OF THE SAME BOARD (3.68.0). `all` is the parent's board as it
  // stands today, which is what "does this rule still give this list" has to be
  // asked against. `mine` is that board with the set's OWN copy of the rebuilt
  // numbers laid over it, which is what its rows are read from -- so its
  // columns are complete whatever has happened to the parent's file since.
  const all = withFunnelRich(board.all, readFunnelRich(parentId));
  const wanted = doc.survivors || [];
  // A SET CUT BEFORE THE SET KEPT ITS OWN COPY IS FILLED IN AND STAMPED, ONCE
  // (RULE NINE). Whatever the parent's file still holds for this set's
  // survivors becomes the set's own; what the parent has lost cannot be
  // invented here and is reported instead of guessed at.
  let richStamped = false;
  if (!doc.rich) {
    const want0 = new Set(wanted.map((x) => x.label));
    doc.rich = richForSurvivors(all.filter((r) => want0.has(r.label)));
    saveSet(doc);
    richStamped = true;
  }
  const mine = withOwnRich(all, doc.rich);
  // ONLY THE SURVIVORS ARE HELD IN HAND. A map of every label on the board is a
  // second copy of a 137,760-row index built on every sort and every page turn;
  // the set names a hundred or so, and a hundred is what is kept.
  const want = new Set(wanted.map((s) => s.label));
  const byLabel = new Map();
  for (const r of mine) if (want.has(r.label)) byLabel.set(r.label, r);
  const rows = wanted.map((s) => byLabel.get(s.label) || { si: s.si, label: s.label, gone: true });
  const gone = rows.filter((r) => r.gone).length;
  // THE RULE THE OWNER BUILT, BEFORE STEP 5 REPLACED IT (3.61.0). Recorded on
  // every set cut from now on; recovered from the walk's own steps for one cut
  // before that, and STAMPED onto the record then, so it is read back and never
  // replayed twice (RULE NINE).
  let userRule = doc.userRule || null;
  let userStamped = false;
  if (!userRule) {
    const axes = {};
    for (const dial of F.CATEGORICAL_DIALS) {
      axes[dial] = F.sortedValues(dial, [...new Set(all.map((r) => F.keyOf(r[dial])))]);
    }
    userRule = S4.userRuleFromSteps(doc.steps, axes);
    if (userRule) { doc.userRule = userRule; saveSet(doc); userStamped = true; }
  }
  const userRows = userRule ? S4.applyRule(all, S4.normaliseRule(userRule)) : null;
  // DOES THE RULE STILL GIVE THIS LIST? Applied once against the same board, and
  // the answer travels to the screen -- never acted on here.
  const now = S4.applyRule(all, S4.normaliseRule(doc.rule));
  const had = new Set(wanted.map((s) => s.label));
  const same = now.length === wanted.length && now.every((r) => had.has(r.label));
  // AND THE SAME QUESTION ASKED OF THE SET'S OWN NUMBERS (3.68.0). When the two
  // answers differ, the rule has not changed and the board has not changed --
  // what has gone is a number the rule READS, off the parent's shared file,
  // taken away by a later pass over the same stage 3 records. Saying which
  // number and how many rows still carry it is the difference between a set
  // that looks broken and one that says what happened to it.
  const nowOwn = S4.applyRule(mine, S4.normaliseRule(doc.rule));
  const sameOwn = nowOwn.length === wanted.length && nowOwn.every((r) => had.has(r.label));
  const readsRebuilt = Object.keys((S4.normaliseRule(doc.rule).floors) || {}).filter((f) => RICH_FIELDS.includes(f));
  const onParent = {};
  for (const f of readsRebuilt) onParent[f] = all.reduce((n, r) => n + (r[f] == null ? 0 : 1), 0);
  const onMine = {};
  for (const f of readsRebuilt) onMine[f] = rows.reduce((n, r) => n + (r[f] == null ? 0 : 1), 0);
  // WHICH DIALS STILL VARY among the survivors, and what the rest are fixed at.
  // A dial the same on every row is a fact about the whole set: said once above
  // the table rather than repeated down a column of one repeated value.
  const varying = [];
  const fixed = {};
  for (const dial of F.ALL_DIALS) {
    const seen = new Set();
    for (const r of rows) { seen.add(F.keyOf(r[dial])); if (seen.size > 1) break; }
    if (seen.size > 1) varying.push(dial);
    else if (rows.length) fixed[dial] = rows[0][dial] === undefined ? null : rows[0][dial];
  }
  // WHICH COLUMNS ANYTHING IS BEHIND. A column of dashes says the numbers are
  // missing; a named line above the table says WHY, and that is the honest one.
  const has = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (Array.isArray(v)) { if (v.some((x) => x != null)) has[k] = true; continue; }
      if (v != null) has[k] = true;
    }
  }
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!Array.isArray(r[k])) keys.add(k);
  const sort = opts.sort && keys.has(String(opts.sort)) ? String(opts.sort)
    : (keys.has('avgTest') ? 'avgTest' : 'label');
  const dir = String(opts.dir || 'desc') === 'asc' ? 1 : -1;
  // A ROW WITH NOTHING IN THE SORTED COLUMN SITS AT THE BOTTOM EITHER WAY, and
  // ties break on the setting's own name, so the same sort always gives the same
  // order -- a page boundary that moves under a reload loses rows off the list.
  rows.sort((x, y) => {
    const a = x[sort]; const b = y[sort];
    const an = a == null; const bn = b == null;
    if (an !== bn) return an ? 1 : -1;
    if (!an) {
      const na = Number(a); const nb = Number(b);
      const c = (Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '')
        ? na - nb : String(a).localeCompare(String(b));
      if (c !== 0) return c * dir;
    }
    return String(x.label).localeCompare(String(y.label));
  });
  // EVERY ROW, NOT A PAGE OF THEM (3.61.0, owner order: a page selector under a
  // box that scrolls is "a COMPLETE WASTE OF SPACE"). The cap is a guard against
  // a set nobody meant to cut, and when it bites the screen says so rather than
  // quietly showing part of a decision.
  const total = rows.length;
  const per = 2000;
  const from = 0;
  // THE SEALED WINDOW ON THIS UNIT, not across the parent's ten. A set cut on one
  // coin and shape is graded on that one, and "intact on all 10 unit(s)" beside a
  // one-unit set answers a question nobody asked.
  const sealedOn = (() => {
    const s = doc.sealed || null;
    if (!s) return { sealed: false, of: 0, missing: 0, why: 'this set recorded no sealed window' };
    const us = Array.isArray(s.units) ? s.units : [];
    const mine = doc.unit ? us.filter((u) => unitKeyOf(u) === doc.unit) : us;
    if (doc.unit && !mine.length) return { sealed: false, of: 0, missing: 0, why: `its parent's records name no unit '${doc.unit}'` };
    const missing = mine.filter((u) => !u || !u.reserve).length;
    // where this unit's unread window begins, and the newest candle the box
    // holds for its coins today -- which is where it ends (3.85.0)
    const starts = mine.map((u) => u && u.reserve && Number(u.reserve.fromTs)).filter(Number.isFinite);
    return {
      sealed: mine.length > 0 && missing === 0, of: mine.length, missing,
      why: missing ? (s.why || 'a unit has no reserved window') : null,
      fromTs: starts.length ? Math.min(...starts) : null,
      dataToTs: mine.length ? newestDataOf(coinsOfUnits(mine)) : null,
    };
  })();
  return {
    set: {
      id: doc.id, seq: doc.seq, name: doc.name, createdAt: doc.createdAt,
      nameEditedAt: doc.nameEditedAt || null,
      release: doc.release || null, parent: doc.parent || null,
      unit: doc.unit || null, unitName: doc.unitName || null,
      target: (doc.counts || {}).target ?? doc.target ?? null,
      survivors: (doc.counts || {}).survivors ?? wanted.length,
      rule: doc.rule, ruleSentence: doc.ruleSentence || S4.ruleSentence(doc.rule),
      userRule,
      userSentence: userRule ? S4.ruleSentence(S4.normaliseRule(userRule)) : null,
      userSurvivors: userRows ? userRows.length : null,
      userStamped,
      closing: doc.closing || null, warnings: doc.warnings || [],
      check: doc.check || null, boardNull: doc.boardNull || null,
      steps: (doc.steps || []).length, backSteps: (doc.backSteps || []).length,
      marks: doc.marks || [], replayChecked: doc.replayChecked || null,
    },
    of: all.length,
    sealedOn,
    record: {
      same, now: now.length, had: wanted.length, gone,
      // 3.68.0: the same question asked of the set's own copy of the rebuilt
      // numbers, and which of the numbers its rule reads are still on the
      // parent's board -- so a set can say what happened to it rather than
      // just reading as broken.
      sameOwn, own: nowOwn.length, stamped: richStamped,
      reads: readsRebuilt, onParent, onMine, ofOwn: Object.keys(doc.rich || {}).length,
    },
    varying, fixed, has,
    total, from, per, clipped: Math.max(0, total - per), sort, dir: dir === 1 ? 'asc' : 'desc',
    rows: rows.slice(from, from + per),
  };
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
  feeOrRefuse, moneyDriftOf, publicParams,
  // exported so the sort can be checked by BEHAVIOUR rather than by matching
  // the shape of its source, which rotted the moment a second share column
  // arrived
  sortValue,
  coinsFingerprinted, manifestComplaint, sameEngineLine, stageBusy, claimOrRefuse, foldSameTradeSettings, heldOnFor, pricingsOf, stampUnitSettingsFromRows, SAME_TRADE_TOLERANCE,
  listSets, getSet, chainOf, stageRunning, cancelStage, markInterrupted,
  startStage1, startStage2, startStage3,
  missingUnitsOf, unitFillRefusal, fillMissingUnitsStart, fillMissingUnitsStatus, rebuildRanking,
  stage1Table, stage2Table, stage3Ranked, stage3Coins, stage3CoinRows,
  settingsFor, unitsFor, stage3Declared, countDeclared, shapeCellsFor, blockAxesFor, buildTally, readTally, parseTally, TALLY_V, seedOf, S3_SORTS, deleteSet, childrenOf,
  setSetPicked, pickedOf, unitsChoiceOf, stage3RecordsFor, PICK_CHOICES, PICK_LABELS, stage3UnitsFor,
  setSetNotes, setSetName, nextNames, nextFreeName, nameTaken, setSetSort, setSetFilters, stage2Rows, stage2Ordered, applySort, validateSort, sortLabel, applyFilters, FILTER_DEFS,
  ensureTally, tallyWait, tallyBudgetFor, storeBudgetFor,
  spreadOf, S3_COIN_FILTERS,
  buildAgreedTable, readAgreed, writeAgreed, relaunchShapeOf, appendMissingSettings, missingSettingsOf,
  missingSettingsIn, nextSettingNumber,
  rebuildRichFor, proveRebuild, firstDigitOf, funnelRead, sliceRowsFor, againstTestControls,
  funnelRankHoldRead, funnelRankHoldStart, funnelRankHoldStatus,
  funnelRichStart, funnelRichStatus, cpuLoad, funnelKeeps,
  continueStage3, readCheckpoint, hasCheckpoint, checkpointFile, writeCheckpoint, CHECKPOINT_V,
  windowsOfSet, newestDataOf,
  funnelVerifyDry, funnelVerifyStart, funnelVerifyStatus, verifySummaryOf, sealedOnUnitOf,
  funnelDropped, funnelDroppedStart, droppedRefusalOf,
  stageGateStart, stageGateStatus, examBusy,
  funnelOthersStart, funnelOthersStatus, othersSummaryOf, funnelRideStart, funnelRideStatus, RICH_FIELDS,
  unreadGradeDry, unreadGradeStart, unreadGradeStatus, unreadGateOf, UNREAD_NO_PASS,
  stage4GreenlightSource, stage4GreenlightDry,
  tuneCaptureDry, tuneCaptureStart, tuneCaptureStatus, tuneOnCapture, captureCandidates, captureTargetOf, readCapture, captureFile,
  halfLifeDry, halfLifeStart, halfLifeStatus, readHalfLifeRun, halfLifeFile, layoutOfSet, buildHalfLifeSet, gateOfSet, derivedRefusalOf,
  CAPTURE_WINDOWS, CAPTURE_NONE, CAPTURE_NOT_YET,
  cutFunnelSet, cutFunnelSetStart, cutFunnelSetStatus, richForSurvivors, withOwnRich,
  controlsOf, againstControls, controlKeyOf, CONTROL_KEYS,
  listFunnelSets, saveFunnelRich, readFunnelRich, withFunnelRich, funnelRichFile,
  unitKeyOf, unitNameOf, unitsOfSet, boardRowOf, loadUnitBoard, funnelBoard, funnelAcross, FUNNEL_RICH_V,
  testWindowOfUnit, exposureOf,
  funnelAcrossStart, funnelAcrossStatus, funnelCrossesStart, funnelCrossesStatus, funnelCrosses,
  sealedWindowOf, sealedFromUnits, noiseTwinOf,
  funnelCutsFor, funnelSetRows, rebuildSetRichStart, rebuildSetRichStatus,
  BOARD_NULL_NONE,
  dropUndeclaredSettings, dropSettingsNamed, undeclaredIn,
  tallyRunPromise: () => (tallyRun ? tallyRun.promise : null),
  unfinishedAppend, unfinishedAppendDetail, undoUnfinishedAppend,
  declaredLabelsFor, declaredKeyFor,
  auditRecordSet, auditAgainstBlock,
  // the same pool every heavy job uses, so filling in a block is worked the
  // same way a launch is rather than on the one thread that answers pages
  createPoolForFillIn: () => createPool(),
  RECORDS_V,
};
