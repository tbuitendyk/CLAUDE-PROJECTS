// WHAT THE BOX HAS, read for the stage launches: lib/stages.js budgets its heap
// and its rows from it. The older sweep engine's cost estimate went with that
// engine (3.97.0); this reading is what remained of its module.
const { assert } = require('./helpers');
const { boxResources } = require('../lib/estimate');

module.exports = {
  itReportsWhatTheBoxHasNotJustWhatTheRunWants() {
    const b = boxResources();
    assert.ok(b.memTotalMb > 0 && b.memFreeMb > 0, 'memory, so a launch can be judged against it');
    assert.ok(b.cpus > 0, 'and the processors it will share');
    assert.ok(b.diskFreeBytes === null || b.diskFreeBytes > 0, 'and the disk, or nothing rather than a wrong number');
    assert.ok(b.heapCeilingMb > 0, 'and the ceiling that killed the first wide sweep');
  },
};
