#!/usr/bin/env node
'use strict';
// engine/main.js -- THE NEW TRADING ENGINE (loop of 2026-09-25,
// LOOP-2026-09-25-ENGINE.md). Runs on the trading box beside the old order
// program, which it never touches: its own folder, its own service, its own
// record, its own price feed.
//
// Settings come from one file in its own data folder (config.json):
//   link         { url, code } -- the web server this engine calls out to
//                (engine/link.js), and the install command's one-time code,
//                which becomes the engine's own token on the first start. The
//                install command writes it; without it the engine does not start,
//                because an engine that calls nobody can do nothing
//   feePerLeg    a fee for paper fills when neither the account's (read with its
//                key) nor the setup's came with the order
//   simDelayMs   the delay a live fill takes, as the probe measured it (0 until then)
//   liveEnabled  whether real orders are switched on -- false until the owner says
// No AI anywhere: deterministic arithmetic over printed prices.
const fs = require('fs');
const path = require('path');
const { Journal } = require('./journal');
const { Runner } = require('./runner');
const { makeHandler } = require('./api');
const { BinanceMarket } = require('./venues/binance-market');
const { SimulatedExchange } = require('./venues/simulated');
const { KeyStore } = require('./keystore');
const { Lock } = require('./lock');
const { BinanceAccount, keyVerdict } = require('./venues/binance-account');

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'VERSION.json'), 'utf8')); } catch (_) { return { release: 'unknown' }; } })();
const DATA = process.env.ENGINE_DATA || '/var/lib/uts-engine';
const cfgFile = path.join(DATA, 'config.json');
const cfg = { feePerLeg: 0.001, simDelayMs: 0, liveEnabled: false, ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}) };
if (!cfg.link || typeof cfg.link.url !== 'string' || !cfg.link.url) {
  // THE ENGINE CALLS OUT, and only that: refused before anything is opened or written
  console.error(`${cfgFile} names no web server to call: install the engine with an install command made on the Compute tab`);
  process.exit(2);
}
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
// THE LOCK (owner, 2026-09-25): trading keys arrive locked in the browser with
// its public half; only this engine can open them. A lock that cannot be opened
// safely is left shut and says why; the engine then takes no keys.
let lock = null;
let lockProblem = null;
try { lock = new Lock(path.join(DATA, 'lock.json')).open(); } catch (e) { lockProblem = e.message; lock = null; }
const accounts = keystore ? (account) => new BinanceAccount({ signer: keystore.signer(account, 'a read for paper: the fee and the borrowing rate') }) : null;
runner = new Runner({ journal, market, venues: { simulated }, accounts, liveEnabled: false });

let link = null;
// the fingerprint of this engine's own code, the same one the web server works out from its package
const CODE = (() => { try { const t = require('./tar'); return t.codeFingerprint(t.filesUnder(__dirname, t.ENGINE_CODE)); } catch (_) { return null; } })();
const startedAt = Date.now();
const health = () => ({
  ok: true, engine: 'uts-engine', release: VERSION.release, commit: VERSION.commit || null, code: CODE, startedAt: new Date(startedAt).toISOString(), now: new Date().toISOString(),
  feeds: [market.status()], plans: { held: runner.plans.size, active: runner.active().length }, journalN: journal.n,
  realOrders: 'off', modes: ['simulated'], feePerLeg: cfg.feePerLeg, simDelayMs: cfg.simDelayMs,
  keys: keystore ? keystore.list().map((k) => ({ account: k.account, present: k.present, addedAt: k.addedAt || null, anyAddress: k.anyAddress === true, tied: typeof k.tied === 'boolean' ? k.tied : null })) : null, keystoreProblem,
  lock: lock ? lock.info() : null, lockProblem,
  link: link ? link.status() : null,
});

journal.append({ type: 'start', release: VERSION.release, commit: VERSION.commit || null, config: { feePerLeg: cfg.feePerLeg, simDelayMs: cfg.simDelayMs, liveEnabled: false } });
const recovered = runner.recover();
journal.append({ type: 'note', what: 'recovered', plans: recovered });
setInterval(() => runner.tick(), 1000);

// a key entered on the Account tab is asked, with itself, what it may do -- before it is kept
const checkKey = keystore ? async (account, pair, { anyAddress = false } = {}) => {
  const acc = new BinanceAccount({ signer: keystore.signerOf(account, pair, 'checking what the key is allowed to do') });
  await acc.syncClock();
  const r = await acc.restrictions();
  return r.ok ? { checked: true, ...keyVerdict(r, { anyAddress }) } : { checked: false, why: r.why };
} : null;
const deps = { runner, journal, health, keystore, checkKey, lock };
// THE ENGINE CALLS OUT (engine/link.js): nothing listens on this machine at all
const { Link } = require('./link');
link = new Link({ url: cfg.link.url, code: cfg.link.code || null, dataDir: DATA, handle: makeHandler(deps), journal, health, lock, version: VERSION });
link.start();
console.log(`uts-engine ${VERSION.release} calling out to ${cfg.link.url}`);
const stop = () => { journal.append({ type: 'stop' }); market.stop(); link.stop(); setTimeout(() => process.exit(0), 500); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
