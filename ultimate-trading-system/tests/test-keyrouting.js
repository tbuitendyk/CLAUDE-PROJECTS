// SAVING THE ROUTING MUST NOT DESTROY THE SUB-ACCOUNT KEY (found 2026-08-21).
//
// The sub-account reference never leaves the server — deliberately, and there
// is a test above this one that pins it. So the edit box on Setup detail cannot
// be pre-filled with it. It used to be filled with the PRESENCE MARKER instead:
// the server sent `keyRef: 'set'`, a field whose name says one thing and whose
// contents say another, and pressing "Save routing" wrote the word "set" over
// the setup's real sub-account reference.
//
// What made it dangerous rather than merely wrong: "set" is a non-empty string,
// so the setup stayed eligible to trade real money, now pointing at a
// sub-account that does not exist — and every screen went on reading
// "Key: set" in green exactly as before.
//
// Two things fix it and both are pinned here. Presence is reported under a name
// that says presence, so nothing can mistake it for the value. And an empty box
// means LEAVE IT ALONE, with clearing as its own deliberate act — the same rule
// the protective stop already follows: silence is not an instruction.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
const TRADE = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

module.exports = {
  // No field named keyRef may carry anything but the reference itself.
  async presenceIsReportedUnderANameThatSaysPresence() {
    assert.ok(/hasKeyRef: Boolean\(s\.keyRef\)/.test(ROUTES),
      'the list no longer reports the key as a presence flag');
    assert.ok(!/keyRef: s\.keyRef \? 'set' : null/.test(ROUTES),
      'a field called keyRef is carrying the word "set" again — an edit box filled from it will save that over the real reference');
  },

  // The box cannot be filled with something that would overwrite the real key.
  async theEditBoxStartsEmpty() {
    const i = TRADE.indexOf('id="keyIn"');
    assert.ok(i > 0, 'the sub-account key box is gone');
    const tag = TRADE.slice(i, TRADE.indexOf('>', i));
    assert.ok(/value=""/.test(tag),
      `the sub-account key box is pre-filled again (${tag.slice(0, 120)}) — whatever fills it gets saved over the real reference`);
  },

  // Saying nothing must change nothing.
  async anEmptyBoxLeavesTheKeyAlone() {
    assert.ok(/const keyRef=clearKey\?null:\(typedKey\|\|undefined\)/.test(TRADE),
      'an empty key box no longer means "leave it alone"');
    assert.ok(/if\(keyRef!==undefined\) body\.keyRef=keyRef;/.test(TRADE),
      'the save sends a key even when the owner typed none — silence is being treated as an instruction');
  },

  // And clearing must still be possible, deliberately.
  async clearingIsStillPossibleAndDeliberate() {
    assert.ok(/id="keyClear"/.test(TRADE),
      'there is no way to clear the sub-account key — the fix removed a control instead of making it explicit');
  },
};
