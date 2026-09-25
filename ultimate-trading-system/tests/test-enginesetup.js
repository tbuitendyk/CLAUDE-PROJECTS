// SETTING UP A TRADING ENGINE, STEP BY STEP (3.263.0, owner 2026-09-25): the
// checklist on Setup > Compute, one per engine -- the template, where each
// checklist stands, what a locked step refuses, and the page that draws it.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_ENGINE_SETUPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-'));
const es = require('../lib/live/enginesetup');
const refused = (fn, rx) => { let err = null; try { fn(); } catch (e) { err = e; } assert.ok(err && rx.test(err.message), `refused in words matching ${rx}: ${err && err.message}`); return err; };

module.exports = {
  // THE TEMPLATE: step 1 written in full, steps 2 to 7 titles still being written
  theTemplateHasStepOneInFullAndTheRestStillBeingWritten() {
    const [first, ...rest] = es.TEMPLATE.steps;
    assert.strictEqual(first.title, 'Here\'s what you need to get your trading engine off the ground');
    assert.deepStrictEqual(first.choices.map((c) => [c.id, c.options.map((o) => o.label)]), [['where', ['a rented server', 'this computer']], ['os', ['Linux', 'Mac', 'Windows']]]);
    assert.deepStrictEqual(first.choices[1].when, { where: 'local' }, 'the operating system is asked for this computer');
    assert.deepStrictEqual(first.ticks.map((t) => t.label), ['Binance serves me there, and I may use it there', 'It has a fixed public IP address', 'It will be on and online around the clock', 'It meets the size above']);
    assert.deepStrictEqual(rest.map((s) => [s.title, s.writing]), [['Let the system in', true], ['Check the machine', true], ['Install the engine', true], ['Link it to this system', true], ['Save the engine', true], ['Keep it current', true]]);
    const words = JSON.stringify(first.guidance);
    for (const w of ['fixed public IP address', 'Elastic IP', 'Debian 12 or 13', 'Ubuntu 24.04', '300 MB', 'static one', 'Mac:', 'Windows:', 'Linux:']) assert.ok(words.includes(w), `step 1 says ${w}`);
  },

  // ONE PER ENGINE, and each step opens only when the one before it is done
  aChecklistOpensEachStepOnlyWhenTheOneBeforeIsDone() {
    const a = es.create('Mexico engine', 'mx-engine-2');
    assert.deepStrictEqual(a.steps.map((s) => [s.open, s.done]), [[true, false], [false, false], [false, false], [false, false], [false, false], [false, false], [false, false]]);
    refused(() => es.create(' mexico ENGINE ', 'other'), /already a setup for an engine called "Mexico engine" — one per engine/);
    refused(() => es.create('', 'other'), /^descriptive name: 1 to 60 characters$/);
    refused(() => es.create('Another', 'Not Short'), /^short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit$/);
    refused(() => es.create('Another', 'mx-engine-2'), /short name: mx-engine-2 is already the short name of the setup for "Mexico engine"/);
    refused(() => es.create('Another', 'mx-1'), /mx-1 is the old order program/);
    refused(() => es.setTick(a.id, 'access', 'x', true), /^step 2 opens when step 1 is done$/);
    refused(() => es.setChoice(a.id, 'ready', 'os', 'mac'), /^its operating system is asked only when where it runs is this computer$/);
    refused(() => es.setChoice(a.id, 'ready', 'where', 'moon'), /one of a rented server, this computer/);
    refused(() => es.setTick(a.id, 'ready', 'nope', true), /has no tick nope/);
    es.setChoice(a.id, 'ready', 'where', 'local');
    assert.ok(es.get(a.id).steps[0].missing.includes('choose its operating system'), 'this computer asks its operating system');
    es.setChoice(a.id, 'ready', 'os', 'windows');
    for (const t of ['binance', 'ip', 'on']) es.setTick(a.id, 'ready', t, true);
    assert.deepStrictEqual(es.get(a.id).steps[0].missing, ['tick "It meets the size above"']);
    const done = es.setTick(a.id, 'ready', 'size', true);
    assert.deepStrictEqual(done.steps.slice(0, 3).map((s) => [s.open, s.done]), [[true, true], [true, false], [false, false]], 'step 1 done opens step 2; step 2 is still being written');
    assert.deepStrictEqual(done.steps[1].missing, ['this step is still being written']);
    // changing where it runs clears the ticks and the operating system: they were about the other machine
    const moved = es.setChoice(a.id, 'ready', 'where', 'server');
    assert.deepStrictEqual([moved.choices, moved.ticks.ready], [{ where: 'server' }, {}]);
    assert.deepStrictEqual(moved.steps.map((s) => s.open), [true, false, false, false, false, false, false]);
    // kept on this machine, and taken away
    assert.strictEqual(es.list().length, 1);
    assert.deepStrictEqual(es.remove(a.id), { ok: true, id: a.id });
    assert.strictEqual(es.list().length, 0);
    refused(() => es.get('../../etc/passwd'), /no engine setup/);
  },

  // THE PAGE: the button in The trading engine section opens and closes the
  // area; the steps come from the template; a button never shares a row with a field
  theComputeTabOpensTheChecklistFromItsButton() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const engine = src.slice(src.indexOf('function engineHtml('), src.indexOf('function wireEs('));
    assert.ok(/\+ esHtml\(\)/.test(engine), 'the area is drawn inside The trading engine section');
    assert.ok(/<button id="esToggle"[^>]*>' \+ \(cEsOpen \? '▾' : '▸'\) \+ ' Set up a trading engine<\/button>/.test(src), 'one button opens and closes it');
    assert.ok(/localStorage\.setItem\('setup-es-open'/.test(src), 'open or closed is remembered for this viewer');
    assert.ok(/getJson\('api\/live\/engine-setups'\)/.test(src) && /esSetupHtml\(sel, cEs\.template\)/.test(src), 'the steps are the service\'s template');
    assert.ok(/<div class="row" style="margin-top:\.5rem"><button id="esStart">Start its setup<\/button>/.test(src), 'Start its setup has a row of its own');
    assert.ok(/<div class="row" style="margin-top:\.9rem"><button id="esDelete" class="danger"/.test(src), 'Delete this setup has a row of its own');
    assert.ok(/opens when step ' \+ i \+ ' is done/.test(src) && /This step is still being written\./.test(src), 'a locked step and a step still being written say so');
  },
};

// THE ENGINE'S TWO NAMES (3.264.0): asked when a setup starts; a checklist
// started before they were asked for is given its short name on screen
module.exports.aChecklistCarriesTheEnginesTwoNames = function () {
  const dir = process.env.GC_ENGINE_SETUPS_DIR;
  const id = 'es-muhgabc1-a1b2c3';
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, name: 'CDMX UTS Trading Engine (AWS)', templateVersion: 1, createdUtc: '2026-09-25T20:55:00.000Z', updatedUtc: '2026-09-25T20:55:00.000Z', engineId: null, choices: {}, ticks: {} }));
  assert.strictEqual(es.get(id).shortName, undefined);
  refused(() => es.setShortName(id, 'CDMX'), /^short name: 2 to 30/);
  assert.strictEqual(es.setShortName(id, 'cdmx-engine').shortName, 'cdmx-engine');
  const b = es.create('Second engine', 'second-engine');
  refused(() => es.setShortName(b.id, 'cdmx-engine'), /already the short name of the setup for "CDMX UTS Trading Engine \(AWS\)"/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  assert.ok(/setups\.length > 1\s*\? '<div class="row" style="margin-bottom:\.5rem"><label class="c"><span class="muted">show the checklist for<\/span>/.test(src), 'the picker shows only with more than one checklist');
  assert.ok(/<b style="font-size:\.95rem">' \+ esc\(sel\.name\) \+ '<\/b>/.test(src), 'the checklist is headed with its engine\'s name');
  assert.ok(/id="esShortFix"/.test(src) && /<button id="esShortSave">Save the short name<\/button>/.test(src), 'a checklist without a short name asks for it');
  assert.ok(/<button id="esNewToggle"[^>]*>' \+ \(cEsNew \? '▾' : '▸'\) \+ ' Set up another engine<\/button>/.test(src), 'another engine is set up behind its own button');
  assert.ok(!/name for the new engine/.test(src), 'the name box that read as this engine\'s second name is gone');
  es.remove(id); es.remove(b.id);
};
