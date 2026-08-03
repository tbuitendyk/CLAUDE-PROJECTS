// Tiny test runner: node tests/run.js
const files = ['test-binance.js', 'test-dataset.js', 'test-features.js', 'test-logreg.js', 'test-boost.js', 'test-throttle.js', 'test-consensus.js', 'test-tracker.js', 'test-dogebook.js', 'test-books.js', 'test-metalens.js', 'test-permscreen.js', 'test-bracket.js', 'test-pool.js', 'test-inspect.js', 'test-interlace.js', 'test-walkforward.js', 'test-batchdoc.js', 'test-guard.js', 'test-wfcompare.js', 'test-history.js'];

let failures = 0;
(async () => {
  for (const f of files) {
    const mod = require(`./${f}`);
    for (const [name, fn] of Object.entries(mod)) {
      try {
        await fn();
        console.log(`ok   ${f} :: ${name}`);
      } catch (err) {
        failures++;
        console.error(`FAIL ${f} :: ${name}\n     ${err.message}`);
      }
    }
  }
  console.log(failures === 0 ? '\nall tests passed' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
