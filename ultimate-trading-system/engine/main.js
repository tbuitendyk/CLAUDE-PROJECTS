#!/usr/bin/env node
'use strict';
// engine/main.js -- THE NEW TRADING ENGINE (loop of 2026-09-25,
// LOOP-2026-09-25-ENGINE.md). Runs on the trading box beside the old order
// program, which it never touches: its own folder, its own service, its own
// record, its own price feed.
//
// Settings come from one file in its own data folder (config.json), written by
// the deploy from the engine's record on Setup > Compute:
//   port         the loopback port the web box reaches through its tunnel
//   feePerLeg    a fee for paper fills when neither the account's (read with its
//                key) nor the setup's came with the order
//   simDelayMs   the delay a live fill takes, as the probe measured it (0 until then)
//   liveEnabled  whether real orders are switched on -- false until the owner says
// No AI anywhere: deterministic arithmetic over printed prices.
const fs = require('fs');
const path = require('path');
const { Journal } = require('./journal');
const { Runner } = require('./runner');
const { makeServer } = require('./api');
const { BinanceMarket } = require('./venues/binance-market');
const { SimulatedExchange } = require('./venues/simulated');
const { KeyStore } = require('./keystore');
const { BinanceAccount, keyVerdict } = require('./venues/binance-account');

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'VERSION.json'), 'utf8')); } catch (_) { return { release: 'unknown' }; } })();
const DATA = process.env.ENGINE_DATA || '/var/lib/uts-engine';
const cfgFile = path.join(DATA, 'config.json');
const cfg = { port: 18095, feePerLeg: 0.001, simDelayMs: 0, liveEnabled: false, ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}) };
if (cfg.liveEnabled) {
  // A SWITCH THIS BUILD CANNOT FLIP: the live module is not in this release, so
  // a config asking for real orders is refused at start, loudly
  console.error('config.json asks for real orders; this engine has no live exchange module yet -- starting with real orders OFF');
  cfg.liveEnabled = false;
}

const journal = new Journal(path.join(DATA, 'journal.jsonl'));
let runner = null;
const market = new BinanceMarket({
  onTrade: (t) => runner && runner.onTrade(t),
  onKline: (k) => runner && runner.onKline(k),
  onStatus: (s) => journal.append({ type: 'feed', ...s }),
});
const simulated = new SimulatedExchange({ market, feePerLeg: cfg.feePerLeg, delayMs: cfg.simDelayMs });
// THE KEY STORE (item 7): the trading accounts' keys, encrypted in this folder,
// opened by a key only this engine's user can read. A store that cannot be
// opened safely is left shut and says why; the engine still runs Paper Books,
// paying each setup's fee and recording its borrowing unpriced.
let keystore = null;
let keystoreProblem = null;
try {
  keystore = new KeyStore({ dir: path.join(DATA, 'keys'), masterFile: path.join(DATA, 'keystore.key'), record: (line) => journal.append(line) }).open();
} catch (e) { keystoreProblem = e.message; keystore = null; }
const accounts = keystore ? (account) => new BinanceAccount({ signer: keystore.signer(account, 'a read for paper: the fee and the borrowing rate') }) : null;
runner = new Runner({ journal, market, venues: { simulated }, accounts, liveEnabled: false });

const startedAt = Date.now();
const health = () => ({
  ok: true, engine: 'uts-engine', release: VERSION.release, commit: VERSION.commit || null, startedAt: new Date(startedAt).toISOString(), now: new Date().toISOString(),
  feeds: [market.status()], plans: { held: runner.plans.size, active: runner.active().length }, journalN: journal.n,
  realOrders: 'off', modes: ['simulated'], feePerLeg: cfg.feePerLeg, simDelayMs: cfg.simDelayMs,
  keys: keystore ? keystore.list().map((k) => ({ account: k.account, present: k.present, addedAt: k.addedAt || null })) : null, keystoreProblem,
});

journal.append({ type: 'start', release: VERSION.release, commit: VERSION.commit || null, config: { port: cfg.port, feePerLeg: cfg.feePerLeg, simDelayMs: cfg.simDelayMs, liveEnabled: false } });
const recovered = runner.recover();
journal.append({ type: 'note', what: 'recovered', plans: recovered });
setInterval(() => runner.tick(), 1000);

// a key entered on Setup > Account is asked, with itself, what it may do
const checkKey = keystore ? async (account) => {
  const acc = new BinanceAccount({ signer: keystore.signer(account, 'checking what the key is allowed to do') });
  await acc.syncClock();
  const r = await acc.restrictions();
  return r.ok ? { checked: true, ...keyVerdict(r) } : { checked: false, why: r.why };
} : null;
const server = makeServer({ runner, journal, health, keystore, checkKey });
server.listen(cfg.port, '127.0.0.1', () => console.log(`uts-engine ${VERSION.release} listening on 127.0.0.1:${cfg.port}`));
const stop = () => { journal.append({ type: 'stop' }); market.stop(); server.close(); setTimeout(() => process.exit(0), 500); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
