// CAMPAIGNS: A NEW NAME IS A CAMPAIGN, AND A CAMPAIGN CAN BE DELETED
// (owner, 2026-08-21).
//
// Two faults, one file.
//
// FIRST: the name catalogue was computed entirely from runs and greenlights
// that already carried the stamp. Right for those, wrong for a name that has
// just been Set — a brand new campaign owns nothing yet, so it appeared in no
// list and had to be retyped until the first run existed.
//
// SECOND: there was no way to remove a campaign at all. Deleting the name alone
// would have been worse than nothing: the runs, greenlights and setups beneath
// it would stay, each naming a campaign that no longer exists.
//
// The rule the delete follows: say what will go BEFORE asking, take the whole
// chain, and refuse outright while any setup minted from it is still deployed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');

// A throwaway data folder. campaign.json and the batches live at fixed paths
// under data/, so the whole module is re-required against a scratch copy.
function withScratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uts-camp-'));
  const realData = path.join(ROOT, 'data');
  const stash = `${realData}.stash-${process.pid}`;
  const hadData = fs.existsSync(realData);
  if (hadData) fs.renameSync(realData, stash);
  fs.mkdirSync(path.join(realData, 'batches'), { recursive: true });
  fs.mkdirSync(path.join(realData, 'models'), { recursive: true });
  const gdir = path.join(dir, 'gl'); const sdir = path.join(dir, 'su');
  fs.mkdirSync(gdir); fs.mkdirSync(sdir);
  const prevG = process.env.GC_GREENLIGHTS_DIR; const prevS = process.env.GC_SETUPS_DIR;
  process.env.GC_GREENLIGHTS_DIR = gdir; process.env.GC_SETUPS_DIR = sdir;
  const fresh = (m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; return require(path.join(ROOT, m)); };
  ['lib/campaign', 'lib/batch', 'lib/live/greenlight', 'lib/live/setups'].forEach((m) => {
    delete require.cache[require.resolve(path.join(ROOT, m))];
  });
  try {
    return fn({ dir, gdir, sdir, realData, campaign: fresh('lib/campaign') });
  } finally {
    if (prevG === undefined) delete process.env.GC_GREENLIGHTS_DIR; else process.env.GC_GREENLIGHTS_DIR = prevG;
    if (prevS === undefined) delete process.env.GC_SETUPS_DIR; else process.env.GC_SETUPS_DIR = prevS;
    fs.rmSync(realData, { recursive: true, force: true });
    if (hadData) fs.renameSync(stash, realData);
    fs.rmSync(dir, { recursive: true, force: true });
    ['lib/campaign', 'lib/batch', 'lib/live/greenlight', 'lib/live/setups'].forEach((m) => {
      delete require.cache[require.resolve(path.join(ROOT, m))];
    });
  }
}

const writeRun = (realData, id, camp) => fs.writeFileSync(path.join(realData, 'batches', `${id}.json`),
  JSON.stringify({ id, kind: 'bracketlab', status: 'done', startedAt: '2026-01-01T00:00:00Z', params: { campaign: camp }, runs: [] }));
const writeGl = (gdir, id, camp) => fs.writeFileSync(path.join(gdir, `${id}.json`),
  JSON.stringify({ id, campaign: camp, createdUtc: '2026-01-02T00:00:00Z', name: 'g', why: 'w', configSnapshot: {} }));
const writeSetup = (sdir, id, glId, state) => fs.writeFileSync(path.join(sdir, `${id}.json`),
  JSON.stringify({ schema: 1, id, ownerId: 'o', name: id, state, provenanceRef: glId, configSnapshot: {}, clipUsd: 10, createdUtc: '2026-01-03T00:00:00Z', stateHistory: [] }));

module.exports = {
  // FAULT ONE.
  async aNameThatHasJustBeenSetAppearsInTheList() {
    withScratch(({ campaign }) => {
      assert.deepStrictEqual(campaign.listCampaignNames(), [], 'the box should start with no campaigns');
      campaign.setCampaign('Initial UTS Run');
      assert.deepStrictEqual(campaign.listCampaignNames(), ['Initial UTS Run'],
        'a campaign that was just Set does not appear in the list — the owner has to retype it until a run exists');
    });
  },

  // THE ONE THAT WAS ACTUALLY BROKEN ON THE BOX. A campaign set before the
  // declared list existed leaves a stored file with a name and no list — and
  // the first fix only wrote the list on the NEXT Set, so the campaign already
  // in use stayed invisible and the screen still counted zero.
  async aCampaignSetBeforeThisListExistedIsStillOffered() {
    withScratch(({ campaign, realData }) => {
      fs.writeFileSync(path.join(realData, 'campaign.json'),
        JSON.stringify({ name: 'Initial UTS Run', setAt: '2026-08-21T23:51:24.864Z' }));
      assert.deepStrictEqual(campaign.listCampaignNames(), ['Initial UTS Run'],
        'a campaign that was set before the list existed is not offered — the screen counts zero while one is in use');
    });
  },

  // A name with real activity must still sort above one that has none.
  async aNameWithRunsSortsAboveAFreshOne() {
    withScratch(({ campaign, realData }) => {
      writeRun(realData, 'bracketlab-1', 'Older With Work');
      campaign.setCampaign('Brand New');
      const names = campaign.listCampaignNames();
      assert.deepStrictEqual(names, ['Older With Work', 'Brand New'],
        `a campaign with activity should come first: ${JSON.stringify(names)}`);
    });
  },

  // FAULT TWO — the count, before anything is removed.
  async theSummarySaysExactlyWhatWouldGo() {
    withScratch(({ campaign, realData, gdir, sdir }) => {
      writeRun(realData, 'bracketlab-a', 'Doomed');
      writeRun(realData, 'bracketlab-b', 'Doomed');
      writeRun(realData, 'bracketlab-c', 'Survivor');
      writeGl(gdir, 'gl-1', 'Doomed');
      writeSetup(sdir, 'setup-one', 'gl-1', 'draft');
      const found = campaign.campaignContents('Doomed');
      assert.strictEqual(found.counts.runs, 2, 'wrong run count');
      assert.strictEqual(found.counts.greenlights, 1, 'wrong greenlight count');
      assert.strictEqual(found.counts.setups, 1, 'wrong setup count');
      assert.strictEqual(found.locked, false, 'a draft setup must not lock the campaign');
    });
  },

  // THE ONE THAT MUST NEVER FAIL OPEN.
  async aDeployedSetupLocksTheCampaign() {
    for (const state of ['paper', 'live', 'stopped']) {
      withScratch(({ campaign, realData, gdir, sdir }) => {
        writeRun(realData, 'bracketlab-a', 'Locked');
        writeGl(gdir, 'gl-1', 'Locked');
        writeSetup(sdir, 'setup-one', 'gl-1', state);
        const found = campaign.campaignContents('Locked');
        assert.strictEqual(found.locked, true, `a setup in state "${state}" did not lock the campaign`);
        let err = null;
        try { campaign.deleteCampaign('Locked'); } catch (e) { err = e; }
        assert.ok(err, `deleting was allowed with a setup in state "${state}"`);
        assert.strictEqual(err.code, 'CAMPAIGN_LOCKED', `refused for the wrong reason: ${err.message}`);
        assert.ok(/Trade tab/.test(err.message), 'the message does not say where to go to fix it');
        // And nothing may have gone.
        assert.ok(fs.existsSync(path.join(realData, 'batches', 'bracketlab-a.json')),
          `the run was deleted even though the campaign was locked (state "${state}")`);
      });
    }
  },

  // A finished setup is not a deployed one.
  async aRetiredSetupDoesNotLockIt() {
    withScratch(({ campaign, gdir, sdir }) => {
      writeGl(gdir, 'gl-1', 'Finished');
      writeSetup(sdir, 'setup-one', 'gl-1', 'retired');
      assert.strictEqual(campaign.campaignContents('Finished').locked, false,
        'a retired setup should not lock the campaign — it is finished, not running');
    });
  },

  // The whole chain goes, and nothing belonging to anyone else does.
  async deletingTakesTheChainAndLeavesOtherCampaignsAlone() {
    withScratch(({ campaign, realData, gdir, sdir }) => {
      writeRun(realData, 'bracketlab-a', 'Doomed');
      writeRun(realData, 'bracketlab-c', 'Survivor');
      writeGl(gdir, 'gl-1', 'Doomed');
      writeGl(gdir, 'gl-2', 'Survivor');
      writeSetup(sdir, 'setup-one', 'gl-1', 'draft');
      fs.mkdirSync(path.join(realData, 'models', 'bracketlab-a'), { recursive: true });
      fs.writeFileSync(path.join(realData, 'models', 'bracketlab-a', 'm.json'), '{}');
      campaign.setCampaign('Doomed');

      const out = campaign.deleteCampaign('Doomed');
      assert.strictEqual(out.removed.runs, 1, 'the run was not removed');
      assert.strictEqual(out.removed.greenlights, 1, 'the greenlight was not removed');
      assert.strictEqual(out.removed.setups, 1, 'the setup was not removed');
      assert.ok(!fs.existsSync(path.join(realData, 'batches', 'bracketlab-a.json')), 'the run file is still there');
      assert.ok(!fs.existsSync(path.join(realData, 'models', 'bracketlab-a')), 'the saved models are still there');
      assert.ok(!fs.existsSync(path.join(gdir, 'gl-1.json')), 'the greenlight file is still there');
      assert.ok(!fs.existsSync(path.join(sdir, 'setup-one.json')), 'the setup file is still there');

      // The other campaign is untouched.
      assert.ok(fs.existsSync(path.join(realData, 'batches', 'bracketlab-c.json')), 'another campaign lost a run');
      assert.ok(fs.existsSync(path.join(gdir, 'gl-2.json')), 'another campaign lost a greenlight');

      assert.strictEqual(campaign.getCampaign(), '', 'the deleted campaign is still the one in use');
      assert.ok(!campaign.listCampaignNames().includes('Doomed'), 'the deleted name is still offered');
    });
  },
};
