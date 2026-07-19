// Token rebrand / migration map (Phase 2.99). Some assets change ticker and
// coingecko id mid-life at a fixed conversion ratio, with NO real price break
// at the swap (a pure redenomination/rename). Their post-rebrand series starts
// only at the migration, which needlessly caps a multi-year backtest window.
// Here we let the new asset inherit its predecessor's deep history, spliced at
// the migration date — but ONLY after a continuity check confirms the boundary
// is actually seamless (guarding against a mislabelled entry or a real break).
//
// This is a CURATED table, deliberately not auto-detected: no authoritative
// feed states "X became Y at ratio R on date D", so inference would be a guess.
// Each row is explicit and auditable. `ratio` is new-units per old-unit (so an
// old price is multiplied by ratio to express it in new units); 1.0 for a
// straight 1:1 rename like MATIC→POL.

const D = (y, m, day) => Date.UTC(y, m - 1, day); // month is 1-based here

const REBRANDS = [
  {
    toId: 'polygon-ecosystem-token',
    toSymbol: 'pol',
    fromId: 'matic-network',
    fromSymbol: 'matic',
    ratio: 1.0, // POL migrated 1:1 from MATIC
    dateMs: D(2024, 9, 4), // migration began 2024-09-04
  },
];

// Look up a rebrand by the CURRENT (post-rebrand) id or symbol. Returns the
// predecessor descriptor, or null.
function rebrandFor(id, symbol) {
  const sym = symbol ? String(symbol).toLowerCase() : null;
  return (
    REBRANDS.find((r) => r.toId === id || (sym && r.toSymbol === sym)) || null
  );
}

module.exports = { rebrandFor, REBRANDS };
