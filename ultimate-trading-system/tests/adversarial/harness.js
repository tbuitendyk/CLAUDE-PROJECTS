// Shared machinery for the adversarial suite.
//
// Two rules govern everything in this directory.
//
// RULE A — never attack the real thing. Every server this suite starts runs
// from a throwaway copy of the code with an EMPTY data folder, on a port
// nothing else uses. It cannot see, change or delete the owner's candles,
// setups, journals or anything else under data/. If a future edit makes an
// attacker write into the real tree, that is the bug, not the finding.
//
// RULE B — a crash is safe, a believable wrong number is not. A refusal
// ("400, I will not do that") is a PASS. An error is a pass. What fails is a
// confident answer built on rubbish: a total that silently skipped half its
// input, a rate computed from an empty list, a screen field that reads
// "undefined" as though it were a value. Those are what this suite hunts.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

// 8093 is the previous generation's live trading service and 8094 is this
// one. Neither is ever touched here. The suite works in the 8700s, which
// nothing on the box claims.
const BASE_PORT = 8731;
const FORBIDDEN_PORTS = new Set([8088, 8091, 8092, 8093, 8094]);

// ---- sandbox ---------------------------------------------------------------

// A complete copy of the running code beside an empty data folder. Copying is
// cheap (the code is small; the data is what is large, and the data is exactly
// what we are refusing to bring). node_modules is symlinked, not copied.
function makeSandbox(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `uts-adv-${label}-`));
  for (const entry of ['server.js', 'package.json']) {
    fs.copyFileSync(path.join(ROOT, entry), path.join(dir, entry));
  }
  for (const entry of ['lib', 'public']) {
    fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  try {
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  } catch (_) {
    fs.cpSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true });
  }
  // The folders the code expects to exist, all empty.
  for (const d of ['data', 'data/cache', 'data/batches', 'data/pilot', 'data/models',
    'data/manifests', 'data/live', 'data/live/setups', 'data/live/greenlights',
    'data/live/decisions', 'data/live/unhalt']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  return dir;
}

function dropSandbox(dir) {
  if (!dir || !dir.includes('uts-adv-')) return; // never rm -rf anything else
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* leave it */ }
}

// ---- server ----------------------------------------------------------------

async function startServer(sandbox, port, env = {}) {
  if (FORBIDDEN_PORTS.has(port)) throw new Error(`port ${port} belongs to a real service — refusing`);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: sandbox,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (b) => { out += b.toString(); });
  child.stderr.on('data', (b) => { out += b.toString(); });
  let exited = null;
  child.on('exit', (code, sig) => { exited = { code, sig }; });

  const deadline = Date.now() + 20000;
  for (;;) {
    if (exited) throw new Error(`server died before it listened (${JSON.stringify(exited)})\n${out}`);
    try {
      const r = await request(port, 'GET', '/api/healthz');
      if (r.status) break;
    } catch (_) { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server never answered on ${port}\n${out}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  return {
    port,
    log: () => out,
    alive: () => exited === null,
    exited: () => exited,
    stop: () => new Promise((res) => {
      if (exited) return res();
      child.once('exit', () => res());
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 2500);
    }),
  };
}

// ---- requests --------------------------------------------------------------

// Deliberately hand-rolled rather than using a client library: the attacks
// need to send things a well-behaved client would refuse to send — broken
// JSON, wrong content types, absurd lengths, odd methods.
function request(port, method, urlPath, body, opts = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = { ...(opts.headers || {}) };
    if (body !== undefined && body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['Content-Type'] = opts.contentType || 'application/json';
      }
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers, timeout: opts.timeout || 20000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { /* not json, fine */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('request timed out')); });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ---- judging ---------------------------------------------------------------

const POISON = /(^|[^A-Za-z0-9_"])(NaN|Infinity|-Infinity|undefined)([^A-Za-z0-9_"]|$)/;

// Does this answer look like a confident lie? Only ever asked of answers the
// server was happy with (2xx). A refusal is never judged — refusing is right.
function looksFabricated(res) {
  if (!res || res.status >= 300) return null;
  if (!res.text) return null;
  if (POISON.test(res.text)) {
    const m = res.text.match(POISON);
    return `a 2xx answer contains the bare token "${m[2]}" — that is a number the code failed to compute, presented as a result`;
  }
  if (/"(NaN|Infinity|-Infinity)"/.test(res.text)) {
    return 'a 2xx answer carries a failed number stringified into quotes, which reads on screen as a real value';
  }
  return null;
}

// Did the server hand back its own guts?
function leaksInternals(res) {
  if (!res || !res.text) return null;
  if (/\/home\/[a-z0-9_-]+\/|\bat Object\.<anonymous>|node_modules\//.test(res.text)) {
    return 'the answer contains a file path or stack frame from inside the machine';
  }
  return null;
}

// ---- findings --------------------------------------------------------------

// A finding is written for the owner, not for a compiler. `what` is one plain
// sentence: what the system does, and why that is wrong.
function finding(id, where, what, extra = {}) {
  return { id, where, what, ...extra };
}

module.exports = {
  ROOT, BASE_PORT, FORBIDDEN_PORTS,
  makeSandbox, dropSandbox, startServer, request,
  looksFabricated, leaksInternals, finding,
};
