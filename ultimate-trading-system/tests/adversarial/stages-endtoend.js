#!/usr/bin/env node
// THE THREE STAGES, END TO END, ON FABRICATED COINS WITH A KNOWN ANSWER —
// the adversarial half of the stage build's review (owner order, 2026-08-27:
// "write it. adversarial review. deploy").
//
// Two coins are fabricated with the planted-check's own generator: one with
// the plant alive the whole span (tomorrow follows today, 70%), one with the
// rule never on (a fair coin all the way). Stage 1 must rank the planted one
// first with a strong against-null-set result; the coin-flip one must sit
// near the middle of its own null set. Then stage 2 carries both, stage 3
// prices a small block, and every read path is exercised. A miss on the
// planted coin means the instrument is blind; a strong result on the fair
// coin means it invents things — either way nothing else about the stages
// would be worth trusting.
//
// Run it by hand (it trains for real, ~a minute):
//   node tests/adversarial/stages-endtoend.js
//
// It fabricates ZZZE2E* cache files and removes them, and every record set
// it writes, before it exits.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');
const { generateFabricated } = require('../../lib/planted');
const stages = require('../../lib/stages');
const rowstore = require('../../lib/rowstore');

const A = 'ZZZE2EAUSDT';   // the plant, alive the whole span
const B = 'ZZZE2EBUSDT';   // a fair coin, rule never on
const SPAN = { fromMonth: '2024-01', toDate: '2024-12-31' };

const made = [];
// The exam sets a campaign of its own to prove the stamp rides a real launch
// (owner GO, 2026-08-27), so the box's campaign file is restored verbatim —
// name, declared list and all — whatever happens.
const campaign = require('../../lib/campaign');
const CAMP_FILE = path.join(ROOT, 'data', 'campaign.json');
const priorCampFile = fs.existsSync(CAMP_FILE) ? fs.readFileSync(CAMP_FILE, 'utf8') : null;
const EXAM_CAMP = 'ZZZ E2E exam';
function cleanup() {
  try {
    if (priorCampFile === null) fs.rmSync(CAMP_FILE, { force: true });
    else fs.writeFileSync(CAMP_FILE, priorCampFile);
  } catch (_) { /* best effort */ }
  for (const f of fs.readdirSync(CACHE)) {
    if (f.startsWith(`${A}-1h-`) || f.startsWith(`${B}-1h-`)) {
      try { fs.unlinkSync(path.join(CACHE, f)); } catch (_) { /* best effort */ }
    }
  }
  for (const id of made) {
    try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* best effort */ }
    try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* best effort */ }
    try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

async function waitDone(id, label) {
  const t0 = Date.now();
  for (;;) {
    const doc = stages.getSet(id);
    if (doc && doc.status !== 'running') return doc;
    if (Date.now() - t0 > 15 * 60 * 1000) throw new Error(`${label} did not finish in 15 minutes`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

(async () => {
  console.log('fabricating the two coins...');
  generateFabricated(SPAN, A, 424241, 0);   // plant on from day 0
  generateFabricated(SPAN, B, 424242, 1);   // rule never on — a fair coin

  // daily-1d, the plant's own shape (lib/planted.js gateParams uses the
  // same): the plant is next-day-follows-today, and a four-day outcome
  // window straddles two half-independent plant days — members flatten to
  // the prior, every deal ties the real arm, and strict-beat honestly reads
  // "nothing here" for both coins. The exam must give the instrument a
  // signal it is calibrated to see, exactly as the planted gate does.
  const p = {
    universe: [A, B], sizes: { singles: true }, geometry: 'daily-1d',
    windowLayout: 'split70', allLoaded: false, startMonth: '2024-01', endMonth: '2024-12',
    nullN: 9, desc: 'adversarial end-to-end',
  };
  campaign.setCampaign(EXAM_CAMP);
  console.log('stage 1...');
  const s1 = stages.startStage1(p);
  made.push(s1.id);
  const d1 = await waitDone(s1.id, 'stage 1');
  assert.strictEqual(d1.status, 'done', `stage 1 ended ${d1.status}: ${JSON.stringify(d1.failures)}`);
  assert.strictEqual(d1.params.campaign, EXAM_CAMP, 'a real stage 1 launch must stamp the campaign in use');

  const ranking = rowstore.readAll(s1.id, 'records');
  const a = ranking.find((r) => r.trade === A);
  const b = ranking.find((r) => r.trade === B);
  console.log(`  ${A}: score ${a.score.toFixed(2)}, beat ${a.beat}/${a.pairs}, lead ${a.lead && a.lead.toFixed(2)}`);
  console.log(`  ${B}: score ${b.score.toFixed(2)}, beat ${b.beat}/${b.pairs}, lead ${b.lead && b.lead.toFixed(2)}`);
  assert.strictEqual(a.pairs, 9);
  assert.ok(a.beat >= 8, `the planted coin must beat nearly all of its null set — beat ${a.beat}/9 means the instrument is blind`);
  assert.ok(a.score > b.score, 'the planted coin must out-forecast the fair coin outright');
  assert.ok(b.beat <= 7, `the fair coin must not dominate its null set — beat ${b.beat}/9 means the instrument invents things`);
  const table1 = stages.stage1Table(s1.id, 0, 10);
  assert.strictEqual(table1.rows[0].trade, A, 'the ranking must put the planted coin first');
  assert.ok(table1.rows[0].lead >= table1.rows[1].lead - 1e-9, 'rank 1 cannot trail rank 2 on the tie-break');

  console.log('stage 2...');
  const s2 = stages.startStage2({ from: s1.id, orderBy: 'beat', carry: 0, desc: 'adversarial end-to-end' });
  made.push(s2.id);
  const d2 = await waitDone(s2.id, 'stage 2');
  assert.strictEqual(d2.status, 'done', `stage 2 ended ${d2.status}: ${JSON.stringify(d2.failures)}`);
  const recs2 = rowstore.readAll(s2.id, 'records');
  assert.strictEqual(recs2.length, 2);
  for (const r of recs2) {
    assert.strictEqual(r.specs.length, 6, 'a carried single holds 6 members after stage 2');
    assert.strictEqual(r.specs.filter((x) => x.model === 'logreg').length, 3);
    assert.strictEqual(r.specs.filter((x) => x.model === 'boost').length, 3);
    assert.ok(Number.isFinite(r.scoreAll) && Number.isFinite(r.score3), 'both forecast scores recorded');
  }
  const carriedA = recs2.find((r) => r.trade === A);
  assert.strictEqual(carriedA.carriedRank, 1, 'the carry keeps the stage 1 order');

  console.log('stage 3...');
  const s3 = stages.startStage3({
    from: s2.id, fee: 0.00125, nullN: 9, desc: 'adversarial end-to-end',
    decision: 'argmax', band: 'auto', weekdaysOnly: false, permuteDecision: true,
    cell: { entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65, quorumSingles: 2, quorumContexts: 3 },
    cellPermute: { tHours: true },
  });
  made.push(s3.id);
  assert.strictEqual(s3.settings, 14, 'seven holding times × two decisions');
  const d3 = await waitDone(s3.id, 'stage 3');
  assert.strictEqual(d3.status, 'done', `stage 3 ended ${d3.status}: ${JSON.stringify(d3.failures)}`);
  assert.strictEqual(rowstore.count(s3.id, 'records'), 14 * 2, 'one record per setting per unit');

  const ranked = stages.stage3Ranked(s3.id, 0, 50);
  assert.strictEqual(ranked.total, 14);
  for (const r of ranked.rows) {
    assert.strictEqual(r.coins, 2);
    assert.ok(r.coinsInMoney >= 0 && r.coinsInMoney <= 2);
    assert.strictEqual(r.pairs, 2 * 9, 'every setting read against the same nine deals per coin');
  }
  const coins = stages.stage3Coins(s3.id, { sort: 'share', limit: 50 });
  assert.strictEqual(coins.total, 14, 'seven cells × two coins — the decision variants group UNDER each row');
  const rowA = coins.rows.find((r) => r.trade === A && / t65h/.test(r.cellLabel));
  assert.ok(rowA, 'the t65h cell must have a coin row for the planted coin');
  assert.strictEqual(rowA.rows, 2, 'the two decision variants are the records under the row');
  const detail = stages.stage3CoinRows(s3.id, {
    cellLabel: rowA.cellLabel, trade: A, ctx1: '', ctx2: '', geometry: 'daily-1d',
  });
  assert.strictEqual(detail.shown, 2);
  assert.ok(detail.rows.every((r) => r.holdout && Number.isFinite(r.holdout.pnl)), 'every record priced the held-back window');
  assert.ok(detail.rows.every((r) => r.pairs === 9), 'every record read against its null set');
  const decisions = new Set(detail.rows.map((r) => r.decision));
  assert.deepStrictEqual([...decisions].sort(), ['argmax', 'directional'], 'both decisions priced from the same kept votes');

  const chain = stages.chainOf(s3.id);
  assert.deepStrictEqual(chain.map((c) => c.stage), [1, 2, 3], 'the chain walks back to stage 1');

  // the campaign rode all three launches, and the tree reads the whole chain
  const tr = campaign.campaignTree(EXAM_CAMP);
  for (const [id, kind] of [[s1.id, 'stage 1'], [s2.id, 'stage 2'], [s3.id, 'stage 3']]) {
    const row = tr.runs.find((r) => r.id === id);
    assert.ok(row, `the campaign tree must hold ${id}`);
    assert.strictEqual(row.kind, kind);
  }
  assert.strictEqual(tr.runs.find((r) => r.id === s3.id).parentRunId, s2.id, 'the tree links each set to the parent it read');

  console.log('\nEND-TO-END OK: the planted coin outranks the fair coin, the chain holds, every read path answers.');
})().then(() => { cleanup(); process.exit(0); }).catch((err) => {
  console.error('\nEND-TO-END FAILED:', err.message);
  cleanup();
  process.exit(1);
});
