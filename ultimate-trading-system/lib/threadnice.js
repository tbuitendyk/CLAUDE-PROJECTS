// The kernel's own nice value for the CALLING thread.
//
// Why this exists as its own module rather than living in worker.js: worker.js
// renices to 19 at require() time, so anything on the main thread that
// required it in order to reuse a helper would silently renice the web server
// to the floor. Keeping the helper here makes that mistake impossible.
//
// Why procfs rather than os.getPriority(): getPriority() reports what Node
// believes, which would agree with the code even on a platform that ignored
// the setpriority() call. This reports what the scheduler will actually act
// on. On anything without procfs it returns nulls, and callers must say
// "unverifiable" rather than treating that as a pass.
const fs = require('fs');

function threadNice() {
  try {
    // /proc/thread-self resolves to the calling thread's own directory, which
    // is the piece JS otherwise has no way to name (there is no gettid()).
    const stat = fs.readFileSync('/proc/thread-self/stat', 'utf8');
    const tid = Number(stat.slice(0, stat.indexOf(' ')));
    // Field 19 (1-indexed) is nice. Parse AFTER the comm field, which is
    // parenthesised and may itself contain spaces or ')', so splitting the
    // whole line on spaces would misalign every field after it.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const nice = Number(fields[16]);
    return {
      tid: Number.isFinite(tid) ? tid : null,
      nice: Number.isFinite(nice) ? nice : null,
    };
  } catch {
    return { tid: null, nice: null };
  }
}

module.exports = { threadNice };
