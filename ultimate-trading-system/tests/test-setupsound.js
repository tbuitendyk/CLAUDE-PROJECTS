// A STORED SETUP IS CHECKED ON THE WAY BACK IN (found 2026-08-21).
//
// There was no reader-side checking at all. Sixteen of eighteen deliberately
// broken files read back as ordinary setups, went onto the screen, and went
// into the list the box trades from. The three that matter most: a state
// nobody recognises (which hid a live real-money channel from the Trading tab
// while it kept trading), an id that disagrees with its own filename (listed
// and allowlisted, but every control on it answers "not found"), and two files
// claiming one id (the screen reads one, the box reads the other, and stopping
// it stops only one of them).
//
// The rule this pins: nothing is dropped in silence, and nothing unsound
// trades. A broken record stays visible and carries WHY, and the door into a
// trading state refuses it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');

function withSetups(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-sound-'));
  const prev = process.env.GC_SETUPS_DIR;
  process.env.GC_SETUPS_DIR = dir;
  delete require.cache[require.resolve(path.join(ROOT, 'lib', 'live', 'setups'))];
  try { return fn(dir, require(path.join(ROOT, 'lib', 'live', 'setups'))); }
  finally {
    if (prev === undefined) delete process.env.GC_SETUPS_DIR; else process.env.GC_SETUPS_DIR = prev;
    delete require.cache[require.resolve(path.join(ROOT, 'lib', 'live', 'setups'))];
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const { GEOMETRIES } = require(path.join(ROOT, 'lib', 'dataset'));
const geometry = Object.keys(GEOMETRIES)[0];
// The pair and the cell shape here are the ones the live executor can actually
// carry out, and the pair is one the default target box serves. My first
// version used neither, so the control case was refused by the EXECUTOR gate
// and read as my own change breaking the real control. It was the fixture.
const goodConfig = () => ({
  combo: { trade: 'LTCUSDT', ctx1: 'ETHUSDT', ctx2: 'BNBUSDT', size: 3 },
  branch: { geometry, decision: 'argmax', band: 0.5, weekdaysOnly: false },
  stage: 'slim',
  members: [{ model: 'logreg', view: 'full' }],
  cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: null, tHours: 8, trailMult: null, armMult: null },
  configVersion: 'v1',
});
const rec = (over = {}) => ({
  schema: 1, id: 'good-one', ownerId: 'owner', name: 'a book', state: 'draft',
  configSnapshot: goodConfig(), tradedPair: 'LTCUSDT', clipUsd: 100, stopPct: 0.02,
  keyRef: 'sub-account-1', executionTargetRef: null, provenanceRef: null,
  createdUtc: '2026-01-01T00:00:00Z', trainPolicy: { mode: 'rolling' }, stateHistory: [], ...over,
});
const write = (dir, name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));

module.exports = {
  // The control. If a sound record does not read back clean, nothing below means anything.
  async aSoundRecordReadsBackWithNothingWrong() {
    withSetups((dir, reg) => {
      write(dir, 'good-one.json', rec());
      const { setups } = reg.readSetups();
      assert.strictEqual(setups.length, 1, 'a sound record did not read back');
      assert.deepStrictEqual(setups[0].__problems, [],
        `a sound record was reported as broken: ${JSON.stringify(setups[0].__problems)}`);
    });
  },

  // Nothing vanishes. The first attempt at this filtered broken records out of
  // the list, which is the same fault the other way round.
  async abrokenRecordIsKeptAndSaysWhatIsWrong() {
    withSetups((dir, reg) => {
      write(dir, 'rogue.json', rec({ id: 'rogue', state: 'ARMED' }));
      const { setups } = reg.readSetups();
      assert.strictEqual(setups.length, 1, 'a record with an unrecognised state VANISHED from the list');
      assert.ok(setups[0].__problems.length, 'a record with an unrecognised state reads back as sound');
      assert.ok(/state/.test(setups[0].__problems.join(' ')), 'the reason does not mention the state');
    });
  },

  async anIdThatDisagreesWithItsFilenameIsCalledOut() {
    withSetups((dir, reg) => {
      write(dir, 'on-disk.json', rec({ id: 'in-the-record' }));
      const { setups } = reg.readSetups();
      assert.ok(setups[0].__problems.some((p) => /stored as on-disk\.json/.test(p)),
        'a record whose id disagrees with its filename reads back as sound — every control on it answers "not found"');
    });
  },

  async twoFilesClaimingOneIdAreBothRefused() {
    withSetups((dir, reg) => {
      write(dir, 'twin.json', rec({ id: 'twin', clipUsd: 10 }));
      write(dir, 'twin-copy.json', rec({ id: 'twin', clipUsd: 250000 }));
      const { setups } = reg.readSetups();
      assert.strictEqual(setups.length, 2, 'both files should still be visible');
      for (const s of setups) {
        assert.ok(s.__problems.some((p) => /all claim to be the setup/.test(p)),
          'two files claiming one id read back as sound — the screen reads one and the box reads the other');
      }
      assert.strictEqual(reg.tradableSetups().length, 0, 'a doubled id is still allowed to trade');
    });
  },

  // The point of all of it.
  async anUnsoundRecordCannotEnterATradingState() {
    withSetups((dir, reg) => {
      write(dir, 'rogue.json', rec({ id: 'rogue', clipUsd: '50' })); // a dollar size stored as text
      let err = null;
      try { reg.transition('rogue', 'paper'); } catch (e) { err = e; }
      assert.ok(err, 'a record whose dollar size is text was allowed into a trading state');
      assert.strictEqual(err.code, 'UNSOUND_RECORD', `refused for the wrong reason: ${err.message}`);
    });
  },

  // A sound one still must be able to.
  async aSoundRecordStillGoesToPaper() {
    withSetups((dir, reg) => {
      write(dir, 'good-one.json', rec());
      const out = reg.transition('good-one', 'paper');
      assert.strictEqual(out.state, 'paper', 'a sound record can no longer be put on paper — the fix broke the real control');
    });
  },

  // The record's own id used to reach the filesystem after only the id in the
  // web address had been checked.
  async anIdCannotClimbOutOfTheFolder() {
    withSetups((dir, reg) => {
      let threw = false;
      try { reg.transition('../../escape', 'paper'); } catch (_) { threw = true; }
      assert.ok(threw, 'an id containing a path was not refused');
      assert.ok(!fs.existsSync(path.join(dir, '..', '..', 'escape.json')), 'a file was written outside the folder');
    });
  },
};
