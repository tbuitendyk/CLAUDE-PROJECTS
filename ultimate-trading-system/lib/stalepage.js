// A PAGE OLDER THAN THE BOX IS REFUSED, NOT SERVED (3.137.0, owner order
// 2026-09-14: "could you please do this right already?"). Three times in one
// evening a press on the Funnel was pressed on a page loaded BEFORE the deploy
// that had just changed it, and asked the new engine the old question; the last
// time, by the run's own stamp, 88 seconds after the engine came back. "Reload
// the page" was advice, and advice is not a mechanism.
//
// Every page the engine serves is stamped with the release it was served under;
// every ask the page makes carries that stamp back; an ask stamped with another
// release is refused with one answer, and the page reloads itself on that
// answer. An ask with no stamp -- a script, a probe, the always-up program's
// copy of Setup -- is not a page and is never refused.
'use strict';

const HEADER = 'x-uts-release';
const META = 'uts-release';

function refusal(seen, here) {
  if (!seen || String(seen) === String(here)) return null;
  return {
    code: 409,
    body: {
      error: `this page was loaded under release ${seen} and the box now runs ${here} — reload the page`,
      stalePage: true,
      release: String(here),
    },
  };
}

// The stamp goes into the page's head, where the page can read it before it
// asks anything. A page without the charset line is left as it is.
function stamp(html, here) {
  return String(html).replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta name="${META}" content="${here}">`);
}

module.exports = { HEADER, META, refusal, stamp };
