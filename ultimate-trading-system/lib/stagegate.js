// stagegate.js -- V0: the stage-engine check (3.87.0,
// VERIFY-DESIGN.md V0 and decision 9; loop record, step 2).
//
// THE QUESTION. Can the engine the owner actually uses -- stage 1, stage 2,
// stage 3, a declared rule cut into a Stage 4 set, and the verdict on Verify
// -- find a rule that is provably there, profit on it on the held-back window,
// beat holding the coin, have its scrambled copies fail to match it, and stay
// quiet on a fair coin? The older sweep path had a check that asked it of that
// path (retired with it, 3.97.0); nothing asked it of this one.
//
// WHAT IS HERE IS THE DECLARATION AND THE GRADING, both pure: the two
// reserved coins, the span, the seeds, the copy count, the rule, the five
// gates, and the reading of two verdict blocks against them. Running the exam
// -- fabricating the coins, launching the stages, cutting the sets, pressing
// the verdicts, deleting what it made -- is lib/stages.js's, because it owns
// every one of those doors. Records live in their own directory, never beside
// the old sweep's, whose newest-first scan would shadow them.
//
// THE COPY COUNT IS CHOSEN BEFORE THE NUMBERS. A fair coin clears a bar of
// `bar` of K copies by chance about (K + 1 - bar) / (K + 1) of the time, so
// no copy count brings an 85% bar under 5%; the exam's bar is ALL of K = 20
// copies, which a fair coin clears about 1 in 21 times (4.8%), and that
// chance is printed beside every verdict.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'stage-gate');
// reserved symbols: never a real run's, never downloaded, only the exam's
const PLANT = 'PLANTEDSTAGEAUSDT';
const FAIR = 'PLANTEDSTAGEBUSDT';
const SYMBOLS = [PLANT, FAIR];
const isExamSymbol = (s) => SYMBOLS.includes(String(s || '').toUpperCase());
// FOUR YEARS OF FABRICATED HISTORY, NOT ONE (owner order, 2026-09-08: "make
// the stage-engine check build four years GO NOW!"). On one year the daily
// shape kept 220 training chunks after the seal and the two slices were cut
// away, and stage 1 could not learn the plant from them: the check FAILED on
// its own starvation, not on the engine (VERIFY-DESIGN.md section 9, step 2).
// On four years -- 888 training chunks -- the same engine passes every gate.
// The months stage 1 is launched on follow this span; a test holds them to it.
const SPAN = Object.freeze({ fromMonth: '2021-01', toDate: '2024-12-31' });
const SEEDS = Object.freeze({ [PLANT]: 424241, [FAIR]: 424242 });
const COPIES = 20;
const chanceOf = (k) => 1 / (k + 1);
// THE RULE, DECLARED BEFORE ANYTHING IS LAUNCHED: the plant is next-day-
// follows-today, and on the daily-1d shape the chunk's own hold -- entry at
// hour 25, exit at hour 42, 17 hours -- is exactly the day the forecast is
// about. A longer hold rides into days the forecast never spoke of, which is
// noise by construction: the first real run of this exam declared 41 to 89
// hours and FAILED on it (loop, 2026-09-08), which is the exam grading its own
// declaration and not the engine. The rule keeps that one hold length across
// both decisions, no cut, so every scrambled copy keeps the same survivors.
const RULE = Object.freeze({ ranges: { tHours: { min: 17, max: 17 } }, allowed: {}, floors: {} });
// the launches, declared: the same shapes the hand-run exam uses
const STAGE1 = Object.freeze({
  universe: SYMBOLS, sizes: { singles: true }, geometry: 'daily-1d',
  windowLayout: 'reserve61', allLoaded: false, startMonth: SPAN.fromMonth, endMonth: SPAN.toDate.slice(0, 7),
  nullN: 9, fee: 0.00125, trainOn: 'direction', desc: 'stage-engine check',
});
const STAGE2 = Object.freeze({ carry: 0, desc: 'stage-engine check' });
const STAGE3 = Object.freeze({
  fee: 0.00125, nullN: COPIES, keepN: COPIES, desc: 'stage-engine check',
  decision: 'argmax', band: 'auto', weekdaysOnly: false, permuteDecision: true,
  cell: { entry: 'market', gate: 'directional', tHours: 17 },
  cellPermute: { tHours: true },
  agreeRule: 'count', agreePct: 50,
});
const GATES = Object.freeze({
  G1: "the planted coin's rule makes held-back money [DERIVED: a 70%-follow rule pays in every era]",
  G2: 'it beats buying the coin and going away [DERIVED: the fabricated coin has zero drift, so holding earns nothing but fees]',
  G3: `it beats every one of its ${COPIES} scrambled copies on the held-back window [direction DERIVED: dealt forecasts cannot carry the plant; the bar of all ${COPIES} chosen so a fair coin clears it about 1 in ${COPIES + 1} times]`,
  G4: "the fair coin's rule does NOT clear that same bar [DERIVED: there is nothing there to find]",
  G5: 'no unit failed and every survivor carries every copy [DERIVED: a calibration with missing pieces proves nothing]',
});

// ---- the grading, pure -----------------------------------------------------------
// planted / fair: the verdict blocks stamped on the two Stage 4 sets;
// s3: the stage 3 set's document (its failures list).
function grade({ planted, fair, s3, copies = COPIES, stage1 = null, reference = null }) {
  const money = (v) => (v == null ? 'no figure' : `${Number(v) < 0 ? '-' : ''}$${Math.abs(Number(v)).toFixed(2)}`);
  const p = planted || {};
  const f = fair || {};
  const ph = p.heldBack || {};
  const pc = p.copies || {};
  const fc = f.copies || {};
  const checks = [];
  const sentences = [];
  const g1 = ph.positive === true;
  checks.push({ rule: 'G1', text: GATES.G1, pass: g1 });
  sentences.push(`${g1 ? 'ok  ' : 'FAIL'} G1: the planted coin's ${ph.of ?? 0} survivors made ${money(ph.real)} a setting on the held-back window`);
  const comp = ph.comparisons || {};
  const g2 = comp.known === true && comp.beatsBuyHold === true;
  checks.push({ rule: 'G2', text: GATES.G2, pass: g2 });
  sentences.push(comp.known
    ? `${g2 ? 'ok  ' : 'FAIL'} G2: buying the coin and going away made ${money((comp.buyHold || {}).hi)}, ${g2 ? 'beaten' : 'not beaten'}`
    : 'FAIL G2: the four comparisons are not known on the planted coin, and unknown never passes');
  const g3 = pc.pass === true && pc.copies === copies && pc.bar === copies;
  checks.push({ rule: 'G3', text: GATES.G3, pass: g3 });
  sentences.push(`${g3 ? 'ok  ' : 'FAIL'} G3: the planted coin's rule beats ${pc.beats ?? 0} of ${pc.copies ?? 0} scrambled copies, the bar being all ${copies} (a fair coin clears that about 1 in ${copies + 1} times)`);
  const g4 = fc.pass === false && fc.copies === copies;
  checks.push({ rule: 'G4', text: GATES.G4, pass: g4 });
  sentences.push(`${g4 ? 'ok  ' : 'FAIL'} G4: the fair coin's rule beats ${fc.beats ?? 0} of ${fc.copies ?? 0} copies${fc.pass === true ? ' and CLEARS the bar: the instrument invents things' : ''}`);
  const failures = ((s3 || {}).failures || []).length;
  const rowsP = ((p.survivors || {}).rows) || [];
  const rowsF = ((f.survivors || {}).rows) || [];
  const wholeP = rowsP.length > 0 && rowsP.every((r) => r.copiesKept === copies);
  const wholeF = rowsF.length > 0 && rowsF.every((r) => r.copiesKept === copies);
  const g5 = failures === 0 && wholeP && wholeF;
  checks.push({ rule: 'G5', text: GATES.G5, pass: g5 });
  sentences.push(`${g5 ? 'ok  ' : 'FAIL'} G5: ${failures} unit failure(s); ${rowsP.length} planted and ${rowsF.length} fair survivors, ${wholeP && wholeF ? 'every one carrying every copy' : 'NOT every one carrying every copy'}`);
  const pass = checks.every((c) => c.pass);
  // FOR SCALE, never a gate: what stage 1's own members saw on each coin, and
  // what a trader who simply follows the plant's label makes on the same
  // windows through the same simulator -- so a FAIL says how far short the
  // engine fell, not only that it did.
  if (stage1 && stage1.planted) {
    const p1 = stage1.planted; const f1 = stage1.fair || {};
    sentences.push(`info stage 1 saw the planted coin at forecast score ${p1.score == null ? '?' : Number(p1.score).toFixed(2)}, beating ${p1.beat ?? '?'} of ${p1.pairs ?? '?'} of its null set, ${money(p1.money)} on its tuning slice; the fair coin scored ${f1.score == null ? '?' : Number(f1.score).toFixed(2)}, beating ${f1.beat ?? '?'} of ${f1.pairs ?? '?'}`);
  }
  if (reference && reference.planted) {
    const r = reference.planted;
    sentences.push(`info a trader who simply follows the plant's label, through the same simulator at the same hold and fee, makes ${money((r.test || {}).pnl)} on the test window (${(r.test || {}).trades ?? '?'} trades) and ${money((r.hold || {}).pnl)} on the held-back window (${(r.hold || {}).trades ?? '?'} trades)`);
  }
  return { pass, checks, sentences, chance: chanceOf(copies), copies, bar: copies };
}

// ---- the records, one per run, in their own directory ------------------------------
function recordFile(id) { return path.join(DIR, `${String(id).replace(/[^A-Za-z0-9._-]+/g, '_')}.json`); }
function writeRecord(rec) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${recordFile(rec.id)}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(rec));
  fs.renameSync(tmp, recordFile(rec.id));
  return rec;
}
function readRecords(dir = DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (r && r.id) out.push(r);
    } catch (_) {
      // a torn record is reported, never skipped into silence: an older PASS must not shadow it
      out.push({ id: f.replace(/\.json$/, ''), unreadable: true, at: f });
    }
  }
  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return out;
}
// PASS belongs to the exact release that earned it; any other release reads NOT CHECKED
function status(release, { running = null, dir = DIR } = {}) {
  const records = readRecords(dir);
  const last = records[0] || null;
  let state = 'NOT CHECKED';
  if (running) state = 'RUNNING';
  else if (last && last.unreadable) state = 'UNREADABLE';
  else if (last && last.release === release) state = last.pass ? 'PASS' : 'FAIL';
  return {
    state, release, running: running || null,
    last: last ? { id: last.id, at: last.at, release: last.release, pass: !!last.pass, sentences: last.sentences || [], chance: last.chance ?? null, copies: last.copies ?? null, unreadable: !!last.unreadable, elapsedMs: last.elapsedMs ?? null } : null,
    detail: state === 'PASS' ? `the stage engine at ${release} found the plant, profited, beat holding, and its copies could not match it; the fair coin stayed quiet`
      : state === 'FAIL' ? `the stage engine at ${release} did not pass its own check — read the sentences before trusting any record set it priced`
        : state === 'RUNNING' ? 'the stage-engine check is running'
          : last && !last.unreadable ? `the last check was under release ${last.release}; this release has not been checked`
            : 'no stage-engine check has been run on this box',
    records: records.length,
  };
}

module.exports = {
  DIR, PLANT, FAIR, SYMBOLS, isExamSymbol, SPAN, SEEDS, COPIES, chanceOf, RULE, STAGE1, STAGE2, STAGE3, GATES,
  grade, writeRecord, readRecords, status, recordFile,
};
