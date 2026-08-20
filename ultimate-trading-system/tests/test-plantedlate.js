// The late-rule exam pair (DESIGN-HT2.md): same construction as the planted
// check's pair, except the day-follows-day rule is SILENT for the first
// two-thirds of the span. These tests pin the properties the HT v2 exams
// lean on: determinism, the rule boundary actually existing in the candles,
// and the stationary pair remaining byte-identical to its pre-refactor self.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assert } = require('./helpers');
const planted = require('../lib/planted');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const SPAN = { fromMonth: '2020-01', toDate: '2020-06-15' };

function filesOf(sym) {
  return fs.readdirSync(CACHE).filter((f) => f.startsWith(`${sym}-1h-`)).sort();
}
function digestOf(sym) {
  const h = crypto.createHash('sha256');
  for (const f of filesOf(sym)) { h.update(f); h.update(fs.readFileSync(path.join(CACHE, f))); }
  return h.digest('hex');
}
function cleanup() {
  for (const f of fs.readdirSync(CACHE)) {
    if (f.startsWith('PLANTEDUSDT-1h-') || f.startsWith('PLANTEDLATEUSDT-1h-')) {
      fs.rmSync(path.join(CACHE, f), { force: true });
    }
  }
}
// Daily trend/outcome series recovered from the candles: outcome sign =
// sign(hour-18 close vs day open) is noisy through the bridges, so read the
// generator's own semantic — outcome = price at hour 17 close relative to
// open — and pair it with the PREVIOUS day's trend (close vs open).
function followShare(sym, fromDay, toDay) {
  const rows = [];
  for (const f of filesOf(sym)) rows.push(...JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')));
  rows.sort((a, b) => a.ts - b.ts);
  const days = [];
  for (let i = 0; i + 24 <= rows.length; i += 24) {
    const open = rows[i].open;
    // The planted outcome is the hour-18 price, which the generator places
    // at closes[17] — the close of the hour-16 ROW (rows[h].close =
    // closes[h+1]). One row later is already a bridge step toward the day's
    // own trend close and leaks trend into the outcome reading.
    const out18 = rows[i + 16].close;
    const close24 = rows[i + 23].close;
    days.push({ trend: Math.sign(close24 - open), outcome: Math.sign(out18 - open) });
  }
  let follow = 0;
  let n = 0;
  for (let d = Math.max(1, fromDay); d < Math.min(days.length, toDay); d++) {
    if (!days[d].outcome || !days[d - 1].trend) continue;
    n++;
    if (days[d].outcome === days[d - 1].trend) follow++;
  }
  return { share: follow / n, n };
}

module.exports = {
  async stationaryPairIsByteIdenticalToThePreRefactorGenerator() {
    try {
      planted.generatePlanted(SPAN);
      assert.strictEqual(digestOf('PLANTEDUSDT'),
        'bae189a41159defa3517f63dc2f2edd8783e89764ddc93b710fc884bfdc50433',
        'the refactor must not change one byte of the stationary pair');
    } finally { cleanup(); }
  },

  async latePairIsDeterministicAndCarriesTheRuleOnlyLate() {
    try {
      // A STATISTICALLY ADEQUATE span. On 110 rule-off days a fair coin
      // lands 60% about one time in fifty (this seed did exactly that on a
      // 167-day span — verified against the generator's own rng replay), so
      // small spans cannot test the construction. Three years gives ~730
      // rule-off days (sd ~1.9%) and ~365 rule-on days (sd ~2.4%).
      const span3y = { fromMonth: '2019-01', toDate: '2021-12-31' };
      const a = planted.generatePlantedLate(span3y);
      const d1 = digestOf('PLANTEDLATEUSDT');
      planted.generatePlantedLate(span3y);
      assert.strictEqual(digestOf('PLANTEDLATEUSDT'), d1, 'same span must give the same bytes');
      assert.ok(a.ruleOnDay > 0, 'the rule boundary must exist');
      const before = followShare('PLANTEDLATEUSDT', 0, a.ruleOnDay);
      const after = followShare('PLANTEDLATEUSDT', a.ruleOnDay, 100000);
      assert.ok(after.share > 0.64, `rule-on era must follow ~70% (got ${(100 * after.share).toFixed(1)}% over ${after.n} days)`);
      assert.ok(before.share < 0.56, `rule-off era must sit near a coin flip (got ${(100 * before.share).toFixed(1)}% over ${before.n} days)`);
      assert.ok(after.share - before.share > 0.1, 'the eras must be separated by the plant');
    } finally { cleanup(); }
  },

  async bothReservedPairsAreRefusedEverywhere() {
    const batch = require('../lib/batch');
    for (const sym of planted.PLANTED_SYMBOLS) {
      assert.throws(
        () => batch.startBracketLab({ universe: [sym], sizes: { singles: true }, windowLayout: 'split70' }),
        /reserved fabricated pair/,
        `bracket lab must refuse ${sym}`,
      );
    }
  },
};
