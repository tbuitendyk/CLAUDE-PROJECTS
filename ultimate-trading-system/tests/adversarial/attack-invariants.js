// Attack 5 — the promises the system makes about itself.
//
// Some things are not features, they are guarantees: no artificial
// intelligence anywhere in what runs; the same inputs always give the same
// answer; paper money and real money never touch. A guarantee that is only
// remembered is not a guarantee, so each one is checked here mechanically,
// every run.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { finding } = require('./harness');

const ROOT = path.join(__dirname, '..', '..');

function allSourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'data' || e.name === 'archive') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  })(ROOT);
  return out;
}

// The only place this system is allowed to reach on the internet: the public
// market-data service. Anything else in shipped code is a finding, whatever it
// claims to be for.
const ALLOWED_HOSTS = [/^https?:\/\/(api\.binance\.com|api\.binance\.vision|data\.binance\.vision)/];

// Names that give away an artificial-intelligence service being reachable.
const AI_TELLS = [
  /\bapi\.openai\.com\b/i, /\banthropic\.com\b/i, /\bapi\.cohere\b/i, /\bgenerativelanguage\.googleapis\b/i,
  /\bOPENAI_API_KEY\b/, /\bANTHROPIC_API_KEY\b/, /\bGEMINI_API_KEY\b/, /\bHUGGINGFACE\w*\b/i,
  /require\(['"](openai|@anthropic-ai\/[\w-]+|langchain|@langchain\/[\w-]+|ollama)['"]\)/,
];

function run(ctx) {
  const found = [];
  const files = allSourceFiles().filter((f) => !f.includes(`${path.sep}tests${path.sep}`));
  ctx.note(`${files.length} shipped code files checked`);

  // ---- 5a. RULE SEVEN — nothing artificial anywhere in what runs -----------

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    for (const tell of AI_TELLS) {
      const m = tell.exec(src);
      if (m) {
        found.push(finding('inv/ai', rel,
          `this file mentions "${m[0]}". The system's whole promise is that nothing it does at runtime involves an artificial intelligence, and that promise holds because there is nothing here to call. This is something to call.`,
          { severe: true }));
      }
    }
    // A URL written in a COMMENT is prose, not an address the code reaches.
    // Stripping `//` to end of line would eat the real ones (every URL contains
    // `//`), so the test is whether the LINE is a comment — which is how these
    // files are written and is safe against that trap.
    const commentLines = new Set();
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) commentLines.add(i);
    });
    const lineOf = (idx) => src.slice(0, idx).split('\n').length - 1;
    for (const m of src.matchAll(/https?:\/\/[a-zA-Z0-9.:_-]+/g)) {
      const url = m[0];
      if (commentLines.has(lineOf(m.index))) continue;
      if (url.includes('buitendyk.ca') || url.includes('127.0.0.1') || url.includes('localhost')) continue;
      if (url.includes('w3.org') || url.includes('schema.org')) continue; // markup namespaces, not requests
      if (ALLOWED_HOSTS.some((re) => re.test(url))) continue;
      found.push(finding('inv/outbound', rel,
        `this file names an outside address the system is not supposed to reach: ${url}. Only the public market-data service is allowed.`,
        { soft: true }));
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  const aiDeps = deps.filter((d) => /openai|anthropic|langchain|llm|gpt|ollama|transformers/i.test(d));
  if (aiDeps.length) {
    found.push(finding('inv/ai', 'package.json',
      `the system installs ${aiDeps.join(', ')} — an artificial-intelligence library shipped alongside the code it is promised to stay out of.`,
      { severe: true }));
  }
  if (deps.length !== 1 || deps[0] !== 'express') {
    found.push(finding('inv/deps', 'package.json',
      `the system now installs ${deps.length} outside libraries (${deps.join(', ')}) where it used to install one. Every one of them is code nobody here wrote running inside the thing that places real orders.`,
      { soft: true }));
  }

  // ---- 5b. the same inputs must always give the same answer ----------------

  // Anything that decides a trade must not roll dice. A temporary filename may.
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    src.split('\n').forEach((line, i) => {
      if (!/Math\.random\s*\(/.test(line)) return;
      if (/tmp|temp|filename|suffix|nonce|\.tmp/i.test(line)) return; // naming a scratch file, not deciding anything
      found.push(finding('inv/random', `${rel} line ${i + 1}`,
        `this line rolls dice: ${line.trim().slice(0, 120)}. Every number this system reports is supposed to be reproducible from the same inputs; a random draw anywhere in that path means a result cannot be checked by running it again.`,
        { severe: true }));
    });
  }

  // And prove it, rather than only reading it: train the same model on the same
  // data twice and require the two answers to be identical to the last digit.
  // The real trainer, on the real code path, twice. (First written against a
  // function called `train`; the function is `trainSoftmax` and takes three
  // arguments, so the check crashed and proved nothing. Read out of
  // lib/logreg.js this time.)
  const probe = `
    const { makeRng } = require('./tests/helpers');
    const { trainSoftmax } = require('./lib/logreg');
    async function fit() {
      const rng = makeRng(7);
      const X = []; const y = [];
      for (let i = 0; i < 300; i++) {
        const a = rng() * 2 - 1; const b = rng() * 2 - 1;
        X.push([a, b, a * b]);
        y.push(a + b > 0.3 ? 1 : (a + b < -0.3 ? -1 : 0));
      }
      const m = await trainSoftmax(X, y, 0.01, { maxIter: 200 });
      return Array.from(m.W || m.weights || []);
    }
    (async () => { process.stdout.write(JSON.stringify([await fit(), await fit()])); })();
  `;
  const probeFile = path.join(ROOT, '.adv-probe-determinism.js');
  try {
    fs.writeFileSync(probeFile, probe);
    const [a, b] = JSON.parse(execFileSync(process.execPath, [probeFile], { cwd: ROOT, encoding: 'utf8', timeout: 60000 }));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      found.push(finding('inv/notreproducible', 'training a model',
        'training the same model on exactly the same data twice gave two different answers. Nothing this system reports can be checked by running it again, which is the one thing that makes a result trustworthy.',
        { severe: true }));
    } else {
      ctx.note('training the same model on the same data twice gave the identical answer');
    }
  } catch (err) {
    found.push(finding('inv/instrument', 'this test itself',
      `the reproducibility check could not be run (${String(err.message).slice(0, 160)}), so nothing about reproducibility was actually proved this run`,
      { instrument: true }));
  } finally {
    try { fs.unlinkSync(probeFile); } catch (_) { /* leave it */ }
  }

  // ---- 5c. paper money and real money must never touch ---------------------

  const { liftArrow } = require('./attack-interface');
  const trade = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
  const dashTotals = (() => {
    const start = trade.indexOf('function dashTotals(');
    if (start < 0) return null;
    let i = trade.indexOf('{', trade.indexOf(')', start));
    let depth = 0; const from = i;
    for (; i < trade.length; i++) {
      if (trade[i] === '{') depth++;
      else if (trade[i] === '}') { depth--; if (depth === 0) break; }
    }
    const args = trade.slice(trade.indexOf('(', start) + 1, trade.indexOf(')', start));
    try {
      // eslint-disable-next-line no-new-func
      return new Function(args, trade.slice(from + 1, i));
    } catch (_) { return null; }
  })();
  void liftArrow;

  if (!dashTotals) {
    found.push(finding('inv/instrument', 'this test itself',
      'the Dashboard totalling function could not be lifted out of the Trade page, so the paper-versus-real money separation was NOT checked this run',
      { instrument: true }));
  } else {
    // One real book making 100 and one paper book making 999. The real side's
    // total must be 100 and only 100.
    const parts = [
      { st: { realizedPnl: 100, unrealizedPnl: 0, paperRealizedPnl: 0, paperUnrealizedPnl: 0, openPositions: [{ paper: false }] } },
      { st: { realizedPnl: 0, unrealizedPnl: 0, paperRealizedPnl: 999, paperUnrealizedPnl: 0, openPositions: [{ paper: true }] } },
    ];
    let real; let paper;
    try { real = dashTotals(parts, false); paper = dashTotals(parts, true); } catch (err) {
      found.push(finding('inv/instrument', 'this test itself', `the Dashboard totalling function would not run (${err.message})`, { instrument: true }));
      real = null;
    }
    if (real) {
      const asText = JSON.stringify(real);
      if (asText.includes('999')) {
        found.push(finding('inv/moneymixed', 'the Dashboard totals',
          'the real-money total has paper-book money folded into it. The figure the owner reads as their actual profit or loss includes trades that never happened.',
          { severe: true }));
      }
      if (JSON.stringify(paper).includes('100') && !JSON.stringify(paper).includes('999')) {
        found.push(finding('inv/moneymixed', 'the Dashboard totals',
          'the paper-book total has real money folded into it, which destroys the comparison the paper book exists to provide.',
          { severe: true }));
      }
      // And now the hostile version: books whose flags are missing or both set.
      const nasty = [
        { label: 'a position flagged as both paper and real', parts: [{ st: { realizedPnl: 5, paperRealizedPnl: 5, openPositions: [{ paper: true }, { paper: false }] } }] },
        { label: 'a book with no money fields at all', parts: [{ st: { openPositions: [] } }] },
        { label: 'a book whose money is text', parts: [{ st: { realizedPnl: '5', paperRealizedPnl: '5', openPositions: [] } }] },
        { label: 'a book whose money is not-a-number', parts: [{ st: { realizedPnl: NaN, paperRealizedPnl: NaN, openPositions: [] } }] },
        { label: 'a book that is missing entirely', parts: [{ st: null }] },
      ];
      for (const n of nasty) {
        for (const isPaper of [false, true]) {
          let t;
          try { t = dashTotals(n.parts, isPaper); } catch (_) { continue; } // refusing is right
          const bad = [];
          (function walk(v, at) {
            if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${at} = ${String(v)}`);
            else if (typeof v === 'string' && /^[-+]?[0-9]/.test(v)) bad.push(`${at} = the TEXT "${v}"`);
            else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
          })(t, '');
          if (bad.length) {
            found.push(finding('inv/dashfabricated', `the Dashboard totals (${isPaper ? 'Paper Books' : 'Live Trading'})`,
              `${n.label} produced a headline total of ${bad.slice(0, 2).join(', ')} — that goes at the top of the screen as the money figure.`,
              { severe: true }));
          }
        }
      }
    }
  }

  return found;
}

module.exports = { name: 'the promises — no artificial intelligence, reproducible, money kept apart', run };
