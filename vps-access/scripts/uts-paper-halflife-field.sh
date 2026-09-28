#!/usr/bin/env bash
# uts-paper-halflife-field.sh -- READ-ONLY. For every paper, live or stopped
# book: (1) the training weights its members retrain with, worked out exactly as
# a decision works them out (lib/live/signal.js prepare -> the book's own split
# -> lib/live/stagesignal.js trainingWeightsFor), beside the same weights with
# no half-life, so the half-life's share is plain; and (2) the coin history
# field each recent decision recorded, then the field rebuilt now from the
# candles and read at the latest decision's own instant, compared value for
# value. Trains no member, writes nothing, sends nothing; no keys.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
timeout 900 node - <<'JS'
const reg = require('./lib/live/setups');
const signal = require('./lib/live/signal');
const ss = require('./lib/live/stagesignal');
const sw = require('./lib/stagework');
const H = require('./lib/halflife');
const { splitAndLabelBook } = require('./lib/bracketwork');
const mirror = require('./lib/live/mirror');
const fieldlive = require('./lib/fieldlive');
const iso = (t) => (t == null ? '-' : new Date(t).toISOString().slice(0, 10));
const r3 = (x) => (x == null || !Number.isFinite(x) ? String(x) : Number(x).toPrecision(4));
(async () => {
  for (const s of reg.listSetups().filter((x) => ['paper', 'live', 'stopped'].includes(x.state))) {
    console.log(`\n## ${s.name} (${s.id}) | ${s.state} | members train ${JSON.stringify(s.trainPolicy)}`);
    const prep = await signal.prepare(s);
    const cfg = prep.cfg;
    const training = cfg.training || {};
    // (1) THE HALF-LIFE: the periods a decision trains on, and the weights it gives them
    const bands = (cfg.extras || []).map((e) => e.bandPct);
    const split = splitAndLabelBook(prep.trainChunks, { ...cfg.branch, band: 'auto' }, ss.readsTestStretch(cfg), bands);
    const tc = split.trainChunks;
    const w = ss.trainingWeightsFor(training, tc, prep.fee);
    const plain = sw.weightsFor(training, tc, prep.fee);
    const hl = Number(training.halfLife);
    console.log(`   half-life on record: ${training.halfLife} days (${training.halfLifeMonths} months) | trains by ${training.trainOn} | fee ${prep.fee}`);
    console.log(`   training periods: ${tc.length}, ${iso(tc[0] && tc[0].startTs)} to ${iso(tc.length && tc[tc.length - 1].startTs)}`);
    if (Number.isFinite(hl) && hl > 0 && tc.length) {
      const endTs = tc[tc.length - 1].startTs;
      const age = H.ageWeights(tc.map((c) => ({ endTs: c.startTs })), endTs, hl);
      const at = (daysBack) => { let best = 0; for (let i = 0; i < tc.length; i++) if (Math.abs((endTs - tc[i].startTs) / 86400e3 - daysBack) < Math.abs((endTs - tc[best].startTs) / 86400e3 - daysBack)) best = i; return best; };
      for (const d of [0, hl, 2 * hl, (endTs - tc[0].startTs) / 86400e3]) {
        const i = at(d);
        const share = plain ? w[i] / plain[i] : w[i];
        console.log(`   ${iso(tc[i].startTs)} (${Math.round((endTs - tc[i].startTs) / 86400e3)} days back): age weight ${r3(age.weights[i])} | trained with ${r3(w[i])} vs ${plain ? r3(plain[i]) : 'no base weight'} without the half-life (x${r3(share)})`);
      }
      console.log(`   effective days of history: ${r3(age.effectiveDays)} of ${Math.round((endTs - tc[0].startTs) / 86400e3)}`);
    } else console.log('   no half-life on record: every period trains at the set\'s own weight');
    // (2) THE FIELD: what each recent decision recorded, and the field rebuilt now at the latest one
    const f = cfg.field || null;
    console.log(`   field on record: ${f ? `${f.id} | gate ${JSON.stringify(f.gate)}` : 'none'}`);
    if (f) console.log(`   field dials: ${JSON.stringify(f.dials)}`);
    const decs = mirror.loadDecisions(s.id).slice(-4);
    for (const d of decs) {
      console.log(`   decision ${d.chunk_start} | ${d.side} | why ${(d.engine || {}).why} | votes ${JSON.stringify(d.per_member)} | made ${d.produced_utc}`);
      console.log(`      field recorded: ${JSON.stringify(d.field)}`);
    }
    const last = decs[decs.length - 1];
    if (f && f.gate && last) {
      const call = (last.field && last.field.why === 'no call') ? 0 : (last.side === 'LONG' ? 1 : last.side === 'SHORT' ? -1 : 0);
      const got = fieldlive.fieldAtDecision(prep.maps.trade, cfg.branch.geometry, f.dials, f.gate, Date.parse(last.chunk_start), call, `${cfg.combo.trade}|${cfg.branch.geometry}`);
      const now = { day: got.day == null ? null : new Date(got.day).toISOString(), sign: got.sign, agreement: got.agreement == null ? null : Number(got.agreement.toFixed(2)), certainty: got.certainty == null ? null : Number(got.certainty.toFixed(2)), speaking: got.speaking, full: got.full, size: got.size, why: got.why, lastDay: got.lastDay == null ? null : new Date(got.lastDay).toISOString() };
      console.log(`      field rebuilt now at that decision: ${JSON.stringify(now)}`);
      const rec = last.field || {};
      const same = ['day', 'sign', 'agreement', 'certainty', 'speaking', 'full', 'size', 'why'].every((k) => JSON.stringify(rec[k] ?? null) === JSON.stringify(now[k] ?? null));
      console.log(`      recorded and rebuilt ${same ? 'AGREE on every value' : 'DIFFER'}`);
      for (const c of [1, -1]) {
        const g2 = fieldlive.fieldAtDecision(prep.maps.trade, cfg.branch.geometry, f.dials, f.gate, Date.parse(last.chunk_start), c, `${cfg.combo.trade}|${cfg.branch.geometry}`);
        console.log(`      had the members called ${c === 1 ? 'LONG' : 'SHORT'}: size ${g2.size} | ${g2.why}`);
      }
    }
  }
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
JS
echo "exit $?"
