'use strict';
// engine/api.js -- WHAT THE WEB BOX MAY ASK OF THE ENGINE, and the two ways it
// can arrive (owner, 2026-09-25: the engine calls out; nothing connects in):
//   * over the link the engine opens to the web server itself (engine/link.js):
//     each request arrives as a message and is answered through makeHandler;
//   * on the machine's own loopback address (makeServer), for an engine the web
//     box still reaches through its SSH tunnel until it is moved to the link.
// Both ways run the one handler below, so an engine answers the same questions
// the same way whichever way they came.
//
//   GET  /health            the engine's version, clock, feeds and plan counts
//   GET  /state             every plan: as received, where it stands, its money
//   POST /plans             a plan in (the same plan twice is the same plan)
//   POST /plans/:id/cancel  the owner takes a plan back ({ why, entriesOnly }: with
//                           entriesOnly an open position is left to close by its rules)
//   GET  /keys              each trading account: keys present or missing, when they
//                           were entered, and the engine's lock -- never a key
//   POST /keys/:account     { locked, anyAddress } -- the pair, locked in the browser
//                           with this engine's lock (engine/lock.js); opened here,
//                           checked with the exchange, and kept encrypted if it passes.
//                           A pair that arrives unlocked is refused: nothing between
//                           the browser and this engine may be able to read it.
//   POST /keys/:account/delete  the keys taken away
//   POST /setups/:id/verbose  { on } -- every hourly trail check of this setup's
//                           plans written down, or not (Verbose on Setup detail)
//   GET  /journal?since=N   the record, numbered lines from N
//   GET  /events?since=N    (loopback only) the same, then every new line as it is
//                           written and the live figures of open positions
const http = require('http');

// the largest body each question may carry
const LIMITS = { plans: 1 << 20, verbose: 4096, keys: 16384, cancel: 4096 };

function makeHandler({ runner, journal, health, keystore = null, checkKey = null, lock = null }) {
  // one question in, { status, json } out -- never throws
  return async function handle(method, target, body = {}) {
    const u = new URL(target, 'http://engine');
    const b = body && typeof body === 'object' ? body : {};
    try {
      if (method === 'GET' && u.pathname === '/health') return { status: 200, json: health() };
      if (method === 'GET' && u.pathname === '/state') return { status: 200, json: { plans: runner.view(), journalN: journal.n, verbose: Object.fromEntries(runner.verbose || []) } };
      const vm = /^\/setups\/([^/]+)\/verbose$/.exec(u.pathname);
      if (method === 'POST' && vm) {
        const out = runner.setVerbose(decodeURIComponent(vm[1]), b.on === true);
        return { status: out.ok ? 200 : 400, json: out };
      }
      if (method === 'POST' && u.pathname === '/plans') {
        const out = runner.addPlan(b);
        return { status: out.ok ? 200 : 400, json: out };
      }
      const m = /^\/plans\/([^/]+)\/cancel$/.exec(u.pathname);
      if (method === 'POST' && m) {
        const out = runner.cancelPlan(decodeURIComponent(m[1]), typeof b.why === 'string' && b.why.trim() ? b.why.trim().slice(0, 200) : 'cancelled by the owner', { entriesOnly: b.entriesOnly === true });
        return { status: out.ok ? 200 : 404, json: out };
      }
      // THE KEYS (item 7): stored and taken away here, never handed back. A key
      // that arrives is never written to the record, a log line or an answer.
      if (u.pathname === '/keys' || u.pathname.startsWith('/keys/')) {
        if (!keystore) return { status: 503, json: { error: 'this engine has no key store' } };
        if (method === 'GET' && u.pathname === '/keys') return { status: 200, json: { keys: keystore.list(), lock: lock ? lock.info() : null } };
        const km = /^\/keys\/([^/]+)(\/delete)?$/.exec(u.pathname);
        if (method === 'POST' && km) {
          const account = decodeURIComponent(km[1]);
          try {
            if (km[2]) return { status: 200, json: keystore.remove(account) };
            keystore.fileOf(account);   // the account's name, checked before anything else
            if (b.apiKey !== undefined || b.secret !== undefined) return { status: 400, json: { error: 'keys are taken only locked with this engine\'s lock: nothing on the way here may be able to read them' } };
            if (!lock) return { status: 503, json: { error: 'this engine has no lock for keys, so it cannot take any' } };
            const pair = lock.unlock(b.locked, account);
            require('./keystore').KeyStore.checkPair(pair);
            const anyAddress = b.anyAddress === true;
            // WHAT THE KEY MAY DO, asked of the exchange with the key itself BEFORE
            // it is kept: a key that can move money, or is open to any address
            // without the owner's tick, is never written down
            if (!checkKey) return { status: 200, json: { ...keystore.put(account, pair, { anyAddress }), checked: false, why: 'this engine cannot ask the exchange what the key may do' } };
            const v = await checkKey(account, pair, { anyAddress });
            if (v.checked && !v.ok) return { status: 400, json: { error: `the keys were not kept: ${v.refusals.join('; ')}` } };
            const kept = keystore.put(account, pair, { anyAddress, tied: v.checked ? v.tied : null });
            return { status: 200, json: { ...kept, checked: !!v.checked, why: v.checked ? null : v.why } };
          } catch (e) {
            // words the key store or the lock chose, or the request's shape -- never anything that could carry the key
            const mine = e.code === 'BAD_ACCOUNT' || e.code === 'BAD_KEY' || e.code === 'BAD_LOCK';
            return { status: mine ? 400 : 500, json: { error: mine ? e.message : 'the keys could not be stored' } };
          }
        }
      }
      if (method === 'GET' && u.pathname === '/journal') {
        return { status: 200, json: { records: journal.since(Number(u.searchParams.get('since')) || 1, Math.min(5000, Number(u.searchParams.get('limit')) || 1000)), n: journal.n } };
      }
      return { status: 404, json: { error: 'no such address on the engine' } };
    } catch (e) {
      return { status: 400, json: { error: e.message } };
    }
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('not JSON')); } });
    req.on('error', reject);
  });
}
function send(res, code, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}
const limitOf = (pathname) => (pathname === '/plans' ? LIMITS.plans : pathname.startsWith('/keys/') ? LIMITS.keys : pathname.endsWith('/verbose') ? LIMITS.verbose : LIMITS.cancel);

// THE LOOPBACK LISTENER, for an engine the web box reaches through its tunnel
function makeServer(deps) {
  const { journal, health } = deps;
  const handle = makeHandler(deps);
  const followers = new Set();
  journal.on('record', (rec) => { for (const f of followers) f(`id: ${rec.n}\nevent: record\ndata: ${JSON.stringify(rec)}\n\n`); });
  journal.on('mark', (m) => { for (const f of followers) f(`event: mark\ndata: ${JSON.stringify(m)}\n\n`); });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://engine');
    try {
      if (req.method === 'GET' && u.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const from = Number(u.searchParams.get('since')) || (Number(req.headers['last-event-id']) + 1) || 1;
        let sent = from - 1;
        for (;;) {
          const batch = journal.since(sent + 1, 2000);
          for (const rec of batch) { res.write(`id: ${rec.n}\nevent: record\ndata: ${JSON.stringify(rec)}\n\n`); sent = rec.n; }
          if (batch.length < 2000) break;
        }
        const f = (chunk) => res.write(chunk);
        followers.add(f);
        const beat = setInterval(() => res.write(`event: beat\ndata: ${JSON.stringify(health())}\n\n`), 10000);
        req.on('close', () => { followers.delete(f); clearInterval(beat); });
        return undefined;
      }
      const body = req.method === 'POST' ? await readBody(req, limitOf(u.pathname)) : {};
      const out = await handle(req.method, `${u.pathname}${u.search}`, body);
      return send(res, out.status, out.json);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
  return server;
}

module.exports = { makeHandler, makeServer, LIMITS };
