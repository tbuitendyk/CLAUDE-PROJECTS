// fieldgate.js -- THE FIELD'S GATE ON A TRADE (FIELD-DESIGN.md sections D and
// F; owner LOOP NOW! 2026-09-21). Pure arithmetic, no I/O, one home for every
// rule the gate has, so the stage 3 worker that prices, the tally that sums,
// the screen that prints and the live path that trades all read the same
// definitions -- the shape lib/confirm.js gave the overlay this replaces.
//
// The members vote exactly as they do today and the gate is laid over the
// result. On each decision the members make, the field is read on that
// decision's own day (lib/field.js, readAt), and the trade is:
//
//   BLOCKED when the field's sign is AGAINST the members' call, or when a
//   minimum is not reached (the second block has a tick that turns it off:
//   sign only); otherwise SIZED by the rung the read -- agreement or
//   certainty, the dial says which -- falls in, a ladder of multipliers of the
//   standard size; and a day the field says nothing on (no point spoke, or
//   they cancelled, or the field has no day for it) trades at the silent
//   multiplier, so silence is never a block by accident.
//
// TWO MINIMUMS, ONE ON EACH OF THE FIELD'S NUMBERS (3.218.0, owner GO NOW!
// 2026-09-21: "the dual read functionality"). The agreement minimum and the
// certainty minimum are each a bar or blank -- blank is no bar on that number
// -- and where both are set the rule says how they combine: `both` blocks
// the trade when either bar is missed, `either` blocks it only when both are.
// A bar of 0 blocks nothing, a missing number included. The read names the
// number the rungs size by, and nothing else now: the bars are named by their
// own number. So one setting can ask for agreement at least 40 AND certainty
// at least 60, which is the only way to learn whether certainty adds anything
// beyond agreement.
//
// THE VERDICT is decided from the numbers written down before any existed
// (FIELD-DESIGN.md section F): the gate ADDS VALUE when its sized money is
// above every trade at size 1 with no gate, and above it per unit of size
// deployed; JUST LEVERAGE when only the first holds; ADDS NOTHING otherwise;
// and BETTER SIGNAL when it adds value and the trades it blocked lost money
// at size 1 -- the blocks were right, not merely harmless.
const { readAt } = require('./field');
const confirmLib = require('./confirm');

const READS = Object.freeze(['agreement', 'certainty']);
// how two minimums combine: both must be reached, or either will do
const RULES = Object.freeze(['both', 'either']);
const VERDICTS = confirmLib.VERDICTS;

// THE RUNGS: "up to this read, this multiple", typed as `20:0.5, 50:1, 80:1.5,
// 100:2` -- a read below 20 trades at half size, below 50 at the standard
// size, below 80 at one and a half, up to 100 at double. The last rung must
// reach 100 so every read lands on one.
function parseRungs(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) throw new Error('size rungs is empty — type at least one rung, such as 100:1 for the standard size everywhere');
  const parts = raw.split(/[,\s]+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(p);
    if (!m) throw new Error(`size rungs: ${JSON.stringify(p)} is not a rung — a rung is "up to this read:multiple", such as 50:1`);
    const upTo = Number(m[1]); const x = Number(m[2]);
    if (!(upTo >= 0 && upTo <= 100)) throw new Error(`size rungs: a rung's read is 0 to 100, not ${upTo}`);
    if (!(x >= 0)) throw new Error(`size rungs: a multiple is 0 or more, not ${x}`);
    if (out.length && !(upTo > out[out.length - 1].upTo)) throw new Error(`size rungs: the rungs must climb — ${upTo} does not come after ${out[out.length - 1].upTo}`);
    out.push({ upTo, x });
  }
  if (out[out.length - 1].upTo < 100) throw new Error(`size rungs: the last rung must reach 100, so every read lands on one — the last one typed reaches ${out[out.length - 1].upTo}`);
  return out;
}
const rungsText = (rungs) => rungs.map((r) => `${r.upTo}:${r.x}`).join(',');
function rungFor(rungs, value) {
  const v = Number(value);
  for (const r of rungs) if (v <= r.upTo) return r.x;
  return rungs[rungs.length - 1].x;
}
// a list of minimums, or one: numbers 0 to 100, ascending, no repeats. `what`
// is the box's own name, so a refusal says which of the two it is about.
function parseMinimums(text, what = 'minimum') {
  const raw = Array.isArray(text) ? text : String(text == null ? '' : text).split(/[,\s]+/);
  const nums = raw.map((x) => (x === '' || x == null ? null : Number(x))).filter((x) => x != null);
  if (!nums.length) throw new Error(`${what} is empty — type a read from 0 to 100 (0 blocks nothing on the read)`);
  for (const x of nums) if (!Number.isFinite(x) || x < 0 || x > 100) throw new Error(`${what}: a read is 0 to 100, not ${JSON.stringify(x)}`);
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  if (uniq.length !== nums.length) throw new Error(`${what} repeats a value`);
  return uniq;
}
// THE BOX AS TYPED: blank is no bar on that number, [null]; otherwise its list
function minimumsOf(text, what) {
  if (text == null || !String(text).trim()) return [null];
  return parseMinimums(text, what);
}
// one bar, checked: null stays null, anything else is a read from 0 to 100
function minimumOrNull(value, what) {
  if (value == null || value === '') return null;
  return parseMinimums([value], what)[0];
}
// a list of rung ladders, separated by semicolons, or one
function parseRungLists(text) {
  const raw = String(text == null ? '' : text);
  const ladders = raw.split(';').map((x) => x.trim()).filter(Boolean);
  if (!ladders.length) throw new Error('size rungs is empty — type at least one rung, such as 100:1 for the standard size everywhere');
  const out = ladders.map((l) => rungsText(parseRungs(l)));
  if (new Set(out).size !== out.length) throw new Error('size rungs repeats a ladder');
  return out;
}
const multiplierOrRefuse = (value, what, fallback) => confirmLib.multiplierOrRefuse(value, what, fallback);

// ONE GATE, CHECKED: what a setting carries
function checkGate(g) {
  const read = String((g || {}).read || 'agreement');
  if (!READS.includes(read)) throw new Error(`"${read}" is not a way to read the field (${READS.join(' / ')})`);
  const agreeMin = minimumOrNull((g || {}).agreeMin, 'agreement minimum');
  const certMin = minimumOrNull((g || {}).certMin, 'certainty minimum');
  const rule = String((g || {}).rule || 'both');
  if (!RULES.includes(rule)) throw new Error(`"${rule}" is not a way to combine the minimums (${RULES.join(' / ')})`);
  const rungs = parseRungs((g || {}).rungs);
  const silent = multiplierOrRefuse((g || {}).silent, 'silent ×', 1);
  return { read, agreeMin, certMin, rule, signOnly: !!(g || {}).signOnly, rungs: rungsText(rungs), silent };
}
// THE GATE AS A RECORD CARRIES IT: the seven fields and nothing else, in one
// place, so a stage 3 row, a Boards coin row and a live configuration cannot
// each write their own idea of its shape
function gateRecord(g) {
  return {
    read: String(g.read), agreeMin: g.agreeMin == null ? null : Number(g.agreeMin), certMin: g.certMin == null ? null : Number(g.certMin),
    rule: String(g.rule || 'both'), signOnly: !!g.signOnly, rungs: String(g.rungs), silent: Number(g.silent),
  };
}
// THE GATE AS SIX FUNNEL DIALS (3.243.0, owner order 2026-09-24): one column
// per box on Sweep, so a Funnel rule can keep a range of minimums or a list of
// ladders the way it keeps one of d. A blank minimum is `no bar`, which sorts
// below every number. A box that changes nothing on this setting reads none
// (null): both minimums and must pass under sign only, which ignores the
// minimums; must pass without two bars to combine; all six with no field.
// silent × is not a dial here: the owner left it off.
function funnelDialsOf(g) {
  if (!g || g.read == null) return { fieldAgreeMin: null, fieldCertMin: null, fieldRule: null, fieldSignOnly: null, fieldSizeBy: null, fieldRungs: null };
  const bar = (v) => (g.signOnly ? null : v == null ? 'no bar' : Number(v));
  return {
    fieldAgreeMin: bar(g.agreeMin), fieldCertMin: bar(g.certMin),
    fieldRule: !g.signOnly && g.agreeMin != null && g.certMin != null ? String(g.rule || 'both') : null,
    fieldSignOnly: !!g.signOnly, fieldSizeBy: String(g.read), fieldRungs: String(g.rungs),
  };
}
// the bars a gate sets, each named by its own number
function barsOf(g) {
  const bars = [];
  if (g.agreeMin != null) bars.push({ what: 'agreement', min: Number(g.agreeMin) });
  if (g.certMin != null) bars.push({ what: 'certainty', min: Number(g.certMin) });
  return bars;
}
// the gate's part of a setting's name; nothing when there is no gate, so a
// block that never named a field names its settings exactly as it always did.
// The rule is named only where there are two bars to combine.
function gateLabel(g) {
  if (!g) return '';
  const bars = barsOf(g);
  const barText = bars.length === 0 ? 'no minimum'
    : bars.map((b) => `${b.what}≥${b.min}`).join(g.rule === 'either' ? ' | ' : ' & ');
  return ` · field ${barText}${g.signOnly ? ' sign only' : ''} sized by ${g.read} ×${g.rungs} silent×${g.silent}`;
}
// WHETHER A DAY CLEARS THE BARS: a bar of 0 blocks nothing, a missing number
// included; `both` needs every bar reached, `either` any one of them; no bar
// at all is cleared by every day.
const clearsBar = (value, min) => min <= 0 || (value != null && Number(value) >= min);
function clearsMinimums(day, g) {
  const checks = barsOf(g).map((b) => clearsBar(day[b.what], b.min));
  if (!checks.length) return true;
  return g.rule === 'either' ? checks.some(Boolean) : checks.every(Boolean);
}
// THE BARS A DAY MISSED, in words for the live path's row on Trade: under
// `both` the ones missed; under `either` both, since it takes both to block
function minimumWords(day, g) {
  const missed = barsOf(g).filter((b) => !clearsBar(day[b.what], b.min));
  return missed.map((b) => `${b.what} ${day[b.what] == null ? 'none' : Number(day[b.what]).toFixed(0)} below ${b.min}`).join(' and ');
}
// the block, as a sentence for the anatomy of a live setup: '' with no bar
function blockWords(g) {
  const bars = barsOf(g);
  if (!bars.length) return '';
  const each = bars.map((b) => `its ${b.what} is below ${b.min}`);
  if (each.length === 1) return `, BLOCKED when ${each[0]}`;
  return g.rule === 'either' ? `, BLOCKED when both ${each.join(' and ')}` : `, BLOCKED when ${each.join(' or ')}`;
}

// THE SIZE OF EVERY CALL under the gate: 0 for a blocked one, the rung's
// multiple for a placed one, the silent multiple where the field said
// nothing. `days` is the field's per-day series (objects, in time order),
// `decisionTs[i]` the instant call i is taken.
function sizesFor(days, decisionTs, calls, gate) {
  const n = calls.length;
  const rungs = parseRungs(gate.rungs);
  const sizes = new Array(n).fill(0);
  const out = { sizes, placed: 0, blockedSign: 0, blockedMin: 0, silent: 0, readSum: 0, readN: 0, signSum: 0, signN: 0 };
  for (let i = 0; i < n; i++) {
    const c = calls[i];
    if (c !== 1 && c !== -1) continue;
    const day = days && days.length ? readAt(days, decisionTs[i]) : null;
    if (!day || !day.speaking || !day.sign) { sizes[i] = gate.silent; out.silent++; continue; }
    const value = gate.read === 'certainty' ? day.certainty : day.agreement;
    out.signSum += day.sign === c ? 1 : 0; out.signN++;
    if (day.sign === -c) { out.blockedSign++; continue; }
    if (!gate.signOnly && !clearsMinimums(day, gate)) { out.blockedMin++; continue; }
    sizes[i] = rungFor(rungs, value == null ? 0 : value);
    out.placed++; out.readSum += value == null ? 0 : value; out.readN++;
  }
  return out;
}

// MONEY UNDER THE SIZES: the calls are grouped by their multiple and each
// group is priced by the one simulator on its own, so a trade at twice the
// size is exactly twice the money, fees included (the fee is a share of the
// position, as lib/confirm.js relies on). The blocked calls are priced once
// at size 1 as well, so the verdict can say whether blocking them paid.
//   sim(callsSubset) -> { pnl, trades, stops }
function priceGated(calls, sizes, sim) {
  const n = calls.length;
  const groups = new Map();
  const blocked = new Array(n).fill(0);
  let anyBlocked = false;
  for (let i = 0; i < n; i++) {
    const c = calls[i];
    if (c !== 1 && c !== -1) continue;
    const m = sizes[i];
    if (!(m > 0)) { blocked[i] = c; anyBlocked = true; continue; }
    if (!groups.has(m)) groups.set(m, new Array(n).fill(0));
    groups.get(m)[i] = c;
  }
  let pnl = 0; let trades = 0; let size = 0; let at1 = 0; let stops = 0;
  const taken = new Array(n).fill(0);
  for (const [m, list] of groups) {
    const r = sim(list);
    pnl += m * r.pnl; trades += r.trades; size += m * r.trades; at1 += r.pnl; stops += r.stops || 0;
    for (let i = 0; i < n; i++) if (list[i]) taken[i] = list[i];
  }
  let blockedAt1 = 0; let blockedN = 0;
  if (anyBlocked) { const rb = sim(blocked); blockedAt1 = rb.pnl; blockedN = rb.trades; }
  return { pnl, trades, size, at1, stops, blockedAt1, blockedN, taken };
}

// THE VERDICT, in its written order (FIELD-DESIGN.md section F). null when
// the gate touched nothing -- no call placed and none blocked.
function verdictOf(t) {
  if (!t) return null;
  const placed = Number(t.trades) || 0; const blockedN = Number(t.blockedN) || 0;
  if (placed + blockedN === 0) return null;
  const baseline = (Number(t.at1) || 0) + (Number(t.blockedAt1) || 0);
  if (!(t.pnl > baseline)) return 'adds nothing';
  const perSized = t.size > 0 ? t.pnl / t.size : null;
  const perAt1 = baseline / (placed + blockedN);
  if (perSized == null || !(perSized > perAt1)) return 'just leverage';
  return blockedN > 0 && t.blockedAt1 < 0 ? 'better signal' : 'adds value';
}
function verdictWhy(word) {
  return {
    'adds nothing': 'the money under the gate is not above every call at size 1 with no gate',
    'just leverage': 'more money than every call at size 1, but not more per unit of size deployed: a bigger bet, not a better one',
    'adds value': 'more money than every call at size 1, and more per unit of size deployed too',
    'better signal': 'adds value, and the calls the gate blocked lost money at size 1 — the blocks were right, not merely harmless',
  }[word] || '';
}

// THE SERIES AS THE WORKER READS IT: a pair's columns on disk, expanded once
// into the day objects readAt walks (the same expansion lib/fieldset.js does
// on the service, kept here so a worker thread needs nothing that touches
// the disk)
function daysFromColumns(c) {
  if (!c || !Array.isArray(c.ts)) return [];
  const out = new Array(c.ts.length);
  for (let i = 0; i < c.ts.length; i++) {
    out[i] = {
      ts: c.ts[i], sign: c.sign[i], agreement: c.agreement[i], size: c.size ? c.size[i] : null,
      certainty: c.certainty ? c.certainty[i] : null, speaking: c.speaking[i], evidence: c.evidence ? c.evidence[i] : null,
      full: c.full ? !!c.full[i] : false,
    };
  }
  return out;
}

// SUMS ACROSS RECORDS: the same numbers, added, so a coin and a setting are
// judged by the one rule over everything they priced.
function addTotals(acc, t) {
  const out = acc || { pnl: 0, trades: 0, size: 0, at1: 0, blockedAt1: 0, blockedN: 0, placed: 0, blockedSign: 0, blockedMin: 0, silent: 0, readSum: 0, readN: 0, n: 0 };
  if (!t) return out;
  for (const k of ['pnl', 'trades', 'size', 'at1', 'blockedAt1', 'blockedN', 'placed', 'blockedSign', 'blockedMin', 'silent', 'readSum', 'readN']) out[k] += Number(t[k]) || 0;
  out.n++;
  return out;
}
// two sums, added: the merge of a sharded fold, n and all
function mergeTotals(acc, add) {
  if (!add) return acc;
  const out = acc || { pnl: 0, trades: 0, size: 0, at1: 0, blockedAt1: 0, blockedN: 0, placed: 0, blockedSign: 0, blockedMin: 0, silent: 0, readSum: 0, readN: 0, n: 0 };
  for (const k of ['pnl', 'trades', 'size', 'at1', 'blockedAt1', 'blockedN', 'placed', 'blockedSign', 'blockedMin', 'silent', 'readSum', 'readN', 'n']) out[k] += Number(add[k]) || 0;
  return out;
}
// to the cent, so a row stores what a reader can add
function totalsCents(t) {
  const cents = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
  return {
    pnl: cents(t.pnl), trades: t.trades, size: Number(t.size.toFixed(3)), at1: cents(t.at1),
    blockedAt1: cents(t.blockedAt1), blockedN: t.blockedN,
    placed: t.placed, blockedSign: t.blockedSign, blockedMin: t.blockedMin, silent: t.silent,
    readSum: Number((t.readSum || 0).toFixed(2)), readN: t.readN || 0,
  };
}
// the share of the calls the gate blocked, 0 to 100, or null with no call
function blockedShare(t) {
  if (!t) return null;
  const all = (Number(t.placed) || 0) + (Number(t.blockedSign) || 0) + (Number(t.blockedMin) || 0) + (Number(t.silent) || 0);
  return all ? ((Number(t.blockedSign) || 0) + (Number(t.blockedMin) || 0)) / all * 100 : null;
}

module.exports = {
  READS, RULES, VERDICTS, parseRungs, rungsText, rungFor, parseMinimums, minimumsOf, minimumOrNull, parseRungLists,
  checkGate, gateRecord, funnelDialsOf, gateLabel, clearsMinimums, minimumWords, blockWords,
  sizesFor, priceGated, verdictOf, verdictWhy, daysFromColumns, addTotals, mergeTotals, totalsCents, blockedShare,
};
