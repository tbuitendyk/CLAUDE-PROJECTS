// uts-state-of-the-data.js -- READ-ONLY. Everything about where this set
// actually stands, read off disk rather than inferred. Writes nothing.
const fs = require('fs');
const path = require('path');
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);

const dir = `${APP}/data/stagesets`;
for (const f of fs.readdirSync(dir).filter((x) => /^s3-.*\.json$/.test(x))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const held = ((doc.plan || {}).settingLabels) || [];
  console.log('==', doc.id, '-', doc.name);
  console.log('   recordsVersion', doc.recordsVersion, ' status', doc.status);
  console.log('   plan.settings  ', (doc.plan || {}).settings, ' names held', held.length);
  console.log('   plan.units     ', (doc.plan || {}).units);
  console.log('   appends        ', JSON.stringify(doc.appends));
  console.log('   drops          ', JSON.stringify(doc.drops));
  console.log('   counts         ', JSON.stringify(doc.counts));

  // what is on disk in the store directory, spares included
  const sdir = rowstore.storeDir(doc.id);
  console.log('   -- the store directory --');
  for (const n of fs.existsSync(sdir) ? fs.readdirSync(sdir) : []) {
    const st = fs.statSync(path.join(sdir, n));
    console.log(`      ${String(st.size).padStart(12)}  ${n}  ${st.mtime.toISOString()}`);
  }

  const rows = rowstore.count(doc.id, 'records');
  const blocks = rowstore.blocksOf(doc.id, 'records') || [];
  console.log('   records on disk', rows, ' in', blocks.length, 'blocks');

  // THE ONE THING THAT DECIDES WHETHER THIS SET CAN BE ADDED TO: do the
  // positions the records use line up with the list of names?
  let maxSi = -1;
  let beyond = 0;
  let mismatched = 0;
  const seenSi = new Set();
  const firstBad = [];
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(doc.id, 'records', [b]) || []) {
      const r = x.row || x;
      if (r.si > maxSi) maxSi = r.si;
      seenSi.add(r.si);
      if (r.si >= held.length) { beyond++; if (firstBad.length < 3) firstBad.push(`si ${r.si} "${r.label}"`); continue; }
      if (held[r.si] !== r.label) {
        mismatched++;
        if (firstBad.length < 3) firstBad.push(`si ${r.si} says "${r.label}", the list says "${held[r.si]}"`);
      }
    }
  }
  console.log('   highest position used', maxSi, ' distinct positions', seenSi.size);
  console.log('   records past the end of the name list:', beyond);
  console.log('   records whose position names a different setting:', mismatched);
  for (const s of firstBad) console.log('        ', s);
  let gaps = 0;
  for (let i = 0; i < held.length; i++) if (!seenSi.has(i)) gaps++;
  console.log('   names with no record behind them:', gaps);

  // how many names still read as behind, and how many carry the share
  const behind = held.filter((L) => /^voices \d+%/.test(L) && !/ \+voice\d+/.test(L)).length;
  const withShare = held.filter((L) => / \+voice\d+/.test(L)).length;
  console.log('   names still behind:', behind, ' names carrying the share:', withShare);

  // the derived files
  for (const n of [`${doc.id}-tally.json.gz`, `${doc.id}-agreed.json.gz`]) {
    const p = path.join(dir, n);
    console.log('   ', n, fs.existsSync(p) ? `${fs.statSync(p).size} bytes  ${fs.statSync(p).mtime.toISOString()}` : '(not there)');
  }
}
