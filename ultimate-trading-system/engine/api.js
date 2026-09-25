'use strict';
// engine/api.js -- HOW THE WEB BOX TALKS TO THE ENGINE. Plain HTTP on the
// trading box's own loopback address only: nothing on the internet can reach
// it. The web box reaches it through an SSH tunnel it opens with its own key,
// so the only way in is the way the owner's machines already trust.
//
//   GET  /health            the engine's version, clock, feeds and plan counts
//   GET  /state             every plan: as received, where it stands, its money
//   POST /plans             a plan in (the same plan twice is the same plan)
//   POST /plans/:id/cancel  the owner takes a plan back ({ why, entriesOnly }: with
//                           entriesOnly an open position is left to close by its rules)
//   GET  /keys              each trading account: keys present or missing, and when
//                           they were entered -- never a key
//   POST /keys/:account     { apiKey, secret } stored encrypted; the answer is the same
//                           present / missing line, never the key
//   POST /keys/:account/delete  the keys taken away
//   POST /setups/:id/verbose  { on } -- every hourly trail check of this setup's
//                           plans written down, or not (Verbose on Setup detail)
//   GET  /journal?since=N   the record, numbered lines from N
//   GET  /events?since=N    the same, then every new line as it is written and
//                           the live figures of open positions (server-sent events)
const http = require('http');

function body(req, limit = 1 << 20) {
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

function makeServer({ runner, journal, health, keystore = null, checkKey = null }) {
  const followers = new Set();
  journal.on('record', (rec) => { for (const f of followers) f(`id: ${rec.n}\nevent: record\ndata: ${JSON.stringify(rec)}\n\n`); });
  journal.on('mark', (m) => { for (const f of followers) f(`event: mark\ndata: ${JSON.stringify(m)}\n\n`); });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://engine');
    try {
      if (req.method === 'GET' && u.pathname === '/health') return send(res, 200, health());
      if (req.method === 'GET' && u.pathname === '/state') return send(res, 200, { plans: runner.view(), journalN: journal.n, verbose: Object.fromEntries(runner.verbose || []) });
      const vm = /^\/setups\/([^/]+)\/verbose$/.exec(u.pathname);
      if (req.method === 'POST' && vm) {
        const b = await body(req, 4096);
        const out = runner.setVerbose(decodeURIComponent(vm[1]), b.on === true);
        return send(res, out.ok ? 200 : 400, out);
      }
      if (req.method === 'POST' && u.pathname === '/plans') {
        const out = runner.addPlan(await body(req));
        return send(res, out.ok ? 200 : 400, out);
      }
      const m = /^\/plans\/([^/]+)\/cancel$/.exec(u.pathname);
      if (req.method === 'POST' && m) {
        const b = await body(req);
        const out = runner.cancelPlan(decodeURIComponent(m[1]), typeof b.why === 'string' && b.why.trim() ? b.why.trim().slice(0, 200) : 'cancelled by the owner', { entriesOnly: b.entriesOnly === true });
        return send(res, out.ok ? 200 : 404, out);
      }
      // THE KEYS (item 7): stored and taken away here, never handed back. A key
      // that arrives is never written to the record, a log line or an answer.
      if (u.pathname === '/keys' || u.pathname.startsWith('/keys/')) {
        if (!keystore) return send(res, 503, { error: 'this engine has no key store' });
        if (req.method === 'GET' && u.pathname === '/keys') return send(res, 200, { keys: keystore.list() });
        const km = /^\/keys\/([^/]+)(\/delete)?$/.exec(u.pathname);
        if (req.method === 'POST' && km) {
          const account = decodeURIComponent(km[1]);
          try {
            if (km[2]) return send(res, 200, keystore.remove(account));
            const b = await body(req, 8192);
            const kept = keystore.put(account, { apiKey: b.apiKey, secret: b.secret });
            // WHAT THE KEY MAY DO, asked of the venue with the key itself: a key
            // that can move money, or is not locked to this box, is not kept
            if (!checkKey) return send(res, 200, { ...kept, checked: false, why: 'this engine cannot ask the venue what the key may do' });
            const v = await checkKey(account);
            if (v.checked && !v.ok) { keystore.remove(account); return send(res, 400, { error: `the keys were not kept: ${v.refusals.join('; ')}` }); }
            return send(res, 200, { ...kept, checked: !!v.checked, why: v.checked ? null : v.why });
          } catch (e) {
            // words the key store chose, or the request's shape -- never anything that could carry the key
            const mine = e.code === 'BAD_ACCOUNT' || e.code === 'BAD_KEY' || e.message === 'not JSON' || e.message === 'too large';
            return send(res, mine ? 400 : 500, { error: mine ? e.message : 'the keys could not be stored' });
          }
        }
      }
      if (req.method === 'GET' && u.pathname === '/journal') {
        return send(res, 200, { records: journal.since(Number(u.searchParams.get('since')) || 1, Math.min(5000, Number(u.searchParams.get('limit')) || 1000)), n: journal.n });
      }
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
      return send(res, 404, { error: 'no such address on the engine' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
  return server;
}

module.exports = { makeServer };
