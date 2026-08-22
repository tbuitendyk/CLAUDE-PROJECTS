// Moved to lib/screencontrols.js, because the Help tab reads it at runtime and
// production code must not reach into the test folder. Re-exported here so the
// tests keep their own name for it and there is still only one reader.
module.exports = require('../lib/screencontrols');
