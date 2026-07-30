// INSIDE VIEW of one saved setup — the 12 committee members, individually.
//
// Owner, 2026-07-30: every check runnable from the interface, generalized.
// This module is PURE (dump in, tables out) so the analysis is unit-testable
// and the endpoint stays a thin file-read. Nothing here fires compute; it
// reads what L12 started saving: each member's fitted model, its votes over
// both windows, and its solo scores.
//
// The questions it answers, which the board cannot:
//   - which of the 12 members actually earn, member by member, both windows
//   - how often each member commits to a direction at all
//   - when the committee trades, which members voted with the trade — a
//     stable coalition (one real opinion echoed) reads very differently from
//     shifting majorities (genuine agreement)
//   - pairwise agreement between members on committed calls, so "12 members"
//     can be seen for how many independent opinions it really is
const { quorumCall } = require('./bracketwork');

function activeRate(votes) {
  if (!votes || !votes.length) return null;
  return votes.filter((v) => v !== 0).length / votes.length;
}

// Share of committee TRADES (non-zero quorum call) where this member's own
// vote matched the traded direction.
function withTradeRate(memberVotes, committee) {
  let both = 0;
  let with_ = 0;
  for (let i = 0; i < committee.length; i++) {
    if (committee[i] === 0) continue;
    both++;
    if (memberVotes[i] === committee[i]) with_++;
  }
  return both ? with_ / both : null;
}

// Agreement between two members on periods where BOTH committed. Fewer than
// minOverlap shared commitments returns null rather than a noisy percentage.
function pairAgreement(a, b, minOverlap = 5) {
  let both = 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0 || b[i] === 0) continue;
    both++;
    if (a[i] === b[i]) same++;
  }
  return both >= minOverlap ? same / both : null;
}

function inspectDump(dump, quorum) {
  const q = Math.max(1, Number(quorum) || 1);
  const specs = dump.specs || [];
  const per = dump.perMember || [];
  const vs = (dump.votes && dump.votes.search) || [];
  const vh = (dump.votes && dump.votes.hold) || null;
  const n = specs.length;

  // The committee's own calls at the requested agreement level, per window.
  const commSearch = vs.length ? vs[0].map((_, i) => quorumCall(vs, i, q)) : [];
  const commHold = vh && vh.length ? vh[0].map((_, i) => quorumCall(vh, i, q)) : [];

  const members = specs.map((spec, i) => ({
    i,
    spec,
    search: per[i] ? per[i].search : null,
    hold: per[i] ? per[i].hold : null,
    activeSearch: activeRate(vs[i]),
    activeHold: vh ? activeRate(vh[i]) : null,
    withTradeHold: vh ? withTradeRate(vh[i], commHold) : null,
    hasModel: !!(dump.models && dump.models[i]),
  }));

  // Pairwise agreement on the HELD-BACK window (falls back to search when a
  // run had no holdout), committed calls only.
  const base = vh && vh.length ? vh : vs;
  const pairwise = [];
  for (let a = 0; a < n; a++) {
    const row = [];
    for (let b = 0; b < n; b++) {
      row.push(a === b ? 1 : pairAgreement(base[a] || [], base[b] || []));
    }
    pairwise.push(row);
  }

  return {
    quorum: q,
    shiftFrac: dump.shiftFrac ?? null,
    bandPct: dump.bandPct ?? null,
    members,
    pairwise,
    pairwiseWindow: vh && vh.length ? 'hold' : 'search',
    committee: {
      searchTrades: commSearch.filter((c) => c !== 0).length,
      holdTrades: commHold.filter((c) => c !== 0).length,
      searchPeriods: commSearch.length,
      holdPeriods: commHold.length,
    },
  };
}

module.exports = { inspectDump, pairAgreement, withTradeRate, activeRate };
