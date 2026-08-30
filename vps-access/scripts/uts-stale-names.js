// uts-stale-names.js -- READ-ONLY. Which of the held setting names would the
// code running today NOT write, and why?
//
// Rebuilds each setting's name from the fields its own records carry and
// compares it with the name stored beside them. Streams the record store one
// block at a time and keeps only one entry per setting, so it never holds the
// whole block enumeration. Opens nothing for writing.
const fs = require('fs');
const path = require('path');
// ABSOLUTE, because this file is copied to /tmp before it runs and require()
// resolves against the FILE, not the working directory.
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const stagework = require(`${APP}/lib/stagework`);

const src = fs.readFileSync(`${APP}/lib/stages.js`, 'utf8');
const cut = (name) => {
  const i = src.indexOf(`function ${name}(`);
  return src.slice(i, src.indexOf('\n}\n', i) + 3);
};
// the two writers, taken out of the shipped file so this cannot drift from it
// eslint-disable-next-line no-eval
const shapeLabel = eval(`${cut('shapeLabel')}; shapeLabel`);
// eslint-disable-next-line no-eval
const agreeLabel = eval(`${cut('agreeLabel')}; agreeLabel`);

const dir = `${APP}/data/stagesets`;
for (const f of fs.readdirSync(dir).filter((x) => /^s3-.*\.json$/.test(x))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const held = ((doc.plan || {}).settingLabels) || [];
  console.log('==', doc.id, held.length, 'held setting names');
  const heldSet = new Set(held);

  const meta = rowstore.blocksOf(doc.id, 'records');
  const nBlocks = Array.isArray(meta) ? meta.length : 0;
  console.log('   reading', nBlocks, 'blocks, one at a time');

  const bySi = new Map();
  for (let b = 0; b < nBlocks; b++) {
    const rows = rowstore.readBlocks(doc.id, 'records', [b]) || [];
    for (const x of rows) {
      const r = x.row || x;
      if (bySi.has(r.si)) continue;
      bySi.set(r.si, {
        si: r.si, label: r.label, entry: r.entry, gate: r.gate, dMult: r.dMult,
        tHours: r.tHours, trailMult: r.trailMult, armMult: r.armMult,
        decision: r.decision, bandMode: r.bandMode, weekdaysOnly: r.weekdaysOnly,
        agreeRule: r.agreeRule, agreeBar: r.agreeBar, agreePct: r.agreePct,
        agreeCopy: r.agreeCopy, agreeBoth: r.agreeBoth, agreePersist: r.agreePersist,
      });
    }
  }
  console.log('   distinct settings in the records:', bySi.size);

  let same = 0;
  const diffs = new Map();
  const note = (kind, was, now) => {
    if (!diffs.has(kind)) diffs.set(kind, { n: 0, samples: [] });
    const d = diffs.get(kind);
    d.n++;
    if (d.samples.length < 3) d.samples.push(`was: ${was}\n            now: ${now}`);
  };
  for (const r of bySi.values()) {
    const agr = stagework.agrOf(r);
    const rebuilt = `${agreeLabel({
      rule: agr.rule, pct: agr.pct, bar: agr.bar, copy: agr.copy,
      bothModels: agr.both, persist: agr.persist,
    })} ${shapeLabel(r)}`;
    const storedHead = String(r.label || '').split(' · ')[0];
    if (rebuilt === storedHead) { same++; continue; }
    let kind = 'something else';
    if (rebuilt.replace(/ \+voice\d+/, '') === storedHead) kind = 'gained +voiceN (the one-voice threshold went into the name)';
    else if (rebuilt.replace(/ own/, '') === storedHead) kind = 'gained own (the bar went into the name)';
    else if (storedHead.replace(/ \+voice\d+/, '') === rebuilt) kind = 'lost +voiceN';
    else if (rebuilt.split(' ')[0] !== storedHead.split(' ')[0]) kind = 'the way of weighing is named differently';
    note(kind, storedHead, rebuilt);
  }
  console.log('   names the code writes the same way now:', same);
  console.log('   names it would write differently:', bySi.size - same);
  for (const [kind, d] of [...diffs].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`     ${d.n}  ${kind}`);
    for (const s of d.samples) console.log(`            ${s}`);
  }

  let notHeld = 0;
  const missingSamples = [];
  for (const r of bySi.values()) {
    if (!heldSet.has(r.label)) { notHeld++; if (missingSamples.length < 5) missingSamples.push(r.label); }
  }
  console.log('   records whose full name is not in the held list:', notHeld);
  for (const s of missingSamples) console.log('            ', s);

  // and the other way: held names with no record behind them
  const recNames = new Set([...bySi.values()].map((r) => r.label));
  const orphan = held.filter((L) => !recNames.has(L));
  console.log('   held names with no record behind them:', orphan.length);
  for (const s of orphan.slice(0, 5)) console.log('            ', s);
}
