// Plain numeric helpers, shared by anything that summarises a list of numbers.
//
// `median` lived inside the consensus screen's block in lib/batch.js until the
// screens that block served were retired (THIS-RELEASE point 14). Nine of its
// call sites went with them; two did not — the null test's summary of what the
// random-data copies scored still needs it. Leaving it where it was would have
// meant keeping a retired screen's code alive to host one helper, so it moved
// here instead.
//
// Zero imports, deliberately: this is arithmetic, and anything may reach for it
// including a worker thread, which must never load a stateful module.

// Middle value of a list. Even counts average the two middle values. An empty
// list has no middle, so it returns null rather than NaN — a caller writing
// this into a report needs "not available" to be distinguishable from a number.
// A BROKEN NUMBER IN THE LIST IS NOT A NUMBER TO SORT AROUND (2026-08-21).
// A list containing not-a-number sorted differently depending on the order the
// values arrived in, so the same five values gave a middle of NaN one way and 2
// the other — and neither answer said anything was wrong. The header above
// promises that "not available" is distinguishable from a number, and that
// promise only holds if a list that cannot be summarised says so.
function median(values) {
  const list = [...values];
  if (list.some((x) => !Number.isFinite(x))) {
    throw new TypeError('median: the list contains a value that is not a finite number. '
      + 'Sorting around it gave a different answer depending on the order the values arrived in.');
  }
  const v = list.sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

module.exports = { median };
