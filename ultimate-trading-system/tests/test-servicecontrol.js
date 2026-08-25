// THE RESTART BUTTON, AND THE ONE SERVICE IT MAY TOUCH.
//
// It runs as root, so what matters is that it can do exactly one thing to
// exactly one service and nothing else can be got out of it. There is no unit
// parameter any more, which is most of the safety: there is nothing to point
// somewhere else. These pin that it stays that way.
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { assert } = require('./helpers');

const SVC = path.join(__dirname, '..', 'service-control', 'server.js');

// Load it with child_process.execFile swapped for a recorder, so no systemctl
// anywhere near a test run and the exact argument list is checked.
function withFakeSystemctl(stdout = 'active') {
  const cp = require('child_process');
  const real = cp.execFile;
  const calls = [];
  cp.execFile = (cmd, args, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    calls.push([cmd, ...args]);
    process.nextTick(() => done(null, stdout, ''));
  };
  delete require.cache[require.resolve(SVC)];
  const mod = require(SVC);
  return { mod, calls, restore: () => { cp.execFile = real; delete require.cache[require.resolve(SVC)]; } };
}

module.exports = {
  // The whole of it: one service, named here and nowhere else.
  async restartingTouchesTheTradingServiceAndNothingElse() {
    const { mod, calls, restore } = withFakeSystemctl();
    try {
      const r = await mod.restart();
      assert.strictEqual(r.code, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.unit, 'ultimate-trading-system.service');
      const changed = calls.filter((c) => ['restart', 'stop', 'start'].includes(c[1]));
      assert.deepStrictEqual(changed, [['systemctl', 'restart', 'ultimate-trading-system.service']],
        `expected one restart of one service and nothing else, got ${JSON.stringify(changed)}`);
    } finally { restore(); }
  },

  // NOTHING IN A REQUEST CAN CHANGE WHAT IT ACTS ON. This is the property that
  // replaced a name, a pattern to validate it against, a list of services it
  // was allowed to touch, and a list it was not: there is no name to send.
  async nothingSentInCanAimItAtAnotherService() {
    const { mod, calls, restore } = withFakeSystemctl();
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const post = (body) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/restart', headers: { 'Content-Type': 'application/json' } }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, b }));
      });
      req.on('error', () => resolve({ code: 0, b: '' }));
      req.end(body);
    });
    try {
      for (const body of ['{"unit":"nginx.service"}', '{"unit":"ssh.service","action":"stop"}',
        '{"unit":"nginx.service; rm -rf /"}', 'not json at all', '']) {
        calls.length = 0;
        const r = await post(body);
        assert.strictEqual(r.code, 200, `${body} answered ${r.code}`);
        const changed = calls.filter((c) => ['restart', 'stop', 'start'].includes(c[1]));
        assert.deepStrictEqual(changed, [['systemctl', 'restart', 'ultimate-trading-system.service']],
          `sending ${body} made it run ${JSON.stringify(changed)}`);
      }
    } finally {
      await new Promise((r) => srv.close(r));
      restore();
    }
  },

  // Only reading, and one kind of change.
  async itAnswersNothingButTheTwoThingsItIsFor() {
    const { mod, restore } = withFakeSystemctl();
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const call = (method, p) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: p }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', () => resolve(0));
      req.end();
    });
    try {
      assert.strictEqual(await call('DELETE', '/api/restart'), 405, 'DELETE was not turned away');
      assert.strictEqual(await call('PUT', '/api/state'), 405, 'PUT was not turned away');
      assert.strictEqual(await call('POST', '/api/anything-else'), 405, 'an unknown change was not turned away');
    } finally {
      await new Promise((r) => srv.close(r));
      restore();
    }
  },

  // It serves the trading system's pages so the button is reachable when that
  // service is not answering -- and nothing above them.
  async itCannotBeTalkedIntoServingAFileOutsideThePagesFolder() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-svc-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'construct.html'), '<html>the page</html>');
    fs.writeFileSync(path.join(dir, 'secret.html'), 'NOT FOR SERVING');
    const cp = require('child_process');
    const real = cp.execFile;
    cp.execFile = (c, a, o, cb) => process.nextTick(() => (typeof o === 'function' ? o : cb)(null, '', ''));
    process.env.UTS_PUBLIC = path.join(dir, 'public');
    delete require.cache[require.resolve(SVC)];
    const mod = require(SVC);
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    // Sent raw, because a client library would tidy the dots away before the
    // request left -- and tidying them away is the thing being tested.
    const get = (p) => new Promise((resolve) => {
      const sock = require('net').connect(port, '127.0.0.1', () => {
        sock.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      });
      let buf = '';
      sock.on('data', (c) => { buf += c; });
      sock.on('end', () => resolve(buf));
      sock.on('error', () => resolve(''));
    });
    try {
      const ok = await get('/construct.html');
      assert.ok(/the page/.test(ok), `the ordinary page did not come back: ${ok.slice(0, 200)}`);
      for (const p of ['/../secret.html', '/..%2fsecret.html', '/public/../../secret.html', '/./../secret.html']) {
        const body = await get(p);
        assert.ok(!/NOT FOR SERVING/.test(body), `${p} served a file outside the pages folder`);
      }
    } finally {
      await new Promise((r) => srv.close(r));
      cp.execFile = real;
      delete process.env.UTS_PUBLIC;
      delete require.cache[require.resolve(SVC)];
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },

  // The button is reachable at two addresses and asks by a path relative to
  // where it was loaded. Both must land on the same handler, or it works from
  // one and silently not from the other -- and the other is the one that
  // matters, because it is the one used when the service is down.
  async theSameRequestWorksFromBothAddresses() {
    const { mod, restore } = withFakeSystemctl();
    const srv = mod.server;
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const post = (p) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: p }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, b }));
      });
      req.on('error', () => resolve({ code: 0, b: '' }));
      req.end('{}');
    });
    try {
      for (const p of ['/api/restart', '/svc/api/restart']) {
        const r = await post(p);
        assert.strictEqual(r.code, 200, `${p} answered ${r.code}`);
        assert.strictEqual(JSON.parse(r.b).unit, 'ultimate-trading-system.service');
      }
    } finally {
      await new Promise((r) => srv.close(r));
      restore();
    }
  },

  // The button must go through the SEPARATE program. Pointed back at the main
  // app it becomes a dead button -- that service is not permitted to run
  // systemctl, and if it were it would not be answering when this is pressed.
  async theButtonGoesThroughTheSeparateProgramAndNotTheMainApp() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    const at = src.indexOf("const kick = $('#bKick')");
    assert.ok(at > 0, 'the restart control is gone from Boards');
    const body = src.slice(at, at + 1600).replace(/\/\/[^\n]*/g, '');
    assert.ok(/tryPost\('svc\/api\/restart'/.test(body),
      'the restart control no longer goes through the separate program');
    assert.ok(!/tryPost\('api\//.test(body),
      'the restart control goes through the main app, which cannot do it and will be down anyway');
  },

  // The unit that runs it has to come back on its own: it is the way back.
  async theControlsOwnUnitAlwaysRestartsAndIsTiny() {
    const unit = fs.readFileSync(path.join(__dirname, '..', 'service-control', 'uts-service-control.service'), 'utf8');
    assert.ok(/^Restart=always$/m.test(unit), 'the control does not restart itself on failure');
    assert.ok(/^StartLimitIntervalSec=0$/m.test(unit),
      'the control can be parked by repeated failures, which would leave no way back at all');
    assert.ok(/^User=root$/m.test(unit), 'the control cannot run systemctl without being root');
    assert.ok(/^MemoryMax=/m.test(unit), 'the control has no ceiling on what it may take');
  },

  // No dependencies: it has to start on a machine where the main app's own
  // install is broken.
  async theControlPullsInNothingButNodeItself() {
    const src = fs.readFileSync(SVC, 'utf8');
    const required = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    const outside = required.filter((r) => !r.startsWith('.') && !['http', 'fs', 'path', 'child_process', 'net', 'os', 'url'].includes(r));
    assert.deepStrictEqual(outside, [],
      `the control now depends on ${outside.join(', ')} — it has to start when nothing else can`);
  },

  // AND IT STAYS SMALL. It grew into a screen of its own listing 153 services
  // with start and stop on every one, which was junk in a trading application
  // and was thrown out. A ceiling on its size is a cruder guard than a test,
  // and it is the one that would have caught that.
  async itHasNotGrownBackIntoAServiceBrowser() {
    const src = fs.readFileSync(SVC, 'utf8');
    const code = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
    assert.ok(code < 120, `the control is ${code} lines of code. It restarts one service; if it needs more than this it has become something else again.`);
    for (const gone of ['list-units', 'watching', 'CANNOT_STOP', 'UNIT_RE']) {
      assert.ok(!src.includes(gone), `"${gone}" is back — this is the service browser growing again`);
    }
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(!/drawService|svcPick|'service'/.test(page), 'the Service tab is back on the page');
    assert.ok(!/\['service', 'Service'\]/.test(page), 'the Service tab is back in the tab strip');
  },
};
