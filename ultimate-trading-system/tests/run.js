// Tiny test runner: node tests/run.js
const files = ['test-binance.js', 'test-dataset.js', 'test-features.js', 'test-pipeline.js', 'test-stats.js', 'test-compare.js', 'test-paper.js', 'test-logreg.js', 'test-boost.js', 'test-throttle.js', 'test-bracket.js', 'test-pool.js', 'test-inspect.js', 'test-walkforward.js', 'test-batchdoc.js', 'test-guard.js', 'test-history.js', 'test-layouts.js', 'test-historytuning.js', 'test-planted.js', 'test-vocabulary.js', 'test-htlaunch.js', 'test-plantedgate.js', 'test-gatepipe.js', 'test-censusselect.js', 'test-campaignnotes.js', 'test-fixround.js', 'test-manifest.js', 'test-plantedlate.js', 'test-httwo.js', 'test-forwardbook.js', 'test-stoptuner.js', 'test-stopsweep.js', 'test-convictionsweep.js', 'test-armendpoint.js', 'test-livecontrols.js', 'test-setupsound.js', 'test-keyrouting.js', 'test-campaigndelete.js', 'test-permutealign.js', 'test-permutefields.js', 'test-sweepwords.js', 'test-help.js', 'test-cachemarker.js', 'test-frozentop.js', 'test-scrollmemory.js', 'test-refreshstatus.js', 'test-live-setups.js', 'test-live-routes.js', 'test-live-signal.js', 'test-live-greenlight.js', 'test-live-view.js', 'test-live-catalog.js', 'test-live-mirror.js', 'test-mirrorsurface.js', 'test-live-targets.js', 'test-live-channels.js', 'test-decisiondate.js', 'test-sweepcontract.js', 'test-plateau.js', 'test-declaredset.js', 'test-historysurface.js', 'test-boardsurface.js', 'test-verifytune.js', 'test-uicontracts.js', 'test-verdictctx.js', 'test-columnkeys.js', 'test-replyfields.js', 'test-endpointsexist.js', 'test-dashtotals.js', 'test-boardselection.js', 'test-trainpolicy.js', 'test-marginandentry.js', 'test-profiles.js', 'test-pairs.js', 'test-standdowns.js', 'test-unhalt.js', 'test-naming.js', 'test-ownerreach.js'];

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
