'use strict';
// lib/live/engineplan.js -- ONE DECISION, WRITTEN AS A PLAN FOR THE NEW TRADING
// ENGINE (loop of 2026-09-25, LOOP-2026-09-25-ENGINE.md).
//
// The web box makes the decision -- the committee trained as the stages train
// it, the call its agreement rule gives, the field's gate over that call -- and
// hands the engine a plan: what the greenlighted configuration says to do with
// that call, and how big. The engine never decides anything; it carries out.
//
// THE SIZE (S4): the clip on the setup, times the field's size on this call (the
// rung it lands on; nothing when the field blocks it or is silent), times the
// conviction multiplier for how many members agreed with the committee's call,
// from the ladder frozen with the greenlight. The same three factors, in the
// same order, as Held prices a captured trade (lib/stages.js tunedOfRule: each
// trade at its own size, the sizing's multiplier multiplying that), and the
// agreeing count is the capture's own: members whose call equals the
// committee's call (lib/stagework.js).
const { multFor } = require('../convictionsweep');

const HOUR_MS = 3600000;

// how many members agreed with the committee's call
function agreeingOf(perMember, call) {
  if (!Array.isArray(perMember) || (call !== 1 && call !== -1)) return 0;
  return perMember.filter((v) => v === call).length;
}

// the three factors and the money a position opens with
function sizeOf({ clipUsd, field, sizing, perMember, membersCall }) {
  const clip = Number(clipUsd);
  const fieldSize = field ? Number(field.size) : 1;
  const agree = agreeingOf(perMember, membersCall);
  const on = !!(sizing && sizing.on && Array.isArray(sizing.ladder) && sizing.ladder.length);
  const multiplier = on ? Number(multFor(sizing.ladder, agree)) : 1;
  const quoteUsd = Number.isFinite(clip) && Number.isFinite(fieldSize) && Number.isFinite(multiplier) ? clip * fieldSize * multiplier : 0;
  return { clipUsd: clip, fieldSize, agree, multiplier, sizingOn: on, quoteUsd: Math.max(0, quoteUsd) };
}

// the plan the engine carries out for one decision of one setup
function planFor({ setup, greenlight, target, geo, decision, feePerLeg, now }) {
  const cfg = setup.configSnapshot;
  const chunkStart = new Date(target.startTs).toISOString();
  const entryTs = target.startTs + (geo.entryOffsetH || 0) * HOUR_MS;
  const sizing = greenlight && greenlight.frozen ? greenlight.frozen.sizing : null;
  const size = sizeOf({ clipUsd: setup.clipUsd, field: decision.field, sizing, perMember: decision.perMember, membersCall: decision.membersCall });
  return {
    planId: `${setup.id}|${chunkStart}`,
    setupId: setup.id,
    // the trading account it would trade live on: its fee and borrowing rate are read with its own key
    account: typeof setup.keyRef === 'string' && setup.keyRef.trim() ? setup.keyRef.trim() : null,
    mode: setup.state === 'live' ? 'live' : 'simulated',
    symbol: cfg.combo.trade,
    chunkStart,
    entryTs,
    call: decision.call,
    cell: {
      entry: cfg.cell.entry, gate: cfg.cell.gate, dMult: cfg.cell.dMult ?? null, tHours: cfg.cell.tHours,
      trailMult: cfg.cell.trailMult ?? null, armMult: cfg.cell.armMult ?? null,
    },
    bandPct: Math.abs(Number(cfg.branch.band)),
    size,
    feePerLeg,
    decision: {
      perMember: decision.perMember, membersCall: decision.membersCall ?? null, agreement: decision.agreement || null,
      field: decision.field || null, inputHash: decision.inputHash || null, trainThrough: decision.trainThrough ?? null,
      configVersion: cfg.configVersion, decidedUtc: new Date(now).toISOString(),
    },
  };
}

module.exports = { agreeingOf, sizeOf, planFor };
