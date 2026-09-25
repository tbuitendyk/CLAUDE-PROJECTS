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

function makeServer({ runner, journal, health }) {
  const followers = new Set();
  journal.on('record', (rec) => { for (const f of followers) f(`id: ${rec.n}\nevent: record\ndata: ${JSON.stringify(rec)}\n\n`); });
  journal.on('mark', (m) => { for (const f of followers) f(`event: mark\ndata: ${JSON.stringify(m)}\n\n`); });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://engine');
    try {
      if (req.method === 'GET' && u.pathname === '/health') return send(res, 200, health());
      if (req.method === 'GET' && u.pathname === '/state') return send(res, 200, { plans: runner.view(), journalN: journal.n });
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
