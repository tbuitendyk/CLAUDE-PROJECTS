// uts-field-split.js -- READ-ONLY. The audit says 12 records carry 32 fields
// and 5,260,908 carry 33. WHICH field, and WHERE. Reads; changes nothing.
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const fs = require('fs');
const path = require('path');

const dir = `${APP}/data/stagesets`;
for (const f of fs.readdirSync(dir).filter((x) => /^s3-.*\.json$/.test(x))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  console.log('==', doc.id);
  const blocks = rowstore.blocksOf(doc.id, 'records') || [];
  const shapes = new Map();          // sorted key list -> { n, firstSi, lastSi, blocks:Set }
  for (let b = 0; b < blocks.length; b++) {
    for (const x of rowstore.readBlocks(doc.id, 'records', [b]) || []) {
      const r = x.row || x;
      const k = Object.keys(r).sort().join(',');
      let e = shapes.get(k);
      if (!e) { e = { n: 0, firstSi: r.si, lastSi: r.si, firstBlock: b, lastBlock: b }; shapes.set(k, e); }
      e.n++;
      e.lastSi = r.si;
      e.lastBlock = b;
    }
  }
  console.log('  ', shapes.size, 'different field lists');
  const all = [...shapes].sort((a, b) => b[1].n - a[1].n);
  const keySets = all.map(([k]) => new Set(k.split(',')));
  for (let i = 0; i < all.length; i++) {
    const [k, e] = all[i];
    const keys = k.split(',');
    console.log(`   ${String(e.n).padStart(10)} records, ${keys.length} fields, positions ${e.firstSi}..${e.lastSi}, blocks ${e.firstBlock}..${e.lastBlock}`);
    if (i > 0) {
      const base = keySets[0];
      const mine = keySets[i];
      const missing = [...base].filter((x) => !mine.has(x));
      const extra = [...mine].filter((x) => !base.has(x));
      console.log('              missing next to the commonest:', missing.join(', ') || '(none)');
      console.log('              extra   next to the commonest:', extra.join(', ') || '(none)');
    }
  }
  // and what the store itself says its columns are, block by block
  const cols = new Map();
  for (let b = 0; b < blocks.length; b++) {
    const bl = blocks[b];
    if (!bl || !bl.cols) continue;
    const k = bl.cols.join(',');
    cols.set(k, (cols.get(k) || 0) + 1);
  }
  console.log('   the store header declares', cols.size, 'different column lists across', blocks.length, 'blocks');
}
