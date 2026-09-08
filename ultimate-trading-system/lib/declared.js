// THE DECLARED SETTING, AND THE SET IT PERMUTES INTO. One rule decides what a
// legal declared setting is, against the run's own grid; a permuted set is
// built from that grid and every member goes through the same rule, so a set
// can never hold something the single path would have refused. Stage 3 reads
// its shape axes through this (lib/stages.js). Moved whole from the older
// sweep engine when that engine was retired (3.97.0).
const bracketLib = require('./bracket');

function validateDeclared(raw, menus) {
  if (!raw) return null;
  // Validate against the RUN's grid, not only the library's (review
  // 2026-08-04): a custom-grid run computes only its own cells, and the
  // declared cell is FOUND among them — a declared value outside the run's
  // menus would run for hours and then hand back an empty replication
  // table. Callers without menus (tests, old paths) get the library grid.
  const m = {
    entries: (menus && menus.entries) || bracketLib.ENTRIES,
    gates: (menus && menus.gates) || bracketLib.GATES,
    dMults: (menus && menus.dMults) || bracketLib.D_MULTS,
    tHours: (menus && menus.tHours) || bracketLib.T_HOURS,
    trailMults: (menus && menus.trailMults) || bracketLib.TRAIL_MULTS,
    armMults: (menus && menus.armMults) || bracketLib.ARM_MULTS,
  };
  const entry = raw.entry === undefined ? 'breakout' : String(raw.entry);
  if (!m.entries.includes(entry)) throw new Error(`declared.entry must be one of ${m.entries.join('/')} (this run's grid)`);
  // t IS A NUMBER OF HOURS, OR THE ONE VALUE THAT IS NOT (3.72.0). The chunk's
  // own hold length is resolved against each unit when it is priced, so it
  // travels through here whole rather than being coerced to NaN -- and it is
  // legal only where the RUN'S OWN GRID offers it, which is the stage 3 block
  // and nowhere else. The old sweep path passes the plain numeric ladder and
  // therefore still refuses it, with the same message as any other value it
  // does not hold.
  const tHours = raw.tHours === bracketLib.T_OWN ? bracketLib.T_OWN : Number(raw.tHours);
  if (!m.tHours.includes(tHours)) throw new Error(`declared.tHours must be one of ${m.tHours.join('/')} (this run's grid)`);

  // MARKET entry is the classifier's own trade: enter at the open in the
  // called direction, no rails. There is no distance to declare and the gate
  // is directional by definition, so demanding either would be asking for a
  // number that does not exist. Reject them outright rather than accepting
  // and ignoring — a silently ignored parameter is how a declared config
  // stops meaning what its author thought it meant.
  let out;
  if (entry === 'market') {
    if (raw.dMult !== undefined) throw new Error('declared.dMult is meaningless for market entry (no rails) — omit it');
    if (raw.gate !== undefined && raw.gate !== 'directional') {
      throw new Error("declared.gate must be omitted or 'directional' for market entry");
    }
    out = { entry, gate: 'directional', dMult: null, tHours };
  } else {
    const gate = String(raw.gate || '');
    if (!m.gates.includes(gate)) throw new Error(`declared.gate must be one of ${m.gates.join('/')} (this run's grid)`);
    const dMult = Number(raw.dMult);
    if (!m.dMults.includes(dMult)) throw new Error(`declared.dMult must be one of ${m.dMults.join('/')} (this run's grid)`);
    out = { entry, gate, dMult, tHours, trailMult: null, armMult: null };
    if (raw.trailMult !== undefined && raw.trailMult !== null) {
      const t = Number(raw.trailMult);
      if (!m.trailMults.includes(t)) throw new Error(`declared.trailMult must be null or one of ${m.trailMults.join('/')}`);
      const a = raw.armMult === undefined ? 0 : Number(raw.armMult);
      if (!m.armMults.includes(a)) throw new Error(`declared.armMult must be one of ${m.armMults.join('/')}`);
      out.trailMult = t;
      out.armMult = a;
    } else if (raw.armMult !== undefined) {
      throw new Error('declared.armMult is meaningless without declared.trailMult — omit it');
    }
  }
  // PER-SIZE COUNTS (owner, 2026-07-31). A coin on its own and a coin read
  // with context coins have different committee sizes, so a declaration may
  // name a count for each. Either alone is valid — a run that ticks only one
  // combo size only needs one. The sizes themselves are NOT written down here:
  // they come from declaredQuorumFor, which reads slimViewsFor. This comment
  // used to say "6 and 8" and went stale the day a fourth slice made it 8 and
  // 10, which is exactly why a count belongs in one place and not in prose.
  if (raw.quorumSingles !== undefined || raw.quorumContexts !== undefined) {
    const each = (v, cap, name) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > cap) throw new Error(`declared.${name} must be a whole number from 1 to ${cap}`);
      return n;
    };
    const qs = each(raw.quorumSingles, 6, 'quorumSingles');
    const qc = each(raw.quorumContexts, 8, 'quorumContexts');
    if (qs !== undefined) out.quorumSingles = qs;
    if (qc !== undefined) out.quorumContexts = qc;
  } else if (raw.quorumRatio !== undefined) {
    const r = Number(raw.quorumRatio);
    if (!Number.isFinite(r) || r <= 0 || r > 1) throw new Error('declared.quorumRatio must be in (0,1]');
    out.quorumRatio = r;
  } else {
    const q = Number(raw.quorum);
    if (!Number.isInteger(q) || q < 1) throw new Error('declared.quorum must be a positive integer');
    out.quorum = q;
  }
  const q = out.quorumSingles != null || out.quorumContexts != null
    ? [out.quorumSingles != null ? `${out.quorumSingles}/6` : null,
       out.quorumContexts != null ? `${out.quorumContexts}/8` : null].filter(Boolean).join('+')
    : out.quorumRatio ? `${Math.round(out.quorumRatio * 100)}%` : out.quorum;
  const trailBit = out.trailMult == null ? '' : ` trail${out.trailMult}x/arm${out.armMult}x`;
  out.label = out.entry === 'market'
    ? `q${q} market t${out.tHours}h`
    : `q${q} ${out.gate} d${out.dMult}x t${out.tHours}h${trailBit}`;
  return out;
}
// PERMUTING THE DECLARED CONFIG (owner, 2026-08-17). The single declared config
// is unchanged and stays the default: declare one cell, score it on every asset,
// no shopping. This adds the option to declare a SET instead — permute any of the
// declared boxes and every combination is scored on every asset, so a stage 1
// record set covers a wide region rather than a single point.
//
// The set is built from the RUN's own grid (the same menus validateDeclared
// checks against), and every member goes through validateDeclared itself. That is
// deliberate: one rule decides what a legal declared config is, so a permuted set
// can never contain something the single path would have refused — a market cell
// with a gate, an arm with no trail.
//
// A permuted declared config is NOT declared in the strict sense any more: you
// searched for it. The honest end of that search is the sealed slice — window
// layout 61/13/13/13 and the History section's one-touch exam.
// NO CAP, BY OWNER RULE (2026-08-17): "software reports the number, human makes
// the decision, always". The form shows how many configs the ticks declare before
// Start sweep is pressed; nothing here refuses a count. A guessed ceiling would be
// the software overruling the owner on a number it invented.

function expandDeclared(raw, permute, menus) {
  if (!raw) return [];
  const on = permute || {};
  const any = ['entry', 'gate', 'dMult', 'tHours', 'trail', 'arm', 'agree'].some((k) => on[k]);
  // NO permute ticked: byte-identical to the single path, one config, same object.
  if (!any) return [validateDeclared(raw, menus)];

  const m = {
    entries: (menus && menus.entries) || bracketLib.ENTRIES,
    gates: (menus && menus.gates) || bracketLib.GATES,
    dMults: (menus && menus.dMults) || bracketLib.D_MULTS,
    tHours: (menus && menus.tHours) || bracketLib.T_HOURS,
    trailMults: (menus && menus.trailMults) || bracketLib.TRAIL_MULTS,
    armMults: (menus && menus.armMults) || bracketLib.ARM_MULTS,
  };
  // ARM RIDES A MOVING STOP, and permuting trail puts moving stops in the run
  // off a base that declares none — so an armMult with no trailMult is legal
  // HERE and only here. Without this the screen had nowhere to send the arm
  // setting for a permuted trail, so every trailing member was scored at the
  // code's own 0x: a value the operator never saw and never chose (owner,
  // 2026-08-22). An arm no member could use is still refused, never ignored.
  if (raw.armMult !== undefined && (raw.trailMult === undefined || raw.trailMult === null) && !on.trail) {
    throw new Error('declared.armMult is meaningless without declared.trailMult — omit it');
  }
  const pick = (flag, list, fixed) => (flag ? list.slice() : [fixed]);
  const out = [];
  const entries = on.entry ? m.entries.slice() : [raw.entry === undefined ? 'breakout' : String(raw.entry)];
  for (const entry of entries) {
    // MARKET has no rails: no gate, no distance, no trail, no arm. Expanding
    // those for a market cell would build configs validateDeclared refuses, so
    // the market branch carries only the horizon and the agreement counts.
    const tList = pick(on.tHours, m.tHours, raw.tHours === bracketLib.T_OWN ? bracketLib.T_OWN : Number(raw.tHours));
    if (entry === 'market') {
      for (const tHours of tList) out.push({ entry, tHours });
      continue;
    }
    const gList = pick(on.gate, m.gates, String(raw.gate || ''));
    const dList = pick(on.dMult, m.dMults, Number(raw.dMult));
    // trail null (the static, opposite-rail stop) is a real choice and stays in
    // the list when trail is permuted — otherwise permuting would silently drop
    // the setting the single path defaults to.
    const trList = on.trail ? [null, ...m.trailMults] : [raw.trailMult === undefined ? null : raw.trailMult];
    for (const gate of gList) {
      for (const dMult of dList) {
        for (const tHours of tList) {
          for (const trailMult of trList) {
            if (trailMult == null) { out.push({ entry, gate, dMult, tHours }); continue; }
            const aList = on.arm ? m.armMults.slice() : [raw.armMult === undefined ? 0 : Number(raw.armMult)];
            for (const armMult of aList) out.push({ entry, gate, dMult, tHours, trailMult, armMult });
          }
        }
      }
    }
  }
  // AGREEMENT is a count per committee size, so it multiplies whatever is above.
  // Only the sizes the declaration already names are permuted — a run with no
  // context combos never declared quorumContexts and must not gain one here.
  const withAgree = [];
  const qsList = on.agree && raw.quorumSingles !== undefined
    ? [1, 2, 3, 4, 5, 6] : [raw.quorumSingles];
  const qcList = on.agree && raw.quorumContexts !== undefined
    ? [1, 2, 3, 4, 5, 6, 7, 8] : [raw.quorumContexts];
  for (const base of out) {
    for (const qs of qsList) {
      for (const qc of qcList) {
        const cfg = { ...base };
        if (qs !== undefined) cfg.quorumSingles = qs;
        if (qc !== undefined) cfg.quorumContexts = qc;
        // a declaration that named neither keeps whatever single form it used
        if (qs === undefined && qc === undefined) {
          if (raw.quorumRatio !== undefined) cfg.quorumRatio = raw.quorumRatio;
          else cfg.quorum = raw.quorum;
        }
        withAgree.push(cfg);
      }
    }
  }

  // One rule decides what is legal: every member is validated exactly as a single
  // declaration would be. De-duplicated on the label so an expansion that lands
  // on the same cell twice is scored once.
  const seen = new Set();
  const validated = [];
  for (const cfg of withAgree) {
    const v = validateDeclared(cfg, menus);
    if (seen.has(v.label)) continue;
    seen.add(v.label);
    validated.push(v);
  }
  return validated;
}

module.exports = { validateDeclared, expandDeclared };
