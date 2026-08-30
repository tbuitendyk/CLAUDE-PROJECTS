// uts-tally-header.js -- READ-ONLY. Why is the tally on disk not being served?
// Streams the first bytes out of it rather than inflating the whole thing, so
// this cannot itself be the memory problem it is investigating.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const stages = require(`${APP}/lib/stages`);

const dir = `${APP}/data/stagesets`;
async function main() {
const ids = fs.readdirSync(dir).filter((x) => /^s3-.*-tally\.json\.gz$/.test(x));
console.log('what the code demands: TALLY_V =', stages.TALLY_V === undefined ? '(not exported)' : stages.TALLY_V);
for (const n of ids) {
  const p = path.join(dir, n);
  const st = fs.statSync(p);
  console.log('==', n, st.size, 'bytes on disk,', st.mtime.toISOString());
  let head = '';
  let total = 0;
  const gz = zlib.createGunzip();
  const rs = fs.createReadStream(p);
  // eslint-disable-next-line no-loop-func
  gz.on('data', (b) => { total += b.length; if (head.length < 400) head += b.toString('utf8', 0, Math.min(b.length, 400)); });
  rs.pipe(gz);
  // eslint-disable-next-line no-await-in-loop
  const ok = await new Promise((res) => { gz.on('end', () => res(true)); gz.on('error', (e) => { console.log('   it will not even inflate:', e.message); res(false); }); });
  if (!ok) continue;
  console.log('   inflates to', total, 'bytes  (', (total / 1048576).toFixed(0), 'MB of JSON to parse )');
  console.log('   its first 300 characters:');
  console.log('     ', head.slice(0, 300).replace(/\s+/g, ' '));
  const m = head.match(/"v"\s*:\s*(\d+)/);
  console.log('   the version stamped in the file:', m ? m[1] : '(not in the first 400 characters)');
  const id = n.replace('-tally.json.gz', '');
  console.log('   records in the store:', rowstore.count(id, 'records').toLocaleString());
  const rm = head.match(/"rows"\s*:\s*(\d+)/);
  console.log('   rows the tally says it covers:', rm ? Number(rm[1]).toLocaleString() : '(not in the first 400 characters)');
}
}
main();
