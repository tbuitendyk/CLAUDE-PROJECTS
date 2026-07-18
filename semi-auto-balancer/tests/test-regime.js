// Phase 2.9 regime classifier: a synthetic benchmark with a bull run, a
// crash (bear), and a long sideways bottom (range) must segment into swaths
// covering all three types — and the sideways-at-the-bottom stretch must
// read RANGE, not perpetual bear (the rolling-high fix).
const { freshDb, ok } = require('./helpers');
freshDb('regime');
const regime = require('../lib/regime');

const DAY = 86_400_000;
const t0 = 1_600_000_000_000 - (1_600_000_000_000 % DAY);
let day = 0;
const series = [];
const push = (price) => series.push({ ts: t0 + day++ * DAY, usd_price: price });

// Bull: steady climb 100 -> 400 over 220 days.
for (let i = 0; i < 220; i++) push(100 + (300 * i) / 219);
// Bear: crash 400 -> 120 over 120 days (>25% off recent highs throughout).
for (let i = 0; i < 120; i++) push(400 - (280 * i) / 119);
// Range: sideways chop around 125 for 260 days (near its own recent high).
for (let i = 0; i < 260; i++) push(125 + 8 * Math.sin((2 * Math.PI * i) / 25));

const { swaths, byType, enough } = regime.classify(series);
const labels = swaths.map((s) => s.label);

ok(swaths.length >= 3, `segmented into multiple swaths (${swaths.length})`);
ok(enough === true, 'enough regime diversity for a study (>=2 types present)');
ok(byType.bull >= regime.MIN_SWATH, `a bull swath exists (${byType.bull}d)`);
ok(byType.bear >= regime.MIN_SWATH, `a bear swath exists (${byType.bear}d)`);
ok(byType.range >= regime.MIN_SWATH, `a range swath exists (${byType.range}d)`);

// Order sanity: the first swath is bull, a bear appears after it, and the
// long tail is range (NOT bear — the rolling-high fix).
ok(labels[0] === 'bull', 'opens in a bull swath');
ok(labels.includes('bear'), 'a bear swath is identified during the crash');
ok(labels[labels.length - 1] === 'range', 'the sideways bottom reads RANGE, not perpetual bear');

// Coverage: swaths tile the series with no gaps.
let covered = 0;
for (const s of swaths) covered += s.days;
ok(covered === series.length, 'swaths tile the whole series with no gaps');

// Too-short / no-diversity series is flagged not-enough.
const flat = Array.from({ length: 120 }, (_, i) => ({ ts: t0 + i * DAY, usd_price: 100 }));
ok(regime.classify(flat).enough === false, 'a flat/short series is flagged insufficient for a regime study');

// Anti-lag: a V-shaped crash then SHARP recovery. A trailing-MA classifier
// mislabels the recovery's rising leg as "bear" until the average catches up;
// the centered classifier must call the rising leg BULL. Build a crash 400->120
// then a symmetric recovery 120->400, each over 120 days.
const v = [];
let vd = 0;
const vpush = (price) => v.push({ ts: t0 + vd++ * DAY, usd_price: price });
for (let i = 0; i < 120; i++) vpush(400 - (280 * i) / 119); // crash
for (let i = 0; i < 120; i++) vpush(120 + (280 * i) / 119); // sharp recovery
const vsw = regime.classify(v).swaths;
const recoveryDay = 180; // deep in the rising recovery leg
const at = vsw.find((s) => s.startIdx <= recoveryDay && s.endIdx >= recoveryDay);
ok(at && at.label === 'bull', `the recovery's rising leg reads BULL, not lagged bear (got ${at && at.label})`);
ok(vsw.some((s) => s.label === 'bear' && s.endIdx < recoveryDay), 'the crash itself is still a bear swath');

console.log('regime classifier tests pass');
