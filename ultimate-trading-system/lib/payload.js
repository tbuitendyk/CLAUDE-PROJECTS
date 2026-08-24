// WHAT GETS SENT TO A BROWSER, AND HOW MUCH OF IT (owner order, 2026-08-23:
// "fix that so the system always chunk data PROPERLY to browsers").
//
// The Construct page asked for one run's replication table and the server
// assembled a 99 MB reply: 2,772 configurations, each carrying up to 60 example
// rows. Nothing was wrong with any single line of that code — the reply simply
// grew with the run, and no one part of it was the part that was too big.
//
// Two faults, and they are different:
//
//   THE ONE THAT WAS FOUND. Three endpoints shipped collections whose size
//   follows the run. The replication table above; the runs picker, which
//   carries every run's full parameters including the expanded declared set
//   (500 KB on the current run, x18 runs = 9 MB) and is fetched on every draw
//   of three separate sections; and a single run's document, which carries the
//   same expanded set again.
//
//   THE ONE THAT MATTERS MORE. Nothing anywhere measured a reply. A payload
//   could grow by a factor of a thousand and the only symptom was a screen
//   that took longer, then a screen that never arrived. So this file also
//   holds a guard that measures EVERY json reply, warns while a reply is
//   merely getting fat, and refuses one that has become absurd — naming the
//   route, so the next one is a message instead of a hang.
//
// The rule both halves share: NEVER TRUNCATE SILENTLY. A page of rows always
// says how many rows there are in total, because a short list that looks
// complete is worse than no list at all.

// The soft line: a reply above this is logged with its route. Chosen so the
// ordinary ones (a board of 50 rows, a status payload) never trip it and
// anything that has started growing does.
const WARN_BYTES = 1 << 20;          // 1 MB

// The hard line: above this the reply is refused. Deliberately far above any
// legitimate answer — nothing this system needs to show a person is 8 MB — so
// hitting it means a collection is being shipped whole that should be paged.
const MAX_BYTES = 8 * (1 << 20);     // 8 MB

// Paging defaults. `max` is what a caller may ask for at most, so a hand-typed
// ?limit=999999 cannot re-create the fault the paging exists to remove.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

function clampInt(v, lo, hi, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// ONE SHAPE FOR EVERY PAGED LIST, so a screen that can read one can read all of
// them, and so `total` is always present. `shown` and `more` are derived rather
// than left for each caller to work out and get subtly different.
function page(rows, query = {}, opts = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const maxLimit = opts.maxLimit || MAX_LIMIT;
  const offset = clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInt(query.limit, 1, maxLimit, opts.defaultLimit || DEFAULT_LIMIT);
  const slice = all.slice(offset, offset + limit);
  return {
    rows: slice,
    total: all.length,
    offset,
    limit,
    shown: slice.length,
    more: offset + slice.length < all.length,
  };
}

// THE GUARD. Wraps res.json once, for every route, so a new endpoint is covered
// the day it is written rather than the day somebody remembers.
//
// It refuses rather than truncating. A truncated reply is a wrong answer with
// the right shape, which is the failure this whole file exists to prevent; an
// error naming the route and the size is something a person can act on.
function installPayloadGuard(app, { warnBytes = WARN_BYTES, maxBytes = MAX_BYTES, log = console.warn } = {}) {
  app.use((req, res, next) => {
    const send = res.json.bind(res);
    res.json = (body) => {
      let text;
      try {
        text = JSON.stringify(body);
      } catch (err) {
        // A reply that cannot be serialised is a fault of its own; let the
        // ordinary path raise it rather than hiding it behind a size check.
        return send(body);
      }
      const bytes = Buffer.byteLength(text || '', 'utf8');
      const where = `${req.method} ${req.route ? req.route.path : req.path}`;
      if (bytes > maxBytes) {
        log(`[payload] REFUSED ${where}: ${(bytes / 1e6).toFixed(1)} MB is over the ${(maxBytes / 1e6).toFixed(0)} MB ceiling`);
        res.status(500);
        return send({
          error: `this reply came to ${(bytes / 1e6).toFixed(1)} MB, over the ${(maxBytes / 1e6).toFixed(0)} MB ceiling. `
            + 'It is a collection being sent whole that should be sent a page at a time — the screen would '
            + 'have hung rather than shown you this. Nothing is wrong with your data.',
          route: where,
          bytes,
        });
      }
      if (bytes > warnBytes) log(`[payload] ${where}: ${(bytes / 1e6).toFixed(2)} MB`);
      res.setHeader('X-Payload-Bytes', String(bytes));
      return send(body);
    };
    next();
  });
}

module.exports = { page, installPayloadGuard, WARN_BYTES, MAX_BYTES, DEFAULT_LIMIT, MAX_LIMIT };
