#!/usr/bin/env node
// THE ADVERSARIAL SUITE — run with: npm run test:adversarial
//
// The ordinary tests ask "does this work". This one asks the opposite
// question: given something broken, wrong, hostile or half-written, WHAT DOES
// THE SYSTEM SHOW THE OWNER?
//
// A crash is a pass. A refusal is a pass. What fails here is a confident,
// ordinary-looking answer computed from something the system should have
// refused — because that is the only kind of fault that reaches a trading
// decision without anyone noticing.
//
// Nothing here touches the owner's data or the running services. Every attack
// that needs a server or a data folder gets its own throwaway copy of the code
// with an empty data folder, on a port nothing else uses.
//
// KNOWN FINDINGS. Real findings that have been read and are not being fixed
// today live in baseline.json, with the reason written down. The suite passes
// while only those come back, and fails the moment something NEW appears. Add
// to the baseline with:  npm run test:adversarial -- --accept
const fs = require('fs');
const path = require('path');
const { makeSandbox, dropSandbox, startServer, BASE_PORT } = require('./harness');
const { seed } = require('./seed');

const BASELINE = path.join(__dirname, 'baseline.json');

const ATTACKS = [
  { mod: './attack-http', needs: 'servers' },
  { mod: './attack-schema', needs: null },
  { mod: './attack-candles', needs: 'sandbox' },
  { mod: './attack-interface', needs: null },
  { mod: './attack-invariants', needs: null },
  { mod: './attack-storeddata', needs: null },
];

// A finding's identity. Counts inside the wording change as the code changes
// and should not read as a brand-new problem, so digits are dropped.
function fingerprint(f) {
  return `${f.id}|${f.where}|${String(f.what).replace(/\d+/g, '#').slice(0, 90)}`.toLowerCase();
}

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) { return { known: [] }; }
}

async function main() {
  const accept = process.argv.includes('--accept');
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  // Which stored data to inspect. Defaults to this copy's own data folder; point
  // it at the box's folder to check what is really running. Read only either way.
  const dataArg = (process.argv.find((a) => a.startsWith('--data=')) || '').slice(7);
  const dataDir = dataArg || undefined;

  const all = [];
  const notes = [];
  let sandboxes = []; let servers = [];

  try {
    for (const spec of ATTACKS) {
      const attack = require(spec.mod);
      if (only && !spec.mod.includes(only)) continue;
      const ctx = { note: (m) => notes.push(`  ${m}`), dataDir };

      if (spec.needs === 'servers') {
        // Two systems: one holding nothing, one holding real data written
        // through the system's own code. Separate copies and separate ports so
        // neither can see the other.
        const emptyBox = makeSandbox('empty');
        const seededBox = makeSandbox('seeded');
        seed(seededBox);
        sandboxes = [emptyBox, seededBox];
        servers = [await startServer(emptyBox, BASE_PORT), await startServer(seededBox, BASE_PORT + 1)];
        ctx.servers = { empty: servers[0], seeded: servers[1] };
      } else if (spec.needs === 'sandbox') {
        const box = makeSandbox('cand');
        sandboxes = [box];
        ctx.sandbox = box;
      }

      process.stdout.write(`\n== ${attack.name}\n`);
      const before = notes.length;
      let out = [];
      try {
        out = (await attack.run(ctx)) || [];
      } catch (err) {
        out = [{ id: 'suite/broken', where: attack.name, what: `this attack could not be run at all: ${err.message}`, instrument: true }];
      }
      notes.slice(before).forEach((n) => process.stdout.write(`${n}\n`));
      process.stdout.write(`  ${out.length} finding(s)\n`);
      out.forEach((f) => all.push({ ...f, attack: attack.name }));

      for (const s2 of servers) await s2.stop();
      servers = [];
      sandboxes.forEach(dropSandbox);
      sandboxes = [];
    }
  } finally {
    for (const s2 of servers) await s2.stop();
    sandboxes.forEach(dropSandbox);
  }

  // A broken instrument is reported first and on its own. A test that could not
  // run is not a pass, and burying that among findings is how it gets read as
  // one.
  const broken = all.filter((f) => f.instrument);
  const real = all.filter((f) => !f.instrument);

  const base = loadBaseline();
  const knownBy = new Map((base.known || []).map((k) => [k.fingerprint, k]));
  const known = []; const fresh = [];
  for (const f of real) (knownBy.has(fingerprint(f)) ? known : fresh).push(f);

  // With --only, the attacks that did not run cannot possibly report their
  // findings, and calling those "no longer found" would read as thirty-odd
  // things having been fixed. Only a full run can say that.
  const gone = only ? [] : (base.known || []).filter((k) => !real.some((f) => fingerprint(f) === k.fingerprint));
  if (only) process.stdout.write(`\n(only ${only} ran — nothing can be said about the rest, and the known list is not being compared)\n`);

  if (accept && only) {
    process.stdout.write('\nrefusing to rewrite the known list from a partial run — that would silently drop every finding the attacks that did not run would have made. Run without --only.\n');
    return 2;
  }
  if (accept) {
    const next = {
      writtenUtc: new Date().toISOString(),
      note: 'Findings that are real, have been read, and are not being fixed today. Each needs a reason in plain language. The suite fails on anything NOT in this list.',
      known: real.map((f) => {
        const prev = knownBy.get(fingerprint(f));
        return {
          fingerprint: fingerprint(f),
          where: f.where,
          what: f.what,
          why: (prev && prev.why) || 'NOT YET REVIEWED — write here why this is not being fixed, or fix it',
        };
      }),
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`\nbaseline written: ${next.known.length} known finding(s)\n`);
    const unreviewed = next.known.filter((k) => k.why.startsWith('NOT YET REVIEWED')).length;
    if (unreviewed) process.stdout.write(`${unreviewed} of them have no reason written down yet.\n`);
    return 0;
  }

  process.stdout.write(`\n${'='.repeat(72)}\n`);
  if (broken.length) {
    process.stdout.write(`\nTHE TEST ITSELF DID NOT WORK (${broken.length}) — these were NOT checked:\n`);
    broken.forEach((f) => process.stdout.write(`  ! ${f.where}\n    ${f.what}\n`));
  }
  if (fresh.length) {
    process.stdout.write(`\nNEW (${fresh.length}) — found this run and not on the known list:\n`);
    fresh.forEach((f) => process.stdout.write(`\n  * ${f.where}\n    ${f.what}\n`));
  }
  if (known.length) {
    process.stdout.write(`\nalready known and written down (${known.length}):\n`);
    known.forEach((f) => process.stdout.write(`  - ${f.where}: ${String(f.what).slice(0, 90)}…\n`));
  }
  if (gone.length) {
    process.stdout.write(`\nno longer found (${gone.length}) — fixed, or the attack stopped reaching it:\n`);
    gone.forEach((k) => process.stdout.write(`  + ${k.where}: ${String(k.what).slice(0, 90)}…\n`));
  }

  const bad = fresh.length + broken.length;
  process.stdout.write(`\n${bad === 0
    ? `nothing new. ${known.length} known finding(s) still standing.`
    : `${fresh.length} NEW finding(s), ${broken.length} attack(s) that could not run.`}\n`);
  return bad === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`the adversarial suite crashed: ${err.stack || err.message}`);
  process.exit(2);
});
