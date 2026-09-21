// fieldlive.js -- THE FIELD ON THE LIVE PATH (FIELD-DESIGN.md section H; owner
// LOOP NOW! 2026-09-21). The field for a setup's coin and chunk shape is
// rebuilt from the closed history at every decision with the same engine the
// lab used (lib/field.js), under the dials the greenlighted record was priced
// with, and read at the target chunk's own decision instant. No state is
// kept between decisions: the lab and the live path can never compute a
// different number for the same day, because they run the same arithmetic
// over the same candles.
//
// The decisions whose chunk has not closed -- the day being decided and the
// one or two before it on a long hold -- are days of the field with no
// outcome: read, never added to a point. That is what lets the field speak
// on the day it is asked (lib/windowmove.js, keepUnclosed).
const F = require('./field');
const fieldGate = require('./fieldgate');
const windowLib = require('./windowmove');
const { GEOMETRIES } = require('./dataset');

// the same input the build on Coins makes for a pair, to the last decision
// the candles reach -- THE BUILD'S OWN FUNCTION (lib/fieldrun.js), so the lab
// and the live path cannot read a different set of days from the same candles
const inputFor = (map, geometry, lookbackHours) => require('./fieldrun').inputFor(map, geometry, lookbackHours, { keepUnclosed: true });

// THE FIELD AT ONE DECISION, and what the gate makes of the members' call.
//   map        the traded coin's hourly candles, as the live path holds them
//   dials      the field's build dials as the record carries them (window in
//              days, half-life, floor, bands, look-backs in hours, the two
//              evidence dials, copies)
//   gate       read, minimum, sign only, rungs, silent
//   startTs    the target chunk's start
//   call       the members' call, 1, -1 or 0
//   seedText   the pair's key, so the slid copies are the lab's
function fieldAtDecision(map, geometry, dials, gate, startTs, call, seedText) {
  const geo = GEOMETRIES[geometry];
  const backs = Array.isArray(dials.lookbackHours) && dials.lookbackHours.length
    ? dials.lookbackHours.map(Number)
    : (dials.lookbackDays || []).map((d) => Number(d) * 24);
  const input = inputFor(map, geometry, backs);
  const built = F.buildField(input, { ...dials, lookbackHours: backs, seedText: seedText || '' });
  const ts = windowLib.decisionAt(map, startTs, geo).ts;
  const day = F.readAt(built.days, ts);
  const exact = !!(day && day.ts === ts);
  const last = built.days.length ? built.days[built.days.length - 1] : null;
  const out = {
    read: gate.read, ts, day: exact ? day.ts : null, lastDay: last ? last.ts : null,
    full: exact ? !!day.full : false,
    sign: exact ? day.sign : 0, agreement: exact ? day.agreement : null, certainty: exact ? day.certainty : null,
    speaking: exact ? day.speaking : 0,
    size: 1, why: 'no gate',
  };
  if (call !== 1 && call !== -1) { out.size = 0; out.why = 'no call'; return out; }
  if (!exact) { out.size = Number(gate.silent); out.why = 'silent: the field has no day for this decision'; return out; }
  const sz = fieldGate.sizesFor([day], [ts], [call], gate);
  out.size = sz.sizes[0];
  out.why = sz.blockedSign ? 'blocked by sign'
    : sz.blockedMin ? `blocked by minimum: ${gate.read} ${out[gate.read] == null ? 'none' : Number(out[gate.read]).toFixed(0)} below ${gate.minimum}`
      : sz.silent ? 'silent'
        : `sized: ${gate.read} ${Number(out[gate.read]).toFixed(0)} on the rung ×${out.size}`;
  return out;
}

// the most one clip may be multiplied by under a gate, for the box's ceiling
function largestMultipleOf(field) {
  if (!field || !field.gate) return 1;
  let most = Number(field.gate.silent) || 0;
  try { for (const r of fieldGate.parseRungs(field.gate.rungs)) most = Math.max(most, r.x); } catch (_) { /* refused elsewhere */ }
  return Math.max(1, most);
}

module.exports = { inputFor, fieldAtDecision, largestMultipleOf };
