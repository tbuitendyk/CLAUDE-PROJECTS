// Campaign tagging + post-run notes (owner orders, 2026-08-04). QC 69 style:
// drive the real entry points against docs on disk.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const campaign = require('../lib/campaign');
const batch = require('../lib/batch');

const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');
const CAMP_FILE = path.join(__dirname, '..', 'data', 'campaign.json');

module.exports = {
  async campaignNamesAreSanitizedAndPersist() {
    const before = fs.existsSync(CAMP_FILE) ? fs.readFileSync(CAMP_FILE, 'utf8') : null;
    try {
      assert.strictEqual(campaign.setCampaign('  ltc-drill aug04  '), 'ltc-drill aug04');
      assert.strictEqual(campaign.getCampaign(), 'ltc-drill aug04');
      assert.throws(() => campaign.setCampaign('x'.repeat(41)), /40 characters/);
      assert.throws(() => campaign.setCampaign('bad|name'), /letters, numbers/);
      assert.strictEqual(campaign.setCampaign(''), '');
      assert.strictEqual(campaign.getCampaign(), '');
    } finally {
      if (before === null) fs.rmSync(CAMP_FILE, { force: true });
      else fs.writeFileSync(CAMP_FILE, before);
    }
  },
  async notesSaveOnFinishedRunsAndRefuseOnRunningOnes() {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
    const mk = (id, status) => {
      fs.writeFileSync(path.join(BATCH_DIR, `${id}.json`),
        JSON.stringify({ id, kind: 'bracketlab', status, startedAt: new Date().toISOString(), params: {}, leaders: [] }));
    };
    const doneId = 'bracketlab-20990101-0009-nt1';
    const runId = 'bracketlab-20990101-0010-nt2';
    try {
      mk(doneId, 'done');
      mk(runId, 'running');
      const out = batch.setBatchNotes(doneId, 'LTC neighborhood: recipe beat 13x wider menu; revisit trailing after minute data');
      assert.ok(/revisit trailing/.test(out.notes));
      assert.ok(out.notesEditedAt);
      const onDisk = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, `${doneId}.json`), 'utf8'));
      assert.ok(/revisit trailing/.test(onDisk.notes), 'notes must persist to the stored record');
      let err = null;
      try { batch.setBatchNotes(runId, 'x'); } catch (e) { err = e; }
      assert.ok(err && /still computing/.test(err.message), 'a running run must refuse note edits');
    } finally {
      for (const id of [doneId, runId]) fs.rmSync(path.join(BATCH_DIR, `${id}.json`), { force: true });
    }
  },
};
