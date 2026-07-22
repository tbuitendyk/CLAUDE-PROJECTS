const zlib = require('zlib');
const { assert } = require('./helpers');
const { unzipSingleEntry, parseKlineCsv } = require('../lib/binance');

// Build a minimal single-entry zip (what data.binance.vision serves) so the
// reader is tested without touching the network.
function buildZip(name, content, method) {
  const nameBuf = Buffer.from(name);
  const raw = Buffer.from(content);
  const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
  const crc = zlibCrc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42); // local header offset

  const cdOffset = 30 + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

function zlibCrc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const CSV =
  'open_time,open,high,low,close,volume,close_time,quote_volume,count,tbb,tbq,ignore\n' + // header line (2025+ files)
  '1767225600000,40.1,41.0,39.5,40.7,100,1767229199999,4070,10,50,2000,0\n' +
  '1767229200000000,40.7,42.0,40.6,41.9,90,1767232799999999,3771,9,45,1900,0\n'; // microsecond timestamps

module.exports = {
  async unzipDeflate() {
    const rows = parseKlineCsv(unzipSingleEntry(buildZip('a.csv', CSV, 8)).toString('utf8'));
    assert.strictEqual(rows.length, 2);
  },
  async unzipStored() {
    const rows = parseKlineCsv(unzipSingleEntry(buildZip('a.csv', CSV, 0)).toString('utf8'));
    assert.strictEqual(rows.length, 2);
  },
  async parsePrunesAndNormalizes() {
    const rows = parseKlineCsv(CSV);
    assert.strictEqual(rows.length, 2); // header skipped
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['close', 'high', 'low', 'open', 'quoteVolume', 'ts']);
    assert.strictEqual(rows[0].ts, 1767225600000);
    assert.strictEqual(rows[1].ts, 1767229200000); // microseconds normalized to ms
    assert.strictEqual(rows[0].open, 40.1);
    assert.strictEqual(rows[0].quoteVolume, 4070);
  },
  async rejectsGarbage() {
    assert.throws(() => unzipSingleEntry(Buffer.from('definitely not a zip file at all......')), /not a zip/);
  },
};
