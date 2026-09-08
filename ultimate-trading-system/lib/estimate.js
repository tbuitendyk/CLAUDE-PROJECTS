// WHAT THE BOX HAS, right now: processors, memory, the heap ceiling this
// process runs under, and the disk under data/. A stage launch reads it to
// budget its heap and its rows (lib/stages.js). Free memory moves, so this is a
// reading rather than a promise, and it is labelled as one on the screen.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

// WHAT THE BOX HAS, right now. Free memory moves, so this is a reading rather
// than a promise, and it is labelled as one on the screen.
function boxResources() {
  let diskFreeBytes = null;
  let diskTotalBytes = null;
  try {
    const st = fs.statfsSync(DATA);
    diskFreeBytes = st.bavail * st.bsize;
    diskTotalBytes = st.blocks * st.bsize;
  } catch (_) { /* older node, or a filesystem that will not say */ }
  // The heap ceiling this process actually runs under, asked of the process
  // rather than read off a unit file that may have been edited since.
  let heapCeilingMb = null;
  try {
    const arg = process.execArgv.concat(process.argv).find((a) => /^--max-old-space-size=/.test(a));
    if (arg) heapCeilingMb = Number(arg.split('=')[1]);
    else heapCeilingMb = Math.round(require('v8').getHeapStatistics().heap_size_limit / 1048576);
  } catch (_) { /* leave it unknown rather than guess */ }
  return {
    cpus: os.cpus().length,
    memTotalMb: Math.round(os.totalmem() / 1048576),
    memFreeMb: Math.round(os.freemem() / 1048576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    heapCeilingMb,
    diskFreeBytes,
    diskTotalBytes,
  };
}

module.exports = { boxResources };
