// AN ENGINE LINKED TO THIS PROCESS, FOR A TEST (3.267.0). Every engine calls
// out and keeps its link open (lib/live/enginehub.js), and the hub takes links
// on the one listener it is attached to -- once per process, as in the service.
// So every test in the run shares one listener, made the first time a test asks
// for it, and each engine is the real link (engine/link.js) answering with the
// real handler (engine/api.js). Nothing here is a stand-in for the transport.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let listener = null;
function hubListener() {
  if (listener) return listener;
  listener = new Promise((resolve) => {
    const express = require('express');
    const hub = require('../lib/live/enginehub');
    const app = express();
    app.use(express.json());
    hub.installRoutes(app, express);
    const server = app.listen(0, '127.0.0.1', () => {
      server.unref();
      hub.attach(server, server.address().port);
      resolve({ server, port: server.address().port });
    });
  });
  return listener;
}

async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 25));
  }
}

// An engine record that calls out, made the way the service makes one when an
// engine first calls in, and the engine itself: `deps` are what engine/main.js
// hands its handler ({ runner, journal, health, keystore, checkKey, lock }).
// start() opens the link and resolves once the engine answers over it; a mirror
// that is to keep the engine's record is started BEFORE it, as in the service,
// so the record from line 1 comes to it.
async function linkedEngine({ id, name = id, deps }) {
  const { port } = await hubListener();
  const targets = require('../lib/live/targets');
  const hub = require('../lib/live/enginehub');
  const { Link } = require('../engine/link');
  const { makeHandler } = require('../engine/api');
  const token = crypto.randomBytes(32).toString('base64url');
  const target = targets.saveCallingEngine({ id, name, tokenHash: crypto.createHash('sha256').update(token).digest('hex') });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-linked-'));
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify({ engineId: id, token }));
  const lk = new Link({ url: `http://127.0.0.1:${port}/`, dataDir: dir, handle: makeHandler(deps), journal: deps.journal, health: deps.health });
  return {
    target,
    link: lk,
    async start() {
      await lk.start();
      const ok = await until(async () => lk.live && (await hub.call(id, 'GET', '/health', null, 2000)).ok);
      if (!ok) throw new Error(`the engine ${id} did not link to the test's listener`);
    },
    stop() {
      lk.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { hubListener, linkedEngine, until };
