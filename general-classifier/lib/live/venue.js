// THE TRADING VENUE SEAM. The exchange's trading surface, declared out loud.
//
// WHY (owner, 2026-08-24)
// ----------------------
// lib/live/exchange.js already seams the venue's MARKET DATA (candles, clock,
// history). The venue's TRADING surface — balances, orders, borrowing — had no
// seam at all. It lived welded inside a Python executor on another branch, so
// the product could not see it, could not test it, and could not run it
// anywhere else.
//
// The owner's requirement: the trading platform API is plainly exposed, so
// that piece can run anywhere, and so compute / decision / execution can each
// be chosen independently rather than being welded together.
//
// "Plainly exposed" here means literally enumerable: CAPABILITIES below is
// data, not prose, so a screen or an endpoint can list what a venue must do
// and which of those a given adapter actually implements. A capability nobody
// can see is a capability nobody can verify.
//
// This module declares the CONTRACT. It deliberately ships no live-money
// implementation: wiring an adapter that can place real orders is its own
// change with its own authorisation.

// Every operation the live trading rail needs from a venue. Each entry says
// what it does and what it must return, so a second adapter is a checklist
// rather than an archaeology exercise.
const CAPABILITIES = [
  { name: 'name',      kind: 'identity', returns: 'string',
    doc: 'adapter identity, recorded on every action for provenance' },
  { name: 'rules',     kind: 'identity', returns: '{qtyStep,minNotional,takerFeeRate,closeFeeBuffer}',
    doc: 'the venue facts the decision layer needs; see lib/live/tradeplan.js' },
  { name: 'price',     kind: 'read', args: 'symbol', returns: 'number|null',
    doc: 'last traded price, for sizing and for dust decisions' },
  { name: 'balances',  kind: 'read', args: 'symbol', returns: '{freeBase,borrowedBase,freeQuote,marginLevel}',
    doc: 'what the wallet ACTUALLY holds and owes — the truth the decision layer plans against' },
  { name: 'placeOrder', kind: 'write', args: '{symbol,side,qty,sideEffect,clientId}', returns: '{status,fillPrice,filledQty,fee}',
    doc: 'one market order. sideEffect is passed through explicitly and never inferred' },
  { name: 'borrow',    kind: 'write', args: '{symbol,asset,qty}', returns: '{ok,ref}',
    doc: 'take a loan. Required because auto-borrow covers only the shortfall' },
  { name: 'repay',     kind: 'write', args: '{symbol,asset,qty}', returns: '{ok,ref}',
    doc: 'hand a loan back, e.g. to undo a borrow whose sell then failed' },
];

const READ_ONLY = CAPABILITIES.filter((c) => c.kind !== 'write').map((c) => c.name);
const WRITES = CAPABILITIES.filter((c) => c.kind === 'write').map((c) => c.name);

// Which capabilities an adapter actually provides. Reported honestly, so a
// half-built adapter cannot pass itself off as complete.
function describe(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    return { ok: false, reason: 'not an adapter object', implemented: [], missing: CAPABILITIES.map((c) => c.name) };
  }
  const implemented = [];
  const missing = [];
  for (const c of CAPABILITIES) {
    if (typeof adapter[c.name] === 'function' || (c.kind === 'identity' && adapter[c.name] != null)) {
      implemented.push(c.name);
    } else {
      missing.push(c.name);
    }
  }
  return {
    ok: missing.length === 0,
    name: adapter.name || '(unnamed)',
    implemented,
    missing,
    canTrade: WRITES.every((w) => implemented.includes(w)),
  };
}

// The registry. Empty of live-money adapters on purpose — see the header.
// An execution host registers itself here, which is what lets the owner pick
// where execution runs without the engine changing.
const ADAPTERS = Object.create(null);

function registerVenue(adapter) {
  const d = describe(adapter);
  if (!d.ok) {
    const e = new Error(`venue adapter '${d.name}' is missing: ${d.missing.join(', ')}`);
    e.code = 'INCOMPLETE_ADAPTER';
    throw e;
  }
  ADAPTERS[adapter.name] = adapter;
  return d;
}

function getVenue(name) {
  const a = ADAPTERS[name];
  if (!a) {
    const e = new Error(`no trading venue adapter registered as '${name}'`);
    e.code = 'NO_VENUE';
    throw e;
  }
  return a;
}

// What the screen/endpoint shows: the contract, plus who is registered and
// what each can actually do.
function inventory() {
  return {
    capabilities: CAPABILITIES,
    readOnly: READ_ONLY,
    writes: WRITES,
    registered: Object.keys(ADAPTERS).map((n) => describe(ADAPTERS[n])),
  };
}

module.exports = { CAPABILITIES, READ_ONLY, WRITES, describe, registerVenue, getVenue, inventory, ADAPTERS };
