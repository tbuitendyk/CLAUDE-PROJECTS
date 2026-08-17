// Tiny test runner: node tests/run.js
const files = ['test-binance.js', 'test-dataset.js', 'test-features.js', 'test-logreg.js', 'test-boost.js', 'test-throttle.js', 'test-consensus.js', 'test-tracker.js', 'test-dogebook.js', 'test-books.js', 'test-metalens.js', 'test-permscreen.js', 'test-bracket.js', 'test-pool.js', 'test-inspect.js', 'test-walkforward.js', 'test-batchdoc.js', 'test-guard.js', 'test-wfcompare.js', 'test-history.js', 'test-layouts.js', 'test-historytuning.js', 'test-planted.js', 'test-vocabulary.js', 'test-htlaunch.js', 'test-plantedgate.js', 'test-gatepipe.js', 'test-censusselect.js', 'test-campaignnotes.js', 'test-fixround.js', 'test-manifest.js', 'test-plantedlate.js', 'test-httwo.js', 'test-forwardbook.js', 'test-pilotsignal.js', 'test-pilotview.js', 'test-pilotmirror.js', 'test-stoptuner.js', 'test-stopsweep.js', 'test-convictionsweep.js', 'test-armendpoint.js', 'test-live-setups.js', 'test-live-routes.js', 'test-live-signal.js', 'test-live-greenlight.js', 'test-live-view.js', 'test-live-catalog.js', 'test-live-mirror.js', 'test-live-targets.js', 'test-live-channels.js', 'test-decisiondate.js', 'test-sweepcontract.js', 'test-plateau.js', 'test-declaredset.js', 'test-historysurface.js', 'test-boardsurface.js', 'test-verifytune.js', 'test-uicontracts.js', 'test-verdictctx.js'];

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
