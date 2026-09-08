// How a profile decides — described from ITS OWN config, for any profile.
//
// This was written once against a book looked up by a hardcoded id, so the only
// config in the system that could explain itself on screen was that one. Every
// line of it was already derivable from a configSnapshot — the traded pair, the
// geometry, the members, the quorum, the band — so nothing here is new
// reasoning; it is the same description with the lookup replaced by a
// parameter. A second profile could always have had this and simply did not.
//
// Everything is READ from the engine modules that actually decide
// (lib/features.js, lib/bracket.js, lib/dataset.js) rather than written as
// prose, so the page cannot drift from the code.
const { GEOMETRIES } = require('../dataset');
const feats = require('../features');
const bracketLib = require('../bracket');

// The tested configuration, in the owner's terms.
function describeConfig(cfg, opts = {}) {
  const geo = GEOMETRIES[cfg.branch.geometry] || {};
  return {
    tradedPair: cfg.combo.trade,
    contextInputs: [cfg.combo.ctx1, cfg.combo.ctx2].filter(Boolean),
    geometry: cfg.branch.geometry,
    featureHours: geo.featureHours,
    stepHours: geo.stepHours,
    entryOffsetH: geo.entryOffsetH,
    holdHours: cfg.cell.tHours,
    decision: cfg.branch.decision,
    dormantBandPct: Math.abs(cfg.branch.band),
    committeeSize: (cfg.members || []).length,
    committeeStage: cfg.stage,
    quorum: cfg.cell.quorum,
    // a stage-engine configuration agrees by its own rule, not a quorum (3.91.0)
    engine: cfg.engine || 'sweep',
    agreement: cfg.agreement || null,
    entry: cfg.cell.entry,
    gate: cfg.cell.gate,
    clipUsd: opts.clipUsd ?? null,
    stopPct: opts.stopPct ?? null,
    trainedThrough: Number.isFinite(opts.freezeMs)
      ? new Date(opts.freezeMs).toISOString().slice(0, 10) : null,
  };
}

// How the decision is made: the pipeline, who votes and on what, how the
// context assets enter, and the voting rule.
function describeAnatomy(cfg, opts = {}) {
  const geo = GEOMETRIES[cfg.branch.geometry];
  if (!geo) return null;
  const nDays = geo.featureHours / 24;
  const names = feats.featureNamesFor(nDays);
  const cv = bracketLib.comboViews(cfg.combo.size, nDays);
  const bandPct = Math.abs(cfg.branch.band);
  const members = cfg.members || [];
  const entryH = geo.entryOffsetH || 0;
  const trained = Number.isFinite(opts.freezeMs)
    ? new Date(opts.freezeMs).toISOString().slice(0, 10) : 'its declared cutoff';

  const views = {};
  for (const [k, idx] of Object.entries(cv.views)) views[k] = idx ? idx.length : null;
  const crossNames = names.filter((n) => n.startsWith('rel_') || n === 'ret_correlation');
  const perAssetNames = names.filter((n) => n.startsWith('trade_')).map((n) => n.slice('trade_'.length));
  const ctx = [cfg.combo.ctx1, cfg.combo.ctx2].filter(Boolean);
  // THE STAGE ENGINE'S AGREEMENT, in words (3.91.0): how the members are
  // weighed, what is enough, and the two extras, read from lib/agreement.js
  // rather than typed here so the words cannot drift from the arithmetic.
  const stages = cfg.engine === 'stages';
  const a = cfg.agreement || null;
  const agreeWords = () => {
    if (!a) return null;
    const { RULE_WORDS, READS_NO_BAR } = require('../agreement');
    const what = RULE_WORDS[a.rule] || a.rule;
    const bar = READS_NO_BAR.has(a.rule) ? 'no bar: the winning side is taken whatever its margin'
      : (a.bar === 'own' ? `enough when it reaches what this committee itself reached on its test slice at strictness ${a.pct}%` : `enough at ${a.pct}% of ${a.rule === 'voices' ? 'the independent voices' : a.rule === 'families' ? 'the kinds of evidence' : 'the members'}`);
    const extras = [a.rule === 'voices' ? `two members count as one voice when they agree ${a.copy}% of the time` : null, a.both ? 'the winning side must hold at least one member of each kind' : null, a.persist ? `the same call must have stood for ${a.persist} moment(s) before it is acted on` : null].filter(Boolean);
    return `${what}; ${bar}${extras.length ? `; ${extras.join('; ')}` : ''}`;
  };

  return {
    pipeline: [
      `1. INPUTS — each decision window opens with the last ${geo.featureHours}h of hourly candles for ${cfg.combo.trade} (the traded pair)${ctx.length ? ` and the comparison asset${ctx.length > 1 ? 's' : ''} ${ctx.join(' and ')}` : ''}.`,
      `2. FEATURES — each asset's ${geo.featureHours}h window is compressed to ${nDays + 12} numbers (daily returns, total return, hourly volatility, volume shift, trend slope/acceleration, max drawdown/run-up, range, last-24h and last-6h returns, day-volume dispersion).${ctx.length ? ` The comparison assets then enter a SECOND way: ${crossNames.length} cross features per pair — relative total return, relative last-24h return, relative volume (log ratio), and the hour-by-hour return correlation with ${cfg.combo.trade}.` : ''} Total vector: ${cv.featureCount} numbers. The comparison assets are never traded — they exist only inside this vector.`,
      `3. MEMBERS VOTE — ${members.length} independent models (committee below), each seeing a different SLICE of those ${cv.featureCount} numbers, each trained through ${trained} and frozen. Each classifies the window as UP / DOWN / ASIDE, where ASIDE means "the coming move looks smaller than the ${bandPct}% dormant band". Decision rule '${cfg.branch.decision}': the member votes whichever class has the highest probability.`,
      stages
        ? `4. COMMITTEE — the votes are weighed the way the stage engine weighs them: ${agreeWords()}. The committee's own shape and each member's threshold are read from its test slice, never from a later window. Short of enough, stand aside.`
        : `4. COMMITTEE — votes are tallied. Ties between UP and DOWN mean stand aside. Otherwise the majority side wins if it has at least ${cfg.cell.quorum} vote(s) (quorum ${cfg.cell.quorum}-of-${members.length}); with quorum 1, any un-tied majority fires.`,
      `5. ENTRY — '${cfg.cell.entry}' algorithm with a '${cfg.cell.gate}' gate: a market order in the called direction at the hourly OPEN of window start +${entryH}h (${String(entryH % 24).padStart(2, '0')}:00 UTC). Long = buy; short = borrow-and-sell on isolated margin.`,
      `6. EXIT — a market order exactly ${cfg.cell.tHours}h after entry (${(cfg.cell.tHours / 24).toFixed(1)} days later)${opts.stopPct ? `, or sooner if the ${(opts.stopPct * 100).toFixed(2)}% protective stop is hit` : '. No stop, no trail, no target: the tested cell is a pure time exit, so the hold length is the only exit knob'}.`,
    ],
    committee: members.map((m) => ({
      model: m.model === 'logreg' ? 'softmax logistic regression (lib/logreg.js, pure JS)' : m.model,
      view: m.view,
      featuresSeen: views[m.view],
      viewMeaning: {
        full: 'everything — all price, volume and cross features',
        prices: 'price action only — volume features removed',
        volume: 'volume behaviour only',
        cross: 'only the comparisons against the context assets',
      }[m.view] || m.view,
    })),
    features: {
      totalVector: cv.featureCount,
      perAsset: nDays + 12,
      perAssetNames,
      crossPerPair: crossNames.length,
      crossNames,
      note: ctx.length
        ? `layout: ${cfg.combo.trade} block${ctx.map((c) => ` + ${c} block + ${cfg.combo.trade}x${c} cross`).join('')}`
        : `layout: ${cfg.combo.trade} block only`,
    },
    voting: {
      quorum: cfg.cell.quorum,
      members: members.length,
      engine: cfg.engine || 'sweep',
      agreement: a,
      rule: stages ? agreeWords() : `count UP votes vs DOWN votes; a tie stands aside; otherwise the majority wins when it has >= ${cfg.cell.quorum} vote(s)`,
      dormantBandPct: bandPct,
      labelRule: `a training window is labelled UP/DOWN only when the following move exceeds +/-${bandPct}%; smaller moves are ASIDE — that is what teaches members to sit out`,
    },
  };
}

module.exports = { describeConfig, describeAnatomy };
