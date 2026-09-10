#!/usr/bin/env node
// DOES THE COMPUTE HAND'S SAFETY NET ACTUALLY CATCH ANYTHING?
//
//   node tests/mutate-servicecontrol.js              every guard
//   node tests/mutate-servicecontrol.js <part-of-a-test-name>   just those
//
// The control runs as root and most of what is written about it is a refusal —
// and a refusal test is the easiest kind to get wrong: it passes whether or not
// the guard it names is there, because the request failed for some other
// reason. So each guard is deleted in turn (or, where the safety is an absence,
// the danger is added back) and the suite is run against the damage. The test
// that names that guard has to FAIL. One that does not is protecting nothing,
// and it is worse than nothing because it reads as protection.
//
// Finds so far, every one the same mistake in different clothes — a test
// checking something OTHER than the thing it is named after: a refusal test
// that accepted either of two answers; a test that grepped a page for words
// instead of running it; and this harness itself breaking only the FIRST copy
// of a guard that appeared twice.
//
// It restores every file it touches, including when a run throws.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SVC = path.join(ROOT, 'service-control', 'server.js');
const SETUP = path.join(ROOT, 'public', 'setup.html');
const UNIT = path.join(ROOT, 'service-control', 'uts-service-control.service');
const COMPUTE = path.join(ROOT, 'lib', 'compute.js');

// file, the text to break, what to break it to, the test that must notice, and
// what it would cost if nobody did.
const GUARDS = [
  [SVC, '  if (!UNITS.includes(unit)) {\n    return { code: 400, body: { error: `"${unit}" is not one of this system\'s services (${UNITS.join(\', \')})` } };\n  }\n  if (!ACTIONS.includes(action))',
    '  if (!ACTIONS.includes(action))',
    'aServiceNotOnTheListIsRefusedAndNothingRuns', 'any service on the machine can be stopped from a phone'],
  [SVC, "if (unit === SELF_UNIT && action !== 'start')", 'if (false)',
    'evenWhenListedByHandTheControlRefusesToStopItself', 'the owner can strand themselves with one press'],
  [SVC, "if (String((body || {}).confirm || '') !== unit) {\n    return { code: 400, body: { error: `to ${action}",
    "if (false) {\n    return { code: 400, body: { error: `to ${action}",
    'nothingHappensUnlessTheNameIsGivenTwice', 'one mistyped request stops a service'],
  [SVC, 'if (!Number.isFinite(pct) || pct < 10 || pct > cores * 100)', 'if (false)',
    'theCeilingIsBoundedAndAppliedWithSetProperty', 'a ceiling of 1% starves a service into the very outage this exists to end'],
  [SVC, 'if (want !== PUBLIC_DIR && !want.startsWith(PUBLIC_DIR + path.sep))', 'if (false)',
    'itCannotBeTalkedIntoServingAFileOutsideThePagesFolder', 'any file on the machine can be read out'],
  [SVC, "return send(res, 405,", "return servePublic(res, url); // broken on purpose\n  return send(res, 405,",
    'itAnswersNothingButTheThingsItIsFor', 'it answers methods it was never meant to'],
  [SVC, "url = url.replace(/^\\/svc(?=\\/|$)/, '') || '/';", "url = url || '/';",
    'theSameRequestWorksFromBothAddresses', 'the controls work from one address and silently not the other — and the other is the one used during an outage'],
  [SETUP, "'svc/api/service'", "'api/service'",
    'theComputeTabActsThroughTheSeparateProgram', 'the buttons ask the very service that will be down'],
  [UNIT, 'Restart=always', 'Restart=on-failure',
    'theControlsOwnUnitAlwaysRestartsAndIsTiny', 'the one way back does not come back on its own'],
  [COMPUTE, 'if (!platforms().some((p) => p.id === platformId)) {', 'if (false) {',
    'aRoleCanOnlyPointAtAPlatformThatExists', 'a role can be pointed at a platform that does not exist, silently'],
  [path.join(ROOT, 'public', 'construct.html'), '<button class="themebtn" id="themebtn">◐ theme</button>',
    '<button class="themebtn" id="cpubtn">CPU —</button>\n      <button class="themebtn" id="themebtn">◐ theme</button>',
    'theCpuDialLivesOnTheComputeTabAlone', 'the removed CPU button grows back beside the theme button and the dial has two homes again'],
  [path.join(ROOT, 'public', 'construct.js'), 'if (!el.title) el.title = text;', 'el.title = text;',
    'everyControlsHelpBecomesItsHover', 'the wired hover overwrites every hand-written warning in the templates'],
  // The wrapper gained holdScrollMemory() when the scroll-memory work landed,
  // and this guard's copy of the line silently stopped matching — a SKIP the
  // 2026-08-26 run surfaced. A guard that no longer matches tests nothing.
  [path.join(ROOT, 'public', 'construct.js'), "drawSweep = ((fn) => async (...a) => { holdScrollMemory(); const r = await fn(...a); hoverFromHelp('sweep'); return r; })(drawSweep);", '',
    'everyControlsHelpBecomesItsHover', 'the Sweep controls go back to having no hovers at all'],
  [path.join(ROOT, 'public', 'construct.js'), '    if (Date.now() < scrollMemoryHeldUntil) return;   // the page moved itself', '',
    'theClampNeverOverwritesTheMemory', 'the clamped landing writes over the remembered place and every restore restores the wrong spot'],
  [path.join(ROOT, 'public', 'construct.js'), '  holdScrollMemory();\n  requestAnimationFrame(() => requestAnimationFrame(() => { holdScrollMemory(); window.scrollTo(0, y); }));', '  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));',
    'theClampNeverOverwritesTheMemory', 'the restore itself is what destroys the memory it restores from'],
  [path.join(ROOT, 'lib', 'stages.js'), 'if (!pinned.intact) {', 'if (false) {',
    'theChainRefusalsNameThemselves', 'a stage launches over changed price files and two histories are quietly mixed into one chain'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'return [d / c, n / c, u / c];', 'return [d, n, u];',
    'theForecastScoreMatchesThePencil', 'a unit with more members outscores a better unit with fewer, by arithmetic alone'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'if (!(sd > 1e-9 * Math.max(1, Math.abs(mean)))) return 0;', 'if (!(sd > 1e-9 * Math.max(1, Math.abs(mean)))) return null;',
    'theLeadOverTheNullSetMatchesThePencil', 'a null set with no spread turns the tie-break into a hole instead of a zero'],
  [path.join(ROOT, 'lib', 'stages.js'), 'avgHold: mean((c) => (c.holdN ? c.hold / c.holdN : null)),', 'avgHold: mean((c) => c.hold),',
    'theStageThreeTablesMatchThePencil', 'a coin with many records outvotes the others and the ranked averages stop being per-coin'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'for (let k = 1; k < 3; k++) if (a[k] > a[best]) best = k;', 'for (let k = 1; k < 3; k++) if (a[k] >= a[best]) best = k;',
    'theStoredVoteReadsBackLikeTheLiveOne', 'a stored tie reads back as a different call than the live engine made'],
  [path.join(ROOT, 'lib', 'stages.js'), 'if (params.orderBy !== undefined) {', 'if (false) {',
    'theChainRefusalsNameThemselves', 'the removed order by is silently ignored instead of refused, and an old caller thinks it still steers the carry'],
  [path.join(ROOT, 'lib', 'stages.js'), 'if (!keys[key]) throw new Error(`"${key}" is not a column these tables sort by', 'if (false) throw new Error(`"${key}" is not a column these tables sort by',
    'theSavedSortOrdersTheTablesAndTheFirstColumnFollows', 'a junk sort key saves silently and every table and carry read against a column that does not exist'],
  [path.join(ROOT, 'lib', 'stages.js'), 'if (children.length) {', 'if (false) {',
    'theDeleteAsksForTheNameBackAndProtectsParents', 'a parent another set stands on is deleted and every child\'s chain dangles'],
  [path.join(ROOT, 'lib', 'stages.js'), "if (String(confirm || '') !== doc.id) {", 'if (false) {',
    'theDeleteAsksForTheNameBackAndProtectsParents', 'asking what would go deletes it — the preview becomes the act'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'c.beat += add.beat; c.pairs += add.pairs;', 'c.beat += add.beat;',
    'theShardedTallyFoldsToTheSameAnswer', 'the multithreaded totalling quietly drops comparisons and the shares inflate'],
  [path.join(ROOT, 'lib', 'stages.js'), "campaign: require('./campaign').getCampaign() || null", 'campaign: null',
    'theCampaignStampSitsOnEveryStageLaunch', 'every stage launch silently drops the campaign stamp and the tree shows none of them'],
  [path.join(ROOT, 'lib', 'campaign.js'), "for (const s of require('./stages').listSets()) note((s.params || {}).campaign, s.createdAt);", ';',
    'theCampaignStampSitsOnEveryStageLaunch', 'a campaign whose only activity is record sets vanishes from the picker'],
  [path.join(ROOT, 'lib', 'campaign.js'), 'sort((a, b) => b.stage - a.stage)', 'sort((a, b) => a.stage - b.stage)',
    'theCampaignDeleteTakesItsRecordSetsChildrenFirst', 'the campaign delete hits its own parent refusal and leaves every chain behind'],
  [path.join(ROOT, 'lib', 'stages.js'), "if (doc.status === 'running') throw new Error('the record set is still being written", "if (false) throw new Error('the record set is still being written",
    'theRecordSetNotesRefuseWhileWritingAndSaveAfter', 'a note written under a running set is silently overwritten by the orchestrator'],
  [path.join(ROOT, 'lib', 'stages.js'), 'rows.sort((a, b) => ((b.scoreAll ?? -1e9) - (a.scoreAll ?? -1e9)) || (a.carriedRank - b.carriedRank));', 'rows.sort((a, b) => a.carriedRank - b.carriedRank);',
    'theStageTablesPageInRecordedOrder', 'the stage 2 table quietly falls back to carry order and the best all-members scores hide down the pages'],
  [path.join(ROOT, 'lib', 'stages.js'), 'if (Array.isArray(doc.sort) && doc.sort.length) rows = applySort(1, rows, doc.sort, (a, b) => a._i - b._i);', '',
    'theSavedSortOrdersTheTablesAndTheFirstColumnFollows', 'the saved sort saves but the stage 1 table silently ignores it — the screen claims one order and shows another'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'if (r.lead != null) { c.ld += r.lead; c.ldN++; }', '',
    'theStageThreeTablesMatchThePencil', 'lead over null set on the ranked table reads as nothing, silently, for every set'],
  [path.join(ROOT, 'public', 'construct.js'), 'if (s3sel) { s2sel = parentOf(s3sel); s1sel = s2sel ? parentOf(s2sel) : null; }', 'if (false) { s2sel = parentOf(s3sel); s1sel = null; }',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'a stage 3 pick stops putting its provenance on screen and the sections drift apart'],
  [path.join(ROOT, 'public', 'construct.js'), 'bSaveView({ s1: idv, s2: null, s3: null, fold1: true, openS3: [] })', 'bSaveView({ s1: idv, fold1: true, openS3: [] })',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'picking a new stage 1 parent leaves stale children selected under it'],
  [path.join(ROOT, 'public', 'construct.js'), "const s1row = rowOf(v('#swFrom2'));", 'const s1row = null;',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'the stage 2 title stays green whatever the stage 1 boxes show — the provenance flag stops flagging'],
  [path.join(ROOT, 'lib', 'stages.js'), "  try { if (readTally(id)) return { ready: true }; } catch (_) { /* fall through */ }", '  return { ready: true };',
    'theTablesRebuildThemselvesWhenOpened', 'a set stranded without its tables reads as ready forever and the stage 3 tables stay empty'],
  [path.join(ROOT, 'lib', 'stages.js'), '  if (t && t.v !== TALLY_V) t = null;', '',
    'theOldTallyShapeRetotalsItself', 'a tally from before the avg test $ column is served with dashes where the number belongs, forever'],
  [path.join(ROOT, 'lib', 'stages.js'), '  if (tallyInHand.staleId === id && tallyInHand.staleMtimeMs === st.mtimeMs && tallyInHand.staleSize === st.size) return null;', '',
    'theOldTallyShapeRetotalsItself', 'every poll re-parses the whole stale tally and the service dies at the heap limit beside the re-total — the third out-of-memory death, back'],
  [path.join(ROOT, 'lib', 'stages.js'), '  if (tallyRun && tallyRun.id === id && !tallyRun.error) return null;', '',
    'theTablesRebuildThemselvesWhenOpened', 'the file a totalling is replacing is parsed whole on every ask while the fold holds its accumulator'],
  [path.join(ROOT, 'lib', 'stagework.js'), '  k.test += r.pnl || 0; k.testN++;', '  k.testN++;',
    'theStageThreeTablesMatchThePencil', 'the every-coin table\'s avg test $ reads zero for every row and nobody is told'],
  [path.join(ROOT, 'lib', 'stagework.js'), '    k.test += add.test || 0; k.testN += add.testN || 0;', '',
    'theShardedTallyFoldsToTheSameAnswer', 'the multithreaded totalling quietly drops the test money and the two builds disagree'],
  // RE-ANCHORED 2026-08-28: the ranked read tags its rows with their carry
  // position inline now, so the old one-line anchor had gone stale and this
  // guard was testing nothing (the harness reported it as a SKIP).
  [path.join(ROOT, 'lib', 'stages.js'),
    '    rows = applySort(3, t.ranked.map((r, i) => ({ ...r, _i: i })), doc.sort, (a, b) => a._i - b._i);',
    '    rows = t.ranked.map((r, i) => ({ ...r, _i: i }));',
    'theRankedTableSortsByOnePickedColumn', 'the picked column saves but the ranked table silently keeps its own order — the screen claims one order and shows another'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (stage === 3 && spec.length > 1) throw new Error('one column at a time on this table');", '',
    'theRankedTableSortsByOnePickedColumn', 'two saved columns reach a table whose buttons promise one, and what ordered the page becomes unreadable'],
  // RE-ANCHORED 2026-08-28: cellForUnits went with the per-committee-size
  // agreement counts when the share dial replaced them, so this guard had been
  // matching nothing. What the count must still ride is the launch's own
  // resolution of WHICH committee sizes are being priced — two shares landing
  // on the same rung for every unit are one setting, not two, and only the
  // resolved sizes can say so.
  [path.join(ROOT, 'lib', 'stages.js'),
    "      sizes = [...new Set(records.map((r) => r.size || (r.ctx1 ? (r.ctx2 ? 3 : 2) : 1)))];",
    '      sizes = null;',
    'theStageThreeCountRidesTheLaunchesOwnResolution', 'the cost line counts rungs the launch will not run — two different numbers'],
  [path.join(ROOT, 'public', 'construct.js'), 'window.scrollBy(0, again.getBoundingClientRect().top - pegTop);', 'void pegTop;',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'Apply goes back to yanking the page and the owner loses their place on every press'],
  [path.join(ROOT, 'public', 'construct.js'), 'bWireRankSort(doc, mount);', '',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'the ranked table\'s sort buttons draw but press dead'],
  [path.join(ROOT, 'lib', 'stages.js'), '  kept.sort(query.flip ? (a, b) => cmp(b, a) : cmp);', '  kept.sort(cmp);',
    'theStageThreeTablesMatchThePencil', 'the second click claims to turn the order and quietly does nothing'],
  [path.join(ROOT, 'lib', 'stages.js'), '    test: (a, b) => ((b.avgTest ?? -1e15) - (a.avgTest ?? -1e15)) || byShare(a, b),', '',
    'theStageThreeTablesMatchThePencil', 'sorting by avg test $ serves an arbitrary order as if it were the best-first one'],
  [path.join(ROOT, 'public', 'construct.js'), '      bSaveView({ openS3: [...keys] });\n      bRedrawPeggedToCoinHead();',
    '      bSaveView({ openS3: [...keys] });\n      drawBoards().then(() => restoreScroll(tab));',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'the records buttons go back to yanking the page around'],
  [path.join(ROOT, 'public', 'construct.js'), 'flip: active ? !cq.flip : false', 'flip: false',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'the second click on a column stops turning the order and the arrow lies'],
  // ---- the owner's loop of 2026-08-28: the measurements, the committee and
  // the agreement rules ----------------------------------------------------
  [path.join(ROOT, 'lib', 'bracketwork.js'), "  ? ['full', 'prices', 'volume', 'pricevol']", "  ? ['full', 'prices', 'volume']",
    'everyMemberCountOnScreenIsTheCountTheCodeBuilds', 'the fourth reading vanishes and a coin on its own is back to 6 members'],
  [path.join(ROOT, 'lib', 'features.js'), "  push('close_in_range', hi > lo ? (last - lo) / (hi - lo) : 0.5);", "  push('close_in_range', 0.5);",
    'noNumberIsFrozenOrRepeatsAnother', 'a measurement goes frozen again and every member trained on it learns nothing from it'],
  [path.join(ROOT, 'lib', 'features.js'), "    push(`q${k + 1}_ret`, end / base - 1);", "    push(`q${k + 1}_ret`, last / first - 1);",
    'noNumberIsFrozenOrRepeatsAnother', 'the four quarter returns collapse into four copies of the whole-chunk return'],
  [path.join(ROOT, 'lib', 'features.js'), "  const Q = Math.floor(HOURS / 4);", "  const Q = Math.floor(HOURS / 1);",
    'everyChunkShapeIsTheSameWidth', 'the quarters stop being quarters and the block breaks at every chunk shape'],
  [path.join(ROOT, 'lib', 'agreement.js'), "      if (n > 0 && same / n >= threshold) { g.push(m); joined = true; break; }", "      if (false) { g.push(m); joined = true; break; }",
    'independentVoicesSeeThroughNearCopies', 'near-copies count as separate voices again and a wider committee just stuffs its own ballot'],
  [path.join(ROOT, 'lib', 'agreement.js'), "    for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) w += ctx.weights[m];", "    for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) w += 1;",
    'theVoicesRuleCannotBeStuffedWithCopies', 'the voices rule silently becomes the plain count and the whole point of it is gone'],
  [path.join(ROOT, 'lib', 'agreement.js'), "    if (Math.sign(s) !== winner) return 0;   // the leaning must back the majority", '',
    'convictionSeparatesCertainFromBarely', 'a committee trades against its own majority whenever one loud member outweighs it'],
  [path.join(ROOT, 'lib', 'agreement.js'), "      if (kinds.size < 2) c = 0;", '',
    'bothKindsAndHoldDoWhatTheySay', 'the both kinds requirement is named on the setting and does nothing'],
  [path.join(ROOT, 'lib', 'agreement.js'), "    for (let k = 1; k <= p; k++) { if (i - k < 0 || out[i - k] !== out[i]) { ok = false; break; } }", '    for (let k = 1; k <= p; k++) { if (false) { ok = false; break; } }',
    'bothKindsAndHoldDoWhatTheySay', 'a hold is named on the setting and never actually holds anything'],
  [path.join(ROOT, 'lib', 'agreement.js'), "  const frac = Math.max(0, Math.min(1, (100 - strictPct) / 100));", "  const frac = Math.max(0, Math.min(1, strictPct / 100));",
    'theOwnHistoryBarIsStrictestAtTheTopForEveryWayOfWeighing', 'the strictness share runs backwards and a higher share quietly means looser'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (pm !== MEASUREMENTS_VERSION) {", '  if (false) {',
    'aSetFromAnOlderMeasurementBlockIsRefusedAsAParent', 'a set trained on measurements that no longer exist is carried forward and every number after it is nonsense'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (!active.length) return rows;", '  return rows;',
    'theTableFiltersRefuseAnUnknownFieldByName', 'every filter on every table draws and does nothing'],
  [path.join(ROOT, 'lib', 'stages.js'), '    if (!def) throw new Error(', '    if (false) throw new Error(',
    'theTableFiltersRefuseAnUnknownFieldByName', 'a filter the screen shows and the service ignores passes unnoticed'],
  [path.join(ROOT, 'public', 'construct.js'), "bFilterGrid('S3R'", "bFilterGridX('S3R'",
    'everyTableCarriesFiltersAFoldAndSortableColumns', 'the ranked table loses its filters'],
  [path.join(ROOT, 'public', 'construct.js'), 'id="swAgreeRule"', 'id="swAgreeRuleX"',
    'everyAgreementRuleIsReachableFromTheScreen', 'the agreement rule becomes unreachable from the screen and only code can pick it'],
  [path.join(ROOT, 'lib', 'stages.js'), "const band = share > HEAP_REFUSE_SHARE ? 'refuse' : (share > HEAP_WARN_SHARE ? 'tight' : 'fits');", "const band = 'fits';",
    'theBudgetGateDoesTheArithmeticUpFront', 'every block reads as fitting and the service dies out of memory instead of refusing with the arithmetic'],
  [path.join(ROOT, 'lib', 'stages.js'), "if (gate.band === 'refuse') {", 'if (false) {',
    'theOverBudgetTablesAreRefusedNotAttempted', 'an impossible totalling is attempted anyway — the exact out-of-memory death the gate exists to stop'],

  // ---- the four screens deleted on 2026-08-28, and what took their place --
  //
  // Thirteen guards went out with the screens they broke. These replace the
  // three whose PROPERTY survived on the pair that is left, so the count of
  // things actually protected does not quietly drop with the screen count.
  [path.join(ROOT, 'public', 'construct.js'),
    '>beat its own null set</th>\n          <th style="padding:.2rem .5rem" title="the once-only look',
    '>held-back trades x</th>\n          <th style="padding:.2rem .5rem" title="the once-only look',
    'theRecordedRowNamesItsChoices', 'the ordered column the owner placed between test trades and held-back $ vanishes from the records'],
  [path.join(ROOT, 'public', 'construct.js'), "root.setAttribute('data-theme', localStorage.getItem('cx-theme') || 'dark');", '',
    'constructingRemembersItsOwnTheme', 'the theme button draws and does nothing — which is exactly what deleting the old screens did to it once already'],
  [path.join(ROOT, 'public', 'construct.js'), 'function bPager(total, from, n, key) {',
    'function bPager(total, from, n, key) {\n  if (true) return `<p class="note">${total.toLocaleString()} row(s)</p>`;',
    'apageAlwaysStatesTheTrueTotalOnScreen', 'every table stops at its first hundred rows with nothing on screen saying there are more'],
  [path.join(ROOT, 'public', 'construct.js'), "${bPager((coins && coins.total) || 0, coinsQ.offset || 0, 100, 'S3C')}", '',
    'everyTableThatCanGrowHasAPagingBar', 'the every-coin table — the longest one on the screen — loses its paging bar and stops at its first hundred rows'],
  // THE WORD LIST'S OWN READER, both ways. Too shallow and words on the
  // owner's screen are on no list, which under RULE ONE-A forbids saying them;
  // too deep and one screen's words are authorised on another.
  [path.join(ROOT, 'lib', 'screencontrols.js'), '      queue.push(b);', '',
    'theReaderFollowsWhatARendererDrawsWith', 'the reader stops one hop from the renderer again and the paging bar goes back to being a screen the word list cannot see'],
  [path.join(ROOT, 'lib', 'screencontrols.js'), "      if (isScreen(name)) { seen.add(name); continue; }", '',
    'theReaderFollowsWhatARendererDrawsWith', 'a helper that redraws the page drags every other screen\'s words onto this list — every word in the app authorised on every screen'],
  // THE MEMBER COUNTS THE OWNER READS. Both halves: the two lines the Sweep
  // screen prints, and the three hovers where they were actually wrong.
  [path.join(ROOT, 'public', 'construct.js'), '4 per coin on its own, 5 alongside others', '3 per coin on its own, 4 alongside others',
    'everyMemberCountOnScreenIsTheCountTheCodeBuilds', 'the Sweep screen states a committee size nobody counted, and it reads as fact'],
  [path.join(ROOT, 'public', 'help-content.js'), '4 members after stage 1', '3 members after stage 1',
    'everyMemberCountOnScreenIsTheCountTheCodeBuilds', 'the singles hover goes back to the count from before the fourth slice — the exact wrong number the owner caught'],
  // THE FOUR NUMBERS BESIDE EACH FILTER. Three ways they can lie: describing
  // the whole set rather than the rows on screen, counting an absent value as
  // a zero, and never reaching the page at all.
  [path.join(ROOT, 'lib', 'stages.js'), '      if (raw == null || raw === \'\') continue;', '',
    'aColumnWithNoNumbersInItSaysSoInsteadOfReadingZero',
    'a row that HAS no value is counted as a row worth zero — an empty column reads as a column of zeroes and every average is dragged towards one'],
  [path.join(ROOT, 'lib', 'stages.js'), '() => spreadOf(rows, FILTER_DEFS[3])', '() => spreadOf(t.ranked, FILTER_DEFS[3])',
    'theFourNumbersBesideEachFilterDescribeTheRowsTheTableIsHolding',
    'the numbers beside each box describe the whole record set instead of the rows the table is showing, so the next floor is set from a table nobody is looking at'],
  [path.join(ROOT, 'public', 'construct.js'), '], ranked && ranked.spread)}', '])}',
    'everyFilterOnTheStageThreeTablesShowsWhatItsColumnHolds',
    'the ranked table stops asking for the four numbers and every box goes back to being a floor set by guessing'],
  [path.join(ROOT, 'public', 'construct.js'), '], coins && coins.spread)}', '])}',
    'everyFilterOnTheStageThreeTablesShowsWhatItsColumnHolds',
    'the every-coin table stops asking for the four numbers'],
  // THE TYPED PAGE NUMBER.
  [path.join(ROOT, 'public', 'construct.js'), 'Math.min(pages, Math.max(1, want))', 'want',
    'everyPageOfATableCanBeReachedByTypingItsNumber',
    'a page number past the end of the table walks the reader off it and the table comes back empty with no reason given'],
  [path.join(ROOT, 'public', 'construct.js'), '      if (jumped) return;', '',
    'everyPageOfATableCanBeReachedByTypingItsNumber',
    'change and blur both fire, so one typed page turns the table twice and the second turn is the one nobody asked for'],
  // WHAT ACTUALLY AGREED. The reading itself, the two places it is folded,
  // and the column on the screen.
  [path.join(ROOT, 'lib', 'agreement.js'), '    for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) w += ctx.weights[m];\n    return w;',
    '    return calls.length;',
    'whatActuallyAgreedIsReadOffTheSameVotesTheRuleRead',
    'near-copies are counted as separate voices in what agreed, so a committee of duplicates reports full agreement'],
  [path.join(ROOT, 'lib', 'agreement.js'), '  let n = 0;\n  for (let m = 0; m < calls.length; m++) if (calls[m][i] === winner) n++;\n  return n;',
    '  return calls.length;',
    'whatActuallyAgreedIsReadOffTheSameVotesTheRuleRead',
    'the losing side and the abstainers are counted as agreeing, so every moment reports unanimity'],
  [path.join(ROOT, 'lib', 'stagework.js'), '  if (agreed && agreed.agreed != null) { c.agr += agreed.agreed; c.agrN++; }', '',
    'whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord',
    'the ranked table loses the column and every setting reads as though nothing was ever measured'],
  [path.join(ROOT, 'lib', 'stagework.js'), '  if (agreed && agreed.agreed != null) { k.agr += agreed.agreed; k.agrN++; }', '',
    'whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord',
    'the every-coin table loses the column'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'const agreedKeyOfRecord = (r) => `${r.decision}|', 'const agreedKeyOfRecord = (r) => `${r.entry}|',
    'whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord',
    'a record is joined to the wrong answer, so every row shows an agreement some other setting reached'],
  [path.join(ROOT, 'lib', 'stages.js'), 'return { indexed: true, shown: got.length, rows: got };',
    'return { indexed: true, shown: got.length, rows: got.map((r) => ({ ...r, agreed: null })) };',
    'whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord',
    'the records under a coin row stop carrying their own figure and only the averages above them survive'],
  [path.join(ROOT, 'lib', 'stages.js'), "    voicesMin: ['avgVoices', 'min'], agreedMin: ['avgAgreed', 'min'],",
    "    voicesMin: ['avgVoices', 'min'], agreedMin: ['avgAgreed', 'min'], shareMin: ['agreePct', 'min'],",
    'whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord',
    'the floor on the share that was merely ASKED FOR comes back, and on a run built on one share it keeps everything or nothing'],
  [path.join(ROOT, 'public', 'construct.js'), '>share that agreed', '>agreement',
    'whatActuallyAgreedIsOnEveryStageThreeTable',
    'the column is renamed on all three tables at once and nothing notices the screens no longer say what they show'],
  [path.join(ROOT, 'lib', 'stages.js'), '      avgAgreed: mean((c) => (c.agrN ? c.agr / c.agrN : null)),', '',
    'whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord',
    'the ranked table stops reporting it even though every record carries it'],
  // The Funnel's closing and the scrambled copies it is compared against.
  [path.join(ROOT, 'lib', 'stages.js'),
    '  const closed = S4.ruleWithClosing(t.ranked || [], state.rule, state.closing, doc.target);\n  doc.rule = closed.rule;',
    '  const closed = { key: (state.closing || {}).key || \'rule\', detail: null };\n  doc.rule = S4.normaliseRule(state.rule);',
    'theCutFoldsTheClosingIntoTheRuleItWrites',
    'the top N and the tightening are recorded as taken and never taken — the set carries the cost of shopping with none of the narrowing'],
  [path.join(ROOT, 'lib', 'funnelset.js'), '  if (!R.cut) return kept;', '  if (true) return kept;',
    'theClosingChangesWhatTheRuleKeepsNotJustWhatTheRecordSays',
    'a rule that says it takes the top N keeps everything, and the set fails its own replay check on the way out'],
  [path.join(ROOT, 'lib', 'funnelset.js'),
    '  return `${parts.length ? base : \'everything\'}, then the top ${R.cut.n} by ${TOP_COLUMNS[R.cut.column]}`;',
    '  return base;',
    'theRuleSentenceStatesTheCut',
    'the sentence on the screen and on the record states the ranges and hides the cut that threw the most away'],
  [path.join(ROOT, 'lib', 'funnelset.js'),
    '  return applyRule((rows || []).map((r) => ({ ...r, [funnel.TEST_MONEY]: (r.noiseTest || [])[i] ?? null })), rule);',
    '  return applyRule(rows || [], rule).map((r) => ({ ...r, [funnel.TEST_MONEY]: (r.noiseTest || [])[i] ?? null }));',
    'aScrambledCopyPicksItsOwnRowsUnderTheSameRule',
    'the scrambled copy is handed the rows the real money picked, so every noise comparison on the screen compares the best N against the same N'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const check = keptN ? { k: keptN } : { seed };",
    "  const check = keptN ? { k: keptN, copies: Array.from({ length: keptN }, (_, d) => S4.swapMoney(rows, d)) } : { seed };",
    'theFunnelReadBuildsItsScrambledCopiesFromEverySettingNotTheSurvivors',
    'the one function that builds a scrambled copy is bypassed and the read builds a wrong one inline again'],
  [path.join(ROOT, 'lib', 'funnelset.js'),
    "      out.ranges[d] = { ...out.ranges[d], min: inPlay[1], max: inPlay[inPlay.length - 2] };",
    "      out.ranges[d] = { ...out.ranges[d], min: inPlay[1] };",
    'tighteningNarrowsFromBothEndsAndIsStillARule',
    'tightening walks the range toward the best value from one end, which is the shopping it exists to avoid'],
  [path.join(ROOT, 'public', 'construct.js'), "  agreePct: 'share',", "  agreePct: 'agree %',",
    'theDialNamesCarryTheirSweepLabel',
    'the Funnel sends the owner looking for a box called "agree %" that Sweep does not have'],
  [path.join(ROOT, 'public', 'construct.js'), '<td>${esc(fDialLabel(x.dial))}</td>', '<td>${esc(x.dial)}</td>',
    'theDialNamesCarryTheirSweepLabel',
    'the first step goes back to naming dials dMult and agreePct, which are on no screen the owner can open'],
  // ---- THE DIAL BOXES NAME THEIR DIALS (3.52.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "<select id=\"fDial\">${fDialOptions(st.dial || '')}</select>", "<select id=\"fDial\">${vocabOptions('funnelDial', st.dial || '')}</select>",
    'theDialNamesCarryTheirSweepLabel',
    'the dial box on step 2 offers dMult and agreePct bare, which are on no screen the owner can open'],
  [path.join(ROOT, 'public', 'construct.js'), "<p class=\"note\"><b>${esc(fRuleWords(d.ruleSentence))}</b></p>", "<p class=\"note\"><b>${esc(d.ruleSentence)}</b></p>",
    'theDialNamesCarryTheirSweepLabel',
    'the rule sentence names dials by their keys again'],
  [path.join(ROOT, 'public', 'construct.js'), 'This table lists only the dials this run swept more than one value of.',
    'Every dial on the record is listed, including the ones this run only swept a single value of.',
    'theDialColumnsDescriptionMatchesWhatTheColumnHolds',
    'the dial heading claims to list the very dials the table is built to leave out, and the owner goes looking for three rows that were never there'],
  // §16 -- the guided walk.
  [path.join(ROOT, 'lib', 'funnel.js'), "      const counts = cm.length > 0 && beaten >= bar;",
    "      const counts = cm.length > 0 && beaten >= 1;",
    'aValueCountsWhenItBeatsEveryCopyOrBothHalves',
    'a value counts by beating ONE scrambled copy whatever bar the owner set, and the recommendation is fitted to whichever copy was weakest'],
  [path.join(ROOT, 'lib', 'funnel.js'), "    const counts = beaten === 2;                 // both halves, always: two is the whole check",
    "    const counts = beaten >= 1;                 // both halves, always: two is the whole check",
    'aValueCountsWhenItBeatsEveryCopyOrBothHalves',
    'with no scrambled copies a value counts on one half alone, which is not a check of stability at all'],
  [path.join(ROOT, 'lib', 'funnel.js'), "      let ok = !!x && x.mean != null && !x.thin && checkGrids.length > 0;",
    "      let ok = !!x && x.mean != null && checkGrids.length > 0;",
    'theBlockIsTheLargestRectangleThatBeatsTheCheck',
    'a thin square joins the recommended block, and it is often the best-looking square on the grid precisely because it is thin'],
  [path.join(ROOT, 'lib', 'plateau.js'), '    if (lo != null) bounds[a] = { min: lo, max: hi };', '    if (lo != null) bounds[a] = { min: lo, max: lo };',
    'theWidestRegionBecomesARuleNotAPoint',
    'the region collapses to its lowest edge on every dial and keeping it keeps a sliver, not the region'],
  [path.join(ROOT, 'lib', 'funnelset.js'), "  const dup = doc.marks.find((m) => m.key === mark.key && m.step === (mark.step ?? null) && m.detail === (mark.detail ?? null));\n  if (dup) return doc;",
    '',
    'marksAreRecordedOnceAndRideOnTheSet',
    'every redraw doubles the marks and a set reads as walked past twelve disagreements that were one'],
  [path.join(ROOT, 'lib', 'stages.js'), '    for (const [f, v] of Object.entries(x)) if (o[f] === undefined) o[f] = v;',
    '    for (const [f, v] of Object.entries(x)) o[f] = v;',
    'theRebuiltNumbersAreKeptBesideTheSetAndLaidOntoTheRows',
    'a number the tally already carries is overwritten by the rebuild copy, and the two can differ'],
  [path.join(ROOT, 'lib', 'stages.js'), '  const all = withFunnelRich(t.ranked || [], rich);', '  const all = t.ranked || [];',
    'theReadServesEveryStepItsCheckAndRecommendation',
    'the rebuilt numbers are kept and never laid on, so the worst-losing-streak limit refuses every row again'],
  [path.join(ROOT, 'public', 'construct.js'), "    else if (n > st.step) markStep(st.step);", '',
    'marksTravelFromThePageToTheSetAndBack',
    'walking past a disagreement leaves no mark, and the set reads as clean evidence'],
  [path.join(ROOT, 'public', 'construct.js'), '<button id="fKeepRegion" class="pri">keep the widest region</button>', '',
    'everyStepHasItsControlAndItsCheckDrawn',
    'step 5 goes back to printing an answer nobody can act on'],
  // 3.39.1 -- the top-up, the fill box, the poll redraw.
  [path.join(ROOT, 'lib', 'stagework.js'), "    for (let d = from; d < keep; d++) {\n      const dt = streamFor(stream.decision, agr, d, 'test');",
    "    for (let d = 0; d < keep; d++) {\n      const dt = streamFor(stream.decision, agr, d, 'test');",
    'aTopUpPricesOnlyTheMissingScramblesAndAppendsThem',
    'a top-up re-prices every scramble from the first, and one more kept costs the whole five hours again'],
  [path.join(ROOT, 'lib', 'stages.js'), '          const keptT = sw.appendKept(x.row.noiseTest, from, freshT);',
    '          const keptT = { arr: freshT, padded: 0 };',
    'aTopUpPricesOnlyTheMissingScramblesAndAppendsThem',
    'the rewrite REPLACES the ten figures already on every row with the one just added -- the good data the owner warned about, deleted'],
  [path.join(ROOT, 'public', 'construct.js'), '    if (haveNow && keep > haveNow) {', '    if (false) {',
    'theFillBoxStartsOnWhatTheSetKeepsAndAsksBeforeRaisingIt',
    'a slip of the number starts a five-hour run with no question asked'],
  [path.join(ROOT, 'public', 'construct.js'), '  try { holdScrollMemory(); return drawBoards().then(() => holdScrollMemory()); } finally { waitSilent = false; }',
    '  try { return drawBoards().then(() => restoreScroll(tab)); } finally { waitSilent = false; }',
    'aPollRedrawLeavesThePlaceOnThePageAlone',
    'every four seconds the owner is put back where the page last remembered them'],
  [path.join(ROOT, 'lib', 'funnel.js'), 'const checkKindOf = (check) => (check && Number(check.k) > 0 ? \'scrambles\' : \'halves\');',
    'const checkKindOf = (check) => (check && Array.isArray(check.copies) && check.copies.length ? \'scrambles\' : \'halves\');',
    'aValueCountsWhenItBeatsEveryCopyOrBothHalves',
    'the check goes back to wanting copies of the board, which is what killed the service twice'],
  [path.join(ROOT, 'lib', 'stages.js'), '      counts[x.dial] = n > 0;', '      counts[x.dial] = x.m > 0.2;',
    'stepOneBoldsOnlyADialWithAValueThatBeatsTheCheck',
    'step 1 goes back to bolding dials by how far apart their piles sit, direction be damned, and sends the owner to narrow a dial whose forecast loses more than a shuffle'],
  [path.join(ROOT, 'lib', 'funnel.js'), 'const beats = (real, other) => real != null && other != null && cents(real) > cents(other);',
    'const beats = (real, other) => real != null && other != null && real > other;',
    'aValueEqualToItsCopiesToTheCentDoesNotBeatThem',
    'a setting whose copies equal its money to the cent beats all ten or none of them on a hundred-trillionth of a dollar, and step 1 bolds it at random'],
  // ---- ONE RULE PER COIN-AND-SHAPE UNIT (3.41.0, §17) ----
  [path.join(ROOT, 'lib', 'stages.js'),
    "      if (r.trade !== unit.trade || r.geometry !== unit.geometry || (r.ctx1 || null) !== unit.ctx1 || (r.ctx2 || null) !== unit.ctx2) continue;",
    "      if (r.trade !== unit.trade) continue;",
    'aUnitsBoardIsItsOwnRecordsAndNobodyElses',
    'a block that holds two units of one coin hands both to the board, and a coin-and-shape walk is silently two shapes'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (key === 'all') return blendBoard(t);", "  if (key === 'all' || !key) return blendBoard(t);",
    'theBlendIsChosenByNameAndNothingChosenIsTheFirstUnit',
    'the first visit to a set opens on the blend the owner said adds noise, and the cut on that visit writes a blended set'],
  [path.join(ROOT, 'lib', 'stages.js'), "    if (u.key === here) continue;", "",
    'readingTheOtherUnitsAppliesTheRuleToEachOfThem',
    'the walked unit is counted among the others, and a rule built on it reads as holding elsewhere on itself'],
  [path.join(ROOT, 'lib', 'stages.js'), "    const board = withFunnelRich(await loadUnitBoard(id, t, u.key), rich);", "    const board = await loadUnitBoard(id, t, u.key);",
    'readingTheOtherUnitsAppliesTheRuleToEachOfThem',
    'a rule with a limit on the worst losing streak keeps nothing on every other unit and reports each as empty'],
  [path.join(ROOT, 'lib', 'stages.js'), "    const src = r.unit && x.units && x.units[r.unit] ? x.units[r.unit] : x;", "    const src = x;",
    'aUnitBoardRowTakesTheUnitsOwnRebuiltNumbers',
    'a limit set on one unit reads the average across ten, and the unit whose losing streak is worst passes on the strength of the others'],
  [path.join(ROOT, 'lib', 'stages.js'), "  return x && x.v === FUNNEL_RICH_V ? x : null;", "  return x;",
    'aUnitBoardRowTakesTheUnitsOwnRebuiltNumbers',
    'a file of the older shape, with no per-unit numbers, is read around instead of rebuilt (RULE NINE)'],
  [path.join(ROOT, 'lib', 'stages.js'), "    unitName: board.name,\n  });", "    unitName: null,\n  });",
    'theCutIsMadeOnTheUnitAndTheSetSaysWhichUnit',
    'a set cut on a unit does not say which, and ten sets are ten unlabelled rules'],
  [path.join(ROOT, 'public', 'construct.js'), "    unit: st.unit,                                        // null: the set's first unit; 'all': the blend",
    "    unit: null,",
    'theScreenSendsTheUnitItIsWalkingOnToTheReadTheAcrossAndTheCut',
    'every read is of the first unit whatever the picker says, and the screen heading names one unit while the numbers are another'],
  [path.join(ROOT, 'public', 'construct.js'), "      marks: st.marks || [],\n      unit: st.unit,\n    });", "      marks: st.marks || [],\n    });",
    'theScreenSendsTheUnitItIsWalkingOnToTheReadTheAcrossAndTheCut',
    'the walk is on one unit and the cut writes the first, and the set says so in its name while its rule came from elsewhere'],
  [path.join(ROOT, 'public', 'construct.js'), "      ? (a4 ? { positive: a4.positive, of: a4.of, check: null, beatsAll: a4.beatsAll } : null)",
    "      ? { positive: r.positive, of: r.of, check: r.check || null }",
    'onAUnitsBoardStepFourIsReadByPressingAndTheAcceptRecordsThatRead',
    'the accept on a unit board records undefined of undefined, because the pressed reading carries no counts of its own'],
  [path.join(ROOT, 'lib', 'stages.js'), "    if (!acrossRun.result && !acrossRun.error) throw new Error('the other units are still being read for another rule — one reading at a time');",
    "    if (false) throw new Error('the other units are still being read for another rule — one reading at a time');",
    'readingTheOtherUnitsRunsInTheBackgroundAndIsPolled',
    'a second rule pressed while the first is reading starts a second reading over the same boards, and the first page polls a status that is no longer its own'],
  [path.join(ROOT, 'public', 'construct.js'), "      if (!s || s.none || s.token !== asked.token) { st.acrossAsked = null; fSave(); if ($('#fAcross')) drawFunnel(); return; }",
    "      if (!s || s.none) { st.acrossAsked = null; fSave(); if ($('#fAcross')) drawFunnel(); return; }",
    'onAUnitsBoardStepFourIsReadByPressingAndTheAcceptRecordsThatRead',
    'a page that comes back adopts whatever reading the box holds -- another rule, another window -- as its own and records it on the set'],
  [path.join(ROOT, 'lib', 'stages.js'), "    units = units.map((u, i) => ({ u, i })).sort((a, b) => (at(a.u) - at(b.u)) || (a.i - b.i)).map((x) => x.u);",
    "    units = units.slice();",
    'theUnitsAreListedInTheStageTwoTablesOrder',
    'the dropdown follows the order the units happened to finish pricing, and the first unit of a set is whichever finished first'],
  // ---- THE BAR (3.45.0) ----
  [path.join(ROOT, 'lib', 'funnel.js'), "      const counts = cm.length > 0 && beaten >= bar;", "      const counts = cm.length > 0 && cm.every((v) => beats(r.mean, v));",
    'aValueCountsWhenItBeatsAtLeastTheBarOfTheCopies',
    'the bar on the screen is drawn and never read, and every value still has to beat all ten'],
  [path.join(ROOT, 'public', 'construct.js'), "      barPct: st.barPct,                                    // null: the engine's default share of the copies\n",
    "      barPct: null,                                         // null: the engine's default share of the copies\n",
    'theScreenOffersTheBarAndSendsItWithEveryRead',
    'the box is drawn and saved but every read ignores it — the walk is always read at the default share'],
  // ---- A SETTING CARRIES ITS PLACE IN THE BLOCK TO THE UNIT (3.52.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "      const mine = heldOn[pi].map((i) => ({ ...settings[i], si: i }));", "      const mine = heldOn[pi].map((i, k) => ({ ...settings[i], si: k }));",
    'theStageThreePricingIsHandedOutInParts',
    'a unit numbers its settings from its own list, and a weekly unit files its records at places the plan names differently'],
  // ---- A UNIT WITH NO WEEKDAY VERSION READS 24/5 BOTH WAYS ALIKE (3.52.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "      const key = `${repOf.get(shapeKeyOf(st))}|${foldKeyRest(st, wkApplies ? !!st.weekdaysOnly : false)}`;", "      const key = `${repOf.get(shapeKeyOf(st))}|${foldKeyRest(st, !!st.weekdaysOnly)}`;",
    'aUnitHoldsOnlyTheSettingsThatPlaceDifferentOrdersOnIt',
    'a weekly unit holds both values of 24/5 as two records of one trade, which is the fault this release exists to end'],
  // ---- THE COUNT READS THE SAME PER-UNIT KEY (3.52.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "      const key = `${it.g}|${repOf.get(shapeKeyOf(it.shape))}|${wkApplies ? (it.wk ? 1 : 0) : 0}`;", "      const key = `${it.g}|${repOf.get(shapeKeyOf(it.shape))}|${it.wk ? 1 : 0}`;",
    'theStageThreeCountIsTheLaunchsFoldWithoutTheSettings',
    'the cost line counts both values of 24/5 on a weekly unit while the launch prices one, so the launch refuses every block with a weekly unit'],
  // ---- THE FOLD MIGRATION KEEPS ONLY WHAT THE UNIT HOLDS (3.52.0) ----
  // ---- THE OWNER'S BLOCK IS DRAWN IN ITS OWN COLOUR (3.52.1) ----
  [path.join(ROOT, 'public', 'construct.js'), ' <b class="fpick">Your block: ', ' <b>Your block: ',
    'theThirdStepSaysHowToWalkItAndShowsTheOwnersBlockInGreen',
    'the line that says which values the owner\'s block covers is drawn like any other note'],
  // ---- STEP 4 FINDS THE READING UNDER THE KEY THE PRESS FILED IT UNDER (3.55.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "    const a = st.across && st.across.ruleKey === fAcrossKey(st) ? st.across : null;", "    const a = st.across && st.across.ruleKey === JSON.stringify(st.rule) ? st.across : null;",
    'theAcrossIsKeyedOnTheBarAsWellAsTheRule',
    'read the other units reads the boards and the page never shows what came back'],
  // ---- remove DROPS THE CLAUSE (3.55.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "      delete st.rule[kind][key];\n      if (!st.steps) st.steps = [];", "      if (!st.steps) st.steps = [];",
    'everyClauseOfTheRuleHasItsOwnRemove',
    'remove records a removal in the notes and leaves the clause in the rule'],
  // ---- THE PROOF COMPARES LIKE WITH LIKE (3.57.3) ----
  [path.join(ROOT, 'lib', 'stages.js'), "      const u = (got.units || []).find((x) => unitKeyOf(x) === onUnit);", "      const u = (got.units || [])[0];",
    'theProofComparesTheFigureTheBoardActuallyHolds',
    'the check reads whichever unit was priced first instead of the one the board is showing, so a sound rebuild reads as a different run'],
  [path.join(ROOT, 'lib', 'stages.js'), "      if (mismatches.length < 20) mismatches.push({ label, stored: Number(want), rebuilt: mine });", "      mismatches.push({ label, stored: Number(want), rebuilt: mine });",
    'theProofComparesTheFigureTheBoardActuallyHolds',
    'the list of disagreements is unbounded again, and a set where everything differs sends every name to the screen'],
  // ---- ALL FOUR COMPARISONS GATE (3.100.0) ----
  [path.join(ROOT, 'lib', 'funnelverify.js'),
    "    pass: comparisons.known && positive && comparisons.beatsBest === true,",
    "    pass: comparisons.known && positive,",
    'theRuleMustBeatTheBestOfTheFourNotOnePairOfThem',
    'the money gate is being in the money and nothing else, so a rule that made less than simply going one way the whole time stands'],
  [path.join(ROOT, 'lib', 'funnelverify.js'),
    "  comparisons.best = knownFour.length === GATED.length",
    "  comparisons.best = knownFour.length > 0",
    'aMissingOneOfTheFourLeavesNoBestAndNothingPasses',
    'the best of the four is named from whichever of them happen to be priced, so beating three of four passes as though the fourth had been beaten too'],
  [path.join(ROOT, 'lib', 'funnelverify.js'),
    "    noFigure: list.length - priced.length,",
    "    noFigure: 0,",
    'theDroppedSettingsAreReadBesideTheKeptOnesAndSayWhetherThePickingDidAnything',
    'a side never reports the settings it has no figure for, so a board half of which was never priced reads as a whole one'],
  // ---- WHAT A RULE HAS TO BEAT BESIDES A SHUFFLE (3.70.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "    out.conditions.losesToBuyHold = against.keeping.beatsBuyHold === false;", "",
    'losingToBuyingTheCoinAndGoingAwayIsRecordedOnTheSet',
    'a rule that made less than buying the coin and going away leaves no mark, so the set does not carry the one reason it should not exist'],
  [path.join(ROOT, 'lib', 'stages.js'), "    out[`beats${k[0].toUpperCase()}${k.slice(1)}`] = c ? F.beats(real, c.hi) : null;",
    "    out[`beats${k[0].toUpperCase()}${k.slice(1)}`] = c ? F.beats(real, c.lo) : null;",
    'aBoardSaysWhatItHasToBeatBesidesLuckBeforeAnythingIsNarrowed',
    'beaten is read at the kindest of the hold lengths in use instead of the worst, so a rule clears a bar it never faced'],
  [path.join(ROOT, 'lib', 'stagework.js'), "  for (const [k, v] of holdCtlCache) controls[k] = v;", "",
    'aBoardSaysWhatItHasToBeatBesidesLuckBeforeAnythingIsNarrowed',
    'the four are worked out during the pricing and thrown away again, so no screen can ever show them'],
  // ---- TRAINING BY WHAT EACH TRADE WAS WORTH (3.69.0) ----
  [path.join(ROOT, 'lib', 'stagework.js'), "    return Math.max(0, m - trip) + m + trip;", "    return m;",
    'theWeightOfATrainingTradeIsWhatItsDecisionWasWorth',
    'a trade too small to cover its fees is worth nothing, so nothing teaches the forecast to stay out and every crumb is taken'],
  [path.join(ROOT, 'lib', 'stagework.js'), "  return stakes.map((x) => Math.min(cap, x / avg));", "  return stakes.map((x) => x / avg);",
    'theWeightOfATrainingTradeIsWhatItsDecisionWasWorth',
    'one freak trade can outweigh fifty ordinary ones and the limit on the screen does nothing'],
  [path.join(ROOT, 'lib', 'stagework.js'), "  return stakes.map((x) => Math.min(cap, x / avg));", "  return stakes.map((x) => Math.min(cap, x));",
    'theWeightOfATrainingTradeIsWhatItsDecisionWasWorth',
    'the average trade no longer counts 1, so the strength of the fit means something different from run to run'],
  [path.join(ROOT, 'lib', 'stagework.js'), "    const { model: m, chosenLambda } = await tuneAndTrain(Ztr, ytr, { onProgress: () => {}, exampleWeights: wAll });",
    "    const { model: m, chosenLambda } = await tuneAndTrain(Ztr, ytr, { onProgress: () => {} });",
    'countingMoneyRatherThanTradesChangesWhatBothForecastsLearn',
    'the first kind of forecast is trained with every trade counting the same, whatever the owner asked for'],
  [path.join(ROOT, 'lib', 'stagework.js'), "    const m = await trainBoost(Xtr, ytr, { rounds: probe.bestRound, weights: wAll });",
    "    const m = await trainBoost(Xtr, ytr, { rounds: probe.bestRound });",
    'countingMoneyRatherThanTradesChangesWhatBothForecastsLearn',
    'the second kind of forecast is trained with every trade counting the same, whatever the owner asked for'],
  [path.join(ROOT, 'lib', 'stagework.js'), "  return trainOnOf(p) === 'money' ? moneyWeights(trainChunks, fee, capOf(p)) : null;",
    "  return null;",
    'countingMoneyRatherThanTradesChangesWhatBothForecastsLearn',
    'the tick does nothing at all: every run trains on direction and the record says otherwise'],
  [path.join(ROOT, 'lib', 'stages.js'), "    trainOn,\n    weightCap,", "",
    'howAUnitWasTrainedIsTheOwnersChoiceAndRidesOnTheRecord',
    'the setting never reaches the workers, so the tick is decoration'],
  // ---- A STAGE 4 SET IS SAVED PROPERLY (3.68.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "    settings: had && had.settings ? { ...had.settings } : {},", "    settings: {},",
    'aSecondPassNeverTakesTheRebuiltNumbersOffAnEarlierSet',
    'a second walk over the same stage 3 records takes the rebuilt numbers off every earlier Stage 4 set, and their rules stop keeping anything'],
  [path.join(ROOT, 'lib', 'stages.js'), "  doc.rich = richForSurvivors(survivors);", "",
    'aStageFourSetKeepsItsOwnCopyOfTheNumbersItsRuleReads',
    'a set keeps no copy of the numbers its own rule reads, so it depends for ever on a file its parent owns'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const mine = withOwnRich(all, doc.rich);", "  const mine = all;",
    'aStageFourSetKeepsItsOwnCopyOfTheNumbersItsRuleReads',
    'the set keeps its own copy and never reads it, so a column the parent lost stays empty on the screen'],
  [path.join(ROOT, 'lib', 'stages.js'), "    for (const [f, v] of Object.entries(x)) if (o[f] == null) o[f] = Array.isArray(v) ? v.slice() : v;",
    "    for (const [f, v] of Object.entries(x)) if (o[f] === undefined) o[f] = Array.isArray(v) ? v.slice() : v;",
    'aStageFourSetKeepsItsOwnCopyOfTheNumbersItsRuleReads',
    'a board row carrying an explicit nothing is left alone, and those are exactly the rows the set copy exists to fill'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const nowOwn = S4.applyRule(mine, S4.normaliseRule(doc.rule));", "  const nowOwn = now;",
    'aSetSaysWhichNumbersItsRuleReadsAreGoneAndOffersToWorkThemOut',
    'the set cannot tell a board that moved from a number that was taken away, so it reads as broken either way'],
  [path.join(ROOT, 'public', 'construct.js'), '      <button id="fSetRebuild">work out the missing numbers</button>', '',
    'aSetSaysWhichNumbersItsRuleReadsAreGoneAndOffersToWorkThemOut',
    'a set whose numbers a later pass took away has no way at all to get them back'],
  // ---- THE NAME THE OWNER TYPED STAYS IN THE BOX (3.67.1) ----
  [path.join(ROOT, 'public', 'construct.js'), "    if (got) { rememberSweepForm(); say('#swOut1',", "    if (got) { $('#swName1').value = ''; rememberSweepForm(); say('#swOut1',",
    'theNameBoxIsOnEveryStageOfSweepAndTheLaunchSendsIt',
    'the stage 1 name box empties itself the moment the start goes through, so what says which set was just launched disappears'],
  // ---- THE CUT DOES NOT HOLD THE BOX (3.67.0) ----
  [path.join(ROOT, 'lib', 'funnelset.js'), "    missing: had.filter((l) => !gotSet.has(l)).slice(0, 20),", "    missing: had.filter((l) => !got.includes(l)).slice(0, 20),",
    'theCutHandsTheThreadBackAndNeverComparesEveryNameAgainstEveryName',
    'every name is compared against every name again -- millions of comparisons on a big rule, on the one thread that answers every screen'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const survivors = await S4.applyRuleSlowly(ranked, doc.rule, note);", "  const survivors = S4.applyRule(ranked, doc.rule);",
    'theCutHandsTheThreadBackAndNeverComparesEveryNameAgainstEveryName',
    'the cut reads the whole board without ever handing the thread back, so every other screen waits on it'],
  [path.join(ROOT, 'public', 'construct.js'), "    const out = started ? await fCutFollow(st) : null;", "    const out = started;",
    'theCutStartsAndIsPolledSoNoOneRequestIsHeldOpen',
    'the press takes the start of the cut for its answer and lands on a set that does not exist yet'],
  [path.join(ROOT, 'public', 'construct.js'), "const tryPost = async (p, body, where = WHERE_SWEEP) => {", "const tryPost = async (p, body) => {\n  const where = WHERE_SWEEP;",
    'aPressThatTimesOutSaysWhereItsOwnAnswerWillShow',
    'every press that times out points at Sweep and Boards again, whatever screen it was pressed on'],
  // ---- WRITING A SET LANDS ON IT; THE NAME BOX AND THE ROWS BOX (3.66.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "    if (out.id) { st.cut = out.id; fSave(); return drawFunnel(); }", "",
    'writingAStageFourSetLandsOnTheSetItJustWrote',
    'writing a set leaves the walk on screen with a line of text, and the set is nowhere the owner can see'],
  [path.join(ROOT, 'public', 'construct.js'), "<label class=\"f\" style=\"flex:1 1 30rem;min-width:14rem\">name<input id=\"fName\" style=\"width:100%\"",
    "<label class=\"f\">name<input id=\"fName\" style=\"width:14rem\"",
    'theNameBoxOnStepSevenTakesTheRoomTheRowHasLeft',
    'the name box is a fixed 14rem again and the names it holds run out of it'],
  // ---- THE NUMBERS JUST WORKED OUT ARE ON SCREEN (3.65.1) ----
  [path.join(ROOT, 'public', 'construct.js'), "      : `done for ${out.settings} setting(s) - NOT checked against the sweep (${String(pr.why || '')})`;\n    fSave(); drawFunnel();",
    "      : `done for ${out.settings} setting(s) - NOT checked against the sweep (${String(pr.why || '')})`;",
    'theNumbersJustWorkedOutAreOnScreenBeforeTheAnswerBesideTheButtonIs',
    'the press works the numbers out and never reads them back, so the two limits below it go on saying no survivor carries one'],
  [path.join(ROOT, 'public', 'construct.js'), "    st.rebuiltSaid = pr.ran", "    const rebuiltSaid = pr.ran",
    'theNumbersJustWorkedOutAreOnScreenBeforeTheAnswerBesideTheButtonIs',
    'what the press said is not kept on the walk, so the redraw that fetches the numbers wipes the proof off the screen'],
  // ---- THE TWO WALLS THAT ARE NOT MONEY (3.65.0) ----
  [path.join(ROOT, 'lib', 'plateau.js'), "  const cross = across.filter((a) => categorical.includes(a));", "  const cross = [];",
    'aMoneyBarAloneCannotGrowARegionAcrossAWordValuedDial',
    'a dial named to cross stays in the slice, so the region is walled off exactly as it was and the screen says it was crossed'],
  [path.join(ROOT, 'lib', 'plateau.js'), "  const across = (Array.isArray(opts.across) ? opts.across : []).filter((a) => categorical.includes(a));", "  const across = [];",
    'aMoneyBarAloneCannotGrowARegionAcrossAWordValuedDial',
    'naming a word-valued dial to cross does nothing at all, and no bar however low can grow the region past it'],
  [path.join(ROOT, 'lib', 'plateau.js'), "  const reach = Number.isFinite(Number(opts.reach)) && Number(opts.reach) >= 1 ? Math.floor(Number(opts.reach)) : 1;", "  const reach = 1;",
    'aRegionCanBeJoinedOverSettingsThatAreNotOnTheBoardAtAll',
    'a step is one notch whatever the owner sets, so a setting missing from the board walls the region off for ever'],
  [path.join(ROOT, 'lib', 'plateau.js'), "    if (i < wordFrom && d > far) return false;", "    if (i < wordFrom && d > 1) return false;",
    'aRegionCanBeJoinedOverSettingsThatAreNotOnTheBoardAtAll',
    'the reach is reported on the reading and ignored by the walk, so the screen says the region was joined over gaps it never crossed'],
  [path.join(ROOT, 'lib', 'plateau.js'), "      ? [...new Set(bestComp.map((n) => nodes[n].row[a]))]", "      ? centreRow[a]",
    'aMoneyBarAloneCannotGrowARegionAcrossAWordValuedDial',
    'the rule keeps one value of a dial the region crossed, so keeping the region keeps half of it and calls it the region'],
  [path.join(ROOT, 'lib', 'stages.js'), "    out.conditions.regionAcross = across.length > 0;", "",
    'loosening_theRegionBeyondMoneyIsOfferedByTheEngineAndMarkedOnTheSet',
    'a region joined across a word-valued dial leaves no mark, so the set does not say the region was widened past what money explains'],
  [path.join(ROOT, 'public', 'construct.js'), "    st.regionAcross = [...document.querySelectorAll('[data-facross]')].filter((x) => x.checked).map((x) => x.dataset.facross);", "",
    'loosening_theRegionBeyondMoneyIsOfferedByTheEngineAndMarkedOnTheSet',
    'ticking a dial does nothing: the read never carries it and the region never grows'],
  // ---- STEP 5 LOOSENED, AND A WAY PAST IT (3.64.0) ----
  [path.join(ROOT, 'lib', 'plateau.js'), "  const good = all.filter((r) => clears(r, minTrades, atLeast));", "  const good = all.filter((r) => clears(r, minTrades));",
    'theRegionBarCanBeLoosenedSoOneWeakSettingDoesNotSplitAWideArea',
    'the bar is set on the screen and ignored by the region, so one weak setting splits a wide area again and the screen says otherwise'],
  [path.join(ROOT, 'lib', 'stages.js'), "      { minTrades: 0, atLeast, across, reach, orderedAxes: ordered, categoricalAxes: F.CATEGORICAL_DIALS },",
    "      { minTrades: 0, across, reach, orderedAxes: ordered, categoricalAxes: F.CATEGORICAL_DIALS },",
    'theRegionBarCanBeLoosenedSoOneWeakSettingDoesNotSplitAWideArea',
    'the bar never reaches the region reader, so it reaches neither the real region nor its copies'],
  [path.join(ROOT, 'lib', 'stages.js'), "    out.conditions.regionPapered = (out.reading.papered || {}).n > 0;", "",
    'wideningTheRegionOverLosersIsCountedAndMarked',
    'a region widened over settings that lost money leaves no mark on the set, so the record does not show it'],
  [path.join(ROOT, 'lib', 'plateau.js'), "    if (!Number.isFinite(v) || v > 0) continue;", "    if (!Number.isFinite(v)) continue;",
    'wideningTheRegionOverLosersIsCountedAndMarked',
    'every setting in the region is counted as one the bar papered over, so a region at the old bar reports losers it never held'],
  [path.join(ROOT, 'public', 'construct.js'), "    st.step = 6; fSave(); drawFunnel();", "    fSave(); drawFunnel();",
    'theOwnersOwnRuleCanBeCarriedWholeIntoStepSix',
    'keep my own rule and go on records the choice and then stays on step 5, so it does nothing the owner can see'],
  // ---- WHICH CROSSES ARE WORTH READING (3.63.0) ----
  [path.join(ROOT, 'lib', 'funnel.js'), "    if (!sp.joint) continue;                  // says nothing the two ranges do not",
    "    if (!sp.interact) continue;               // says nothing the two ranges do not",
    'theListOffersOnlyTheCrossesThatSaySomething',
    'pairs whose block spans one whole axis are listed as crosses worth reading, and every one of them says only what a single range on one dial says'],
  [path.join(ROOT, 'lib', 'funnel.js'), "    await new Promise((resolve) => { setImmediate(resolve); });", "",
    'theCrossReadingYieldsBetweenPairsAndNeverRanksByMoney',
    'the reading stops yielding, so every other screen on the box freezes for as long as it runs -- minutes, on a board with nothing narrowed'],
  [path.join(ROOT, 'public', 'construct.js'), "  if (cx && st.crossesOn && !crossHeld && !crossBad && !st.crossesAsked) startCrosses();",
    "  if (cx && st.crossesOn && !crossHeld && !st.crossesAsked) startCrosses();",
    'theCrossListIsAlwaysOnStepThreeAboveThePickers',
    'a reading that failed is started again on every single draw, for ever'],
  [path.join(ROOT, 'public', 'construct.js'), "  if (!list.length) return `${head}${counted}`;", "  if (!list.length) return head;",
    'theCrossListIsAlwaysOnStepThreeAboveThePickers',
    'a reading that finds nothing says nothing, and reads exactly like a reading that never ran'],
  // ---- NONE ON ITS OWN (3.62.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "      st.rule.allowed[st.dial] = ['none'];", "",
    'noneCanBeKeptOnItsOwnOnStepTwo',
    'clearing both boxes with the tick on writes nothing at all, so none can only ever be added to a range again'],
  // breaks BOTH copies, which is the point: neither branch may leave a
  // none-only clause standing beside a range
  [path.join(ROOT, 'public', 'construct.js'), "      delete st.rule.allowed[st.dial];", "",
    'noneCanBeKeptOnItsOwnOnStepTwo',
    'a range written after none-only leaves both clauses on the dial, and the two together keep nothing at all'],
  [path.join(ROOT, 'public', 'construct.js'), "  const onlyNone = hasNone && alsoNone && lo === '' && hi === '';", "  const onlyNone = false;",
    'noneCanBeKeptOnItsOwnOnStepTwo',
    'the count drawn with the table says a cleared pair of boxes keeps everything, which is the opposite of what pressing does'],
  // ---- THE RULE THE OWNER BUILT, AND A BOX WORTH READING (3.61.0) ----
  [path.join(ROOT, 'lib', 'funnelset.js'), "  const dialOf = (text) => String(text || '').trim().split(/[\\s(]/)[0].trim();",
    "  const dialOf = (text) => String(text || '').trim().split(' (')[0].trim();",
    'theOwnersRuleIsReplayedFromTheStepsTheWalkRecorded',
    'a clause the owner REMOVED is replayed straight back into their own rule, because the whole clause reads as the dial name'],
  [path.join(ROOT, 'lib', 'stages.js'), "    if (userRule) { doc.userRule = userRule; saveSet(doc); userStamped = true; }", "",
    'theRuleTheOwnerBuiltIsKeptWhenStepFiveReplacesIt',
    'the recovered rule is never written onto the record, so every single read replays it from the steps again'],
  [path.join(ROOT, 'public', 'construct.js'),
    "    st.userRule = { ranges: JSON.parse(JSON.stringify(st.rule.ranges || {})), allowed: JSON.parse(JSON.stringify(st.rule.allowed || {})) };", "",
    'theRuleTheOwnerBuiltIsKeptWhenStepFiveReplacesIt',
    'keep the widest region goes back to throwing away everything the owner chose with no copy of it anywhere'],
  [path.join(ROOT, 'public', 'construct.js'), "  const share = Math.round(window.innerHeight * 0.72);", "  const share = Math.round(window.innerHeight * 0.45);",
    'theStageFourRowsHaveTheirOwnBoxSizedToTheScreen',
    'the box goes back to showing four settings at once when the owner asked for about eight'],
  [path.join(ROOT, 'public', 'construct.js'), '<h4 style="margin:1rem 0 .3rem">User Rule:</h4>', '<h4 style="margin:1rem 0 .3rem">Rule:</h4>',
    'theStageFourScreenIsDisplayOnlyExceptForTheRename',
    'the two rules stop being told apart on the heading, and the one the owner built reads as the one that replaced it'],
  // ---- THE ROWS HAVE THEIR OWN BOX (3.60.0) ----
  [path.join(ROOT, 'public', 'construct.js'), '<div class="s4box" id="fCutRows">', '<div>',
    'theStageFourRowsHaveTheirOwnBoxSizedToTheScreen',
    'the rows lose their own box and scroll bar, and the whole page scrolls again'],
  [path.join(ROOT, 'public', 'construct.js'), "  const room = below >= share ? below : Math.min(scrolled, share);", "  const room = 600;",
    'theStageFourRowsHaveTheirOwnBoxSizedToTheScreen',
    'the box height is a number somebody picked instead of the room the browser measures, so it overflows a laptop and wastes a monitor'],
  [path.join(ROOT, 'public', 'construct.html'), "div.s4box { overflow-y:auto; overflow-x:hidden; }", "div.s4box { }",
    'theStageFourRowsHaveTheirOwnBoxSizedToTheScreen',
    'the box has no scroll bar, so a set of five hundred settings runs off the bottom of the window'],
  // ---- THE OWNER'S FOUR FORMATTING ORDERS (3.59.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "      ${fCutPickBox(d, st)}\n", "",
    'theTitleAndTheTwoSelectorsAreAlwaysAtTheTop',
    'the Stage 4 record set box leaves the title section, so on the walk there is no control on screen to reach a set already cut'],
  [path.join(ROOT, 'public', 'construct.js'), "    if (cs.value === F_NEW && fWalkWasAlreadyCut(d)) fFreshWalk(st);", "",
    'aNewRuleStartsAtStepOneWhenTheWalkHasAlreadyBeenCut',
    'new rule drops back into the finished walk at step 7 with its own rule still on it, which is the old rule wearing the words'],
  [path.join(ROOT, 'lib', 'stages.js'), "      ruleSentence: d.ruleSentence || null,", "      ruleSentence: null,",
    'aNewRuleStartsAtStepOneWhenTheWalkHasAlreadyBeenCut',
    'nothing can tell whether the walk on hand is the one a set was already cut from, so new rule never starts fresh'],
  [path.join(ROOT, 'public', 'construct.js'), "    const title = $('#fTitleName');", "    const title = null;",
    'renamingAStageFourSetChangesTheBoldNameOnTheSpot',
    'a rename leaves the old name in the bold line at the top, which reads as a rename that did not take'],
  [path.join(ROOT, 'public', 'construct.html'), "table.s4 thead th { position:sticky; top:0;", "table.s4 thead th { position:static; top:0;",
    'theStageFourTableIsThreeRowsPerSettingAndCannotScrollSideways',
    'the headings scroll away with the rows, so a reader halfway down the set cannot tell which number is which'],
  [path.join(ROOT, 'public', 'construct.js'), '<td class="s4what" colspan="${cols}"', '<td class="s4what"',
    'theStageFourTableIsThreeRowsPerSettingAndCannotScrollSideways',
    'what a setting IS stops spanning the table, so the row it sits on squeezes into one column and the layout breaks'],
  // ---- THE STAGE 4 RECORD SETS ON THE FUNNEL (3.58.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  const same = now.length === wanted.length && now.every((r) => had.has(r.label));", "  const same = true;",
    'aStageFourSetsRowsAreTheSettingsItWroteDownNotWhatItsRuleFindsToday',
    'a Stage 4 set whose rule no longer gives its own survivors reads as if it did, so a moved board is invisible'],
  // the break has to leave VALID JavaScript: deleting the `if` off this line
  // orphans the `else` under it, the file stops parsing, and the harness sees a
  // load failure rather than "FAIL <this test>" -- which reads as a guard that
  // is not being checked when it is. Widening the condition breaks the same
  // behaviour and parses (found by the guards themselves, 2026-09-04).
  [path.join(ROOT, 'lib', 'stages.js'), "    if (seen.size > 1) varying.push(dial);", "    if (seen.size >= 1) varying.push(dial);",
    'aDialTheRuleFixedIsSaidOnceAboveTheStageFourTable',
    'every dial gets a column again, including the ones the rule pinned to one value on every row'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const per = Math.max(1, Math.min(500, Math.floor(Number(opts.n) || 50)));", "  const per = 500;",
    'theStageFourTableSortsTheWholeSetAndPagesIt',
    'the page size is ignored, so a set of half a million rows is sent to the screen in one reply'],
  [path.join(ROOT, 'public', 'construct.js'), "api/stageset/${encodeURIComponent(cd.set.id)}/name", "api/stageset/${encodeURIComponent(cd.set.id)}/rename",
    'theStageFourScreenIsDisplayOnlyExceptForTheRename',
    'the one control on the Stage 4 screen that writes stops writing, silently'],
  [path.join(ROOT, 'public', 'construct.js'), "      view: (st.cut && st.cut !== F_NEW) ? 'cut' : null,", "      view: null,",
    'aStageFourSetThatWillNotOpenStillDrawsThePicker',
    'every Stage 4 view pays for a whole step reading -- the grid, the region, the copies -- that nothing draws'],
  // ---- THE REBUILD CHECKS ITSELF AGAINST THE SWEEP (3.57.2, re-aimed 3.102.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "      if (r.avgTest != null && Number.isFinite(Number(r.avgTest))) expect[String(r.label)] = Number(r.avgTest);", "",
    'pressingWorkOutTheMissingNumbersPrepsTheWholeRecordSet',
    'every rebuild goes back to reading NOT checked against the sweep, so a run against moved price data looks the same as a sound one'],
  // ---- THE PRESS PREPS THE WHOLE RECORD SET (3.102.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "    const board = await funnelBoard(String(id), t, 'all');", "    const board = await funnelBoard(String(id), t, state.unit);",
    'pressingWorkOutTheMissingNumbersPrepsTheWholeRecordSet',
    'the press prices one board again instead of the whole set, so the ranking above step 1 reads a slice and calls it the set'],
  // ---- THE RANKING IS READ ONCE AND THE BAR MOVES ON IT (3.102.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  if (holdRun && holdRun.result && holdRun.id === String(id)) return holdAnswer(holdRun, bar);", "",
    'theBarNeverCausesABoardToBeReadAgain',
    'every nudge of the bar reads every board of the set off disk again'],
  [path.join(ROOT, 'lib', 'rankhold.js'), "const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));",
    "const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));",
    'theBarIsTheOwnersAndReAppliesWithoutReReading',
    'a bar nobody set reads as a bar of zero, so every coin and shape whose order is not inverted passes a bar that was never asked for'],
  // ---- ONE JOB, ONE NAME, ON BOTH SCREENS (3.103.2) ----
  [path.join(ROOT, 'public', 'construct.js'), '<button id="fSetRebuild">work out the test history numbers</button>',
    '<button id="fSetRebuild">work out the missing numbers</button>',
    'aSetSaysWhichNumbersItsRuleReadsAreGoneAndOffersToWorkThemOut',
    'the Stage 4 set goes back to a name no other screen uses, for the same job the walk names differently'],
  // ---- ENSURE ANSWERS WHETHER, readTally ANSWERS WITH WHAT (3.103.1) ----
  [path.join(ROOT, 'lib', 'stages.js'), "    const t = readTally(String(id));\n    if (!t) throw new Error('the tables of this record set cannot be read, so there is nothing to work out');",
    "    const t = state;",
    'theWorkOutPressIsHandedTheTallyAndNotAnAnswerAboutIt',
    'the press is handed the answer to "is it ready" instead of the tally, so every press on every set refuses with an empty board'],
  // ---- THE HISTORY FLOOR IS NOT THE SETTINGS FLOOR (3.102.0) ----
  [path.join(ROOT, 'lib', 'rankhold.js'), "  if (chunks > 0 && hold.chunksAPart < chunks) {", "  if (false) {",
    'theHistoryFloorIsSeparateFromTheSettingsFloor',
    'a shape deciding once a week prints a reading off sixteen chunks a part, and it reads low for being short rather than for being bad'],
  [path.join(ROOT, 'lib', 'rankhold.js'), "  if (chunks > 0 && hold.chunksAPart == null) {", "  if (false) {",
    'theHistoryFloorIsSeparateFromTheSettingsFloor',
    'a run that recorded no window length is assumed long enough, so the floor the owner set is silently skipped'],
  [path.join(ROOT, 'lib', 'stages.js'), "    return Number.isFinite(n) && n > 0 ? Math.floor(n / 3) : null;", "    return Number.isFinite(n) && n > 0 ? n : null;",
    'theHistoryFloorIsSeparateFromTheSettingsFloor',
    'the whole test window is measured against a floor meant for one of its three parts, so every short shape clears it'],
  [path.join(ROOT, 'public', 'construct.js'), "<h3 style=\"margin-top:0\">Worth walking?</h3>", "<h3 style=\"margin-top:0\">Confirm test set consistency</h3>",
    'theHeadingAsksAQuestionAndNeverClaimsAConfirmation',
    'the block claims to confirm something it cannot, so clearing the bar reads as proof rather than as the absence of a red flag'],
  [path.join(ROOT, 'lib', 'rankhold.js'), "  if (n < 3) return null;                       // two points always correlate perfectly", "  if (n < 1) return null;",
    'fewerThanThreeSettingsIsNoReading',
    'two settings read as a perfect agreement, because two points always do'],
  [path.join(ROOT, 'lib', 'rankhold.js'), "  if (sa <= 0 || sb <= 0) return null;", "  if (sa < 0 || sb < 0) return null;",
    'theRankingIsOneWhenTheOrderSurvivesAndMinusOneWhenItInverts',
    'every setting on the same money reads as an answer rather than as no answer at all'],
  // ---- STEP 6 SAYS WHAT ITS LIMITS ARE LIMITS ON (3.57.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  const toTs = workEnd - nHold * stepMs;", "  const toTs = workEnd;",
    'theSixthStepSaysWhatItsLimitsAreLimitsOn',
    'the window the trades are counted over runs into the held-back time, so a trade count is measured against the wrong stretch of history'],
  [path.join(ROOT, 'lib', 'stages.js'), "    const atOnce = stepHours && holdHours ? Math.max(1, Math.ceil(holdHours / stepHours)) : (stepHours ? 1 : null);",
    "    const atOnce = stepHours ? 1 : null;",
    'theSixthStepSaysWhatItsLimitsAreLimitsOn',
    'every unit reads as one position at a time, so a daily shape holding six overlapping positions is reported as one stake'],
  // ---- A TIE BETWEEN BLOCKS IS BROKEN BY THE CHECK (3.56.0) ----
  [path.join(ROOT, 'lib', 'funnel.js'), "          if (!best || n > best.squares || (lead != null && (best.lead == null || lead > best.lead))) best = { a0, a1, b0, b1, squares: n, lead };",
    "          if (!best || n > best.squares) best = { a0, a1, b0, b1, squares: n, lead };",
    'aTieBetweenBlocksIsBrokenByTheCheckAndTheMoneyIsOnlyShown',
    'two blocks of the same size are settled by whichever the loops met first, which is the order of the dials and nothing else'],
  // ---- EVERY SQUARE SAYS HOW MANY COPIES IT BEATS (3.56.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "${bt && bt.of ? `<br><span class=\"muted\">beats ${bt.won} of ${bt.of}</span>` : ''}",
    "",
    'aTieBetweenBlocksIsBrokenByTheCheckAndTheMoneyIsOnlyShown',
    'the grid goes back to showing money alone, and bold is the only sign of how a square did against the copies'],
  // ---- THE SECOND CHECK GRID AVERAGES THE COPIES (3.54.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "    return fFix(fin.reduce((s, x) => s + x, 0) / fin.length);", "    return fFix(Math.max(...fin));",
    'theThirdStepShowsTheAverageScrambledAverageBesideTheHighest',
    'the second check grid repeats the highest copy under the word average'],
  // ---- A RANGE CAN KEEP THE SETTINGS WITH NO VALUE FOR THE DIAL (3.53.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "    else st.rule.ranges[st.dial] = { min: lo === '' ? null : Number(lo), max: hi === '' ? null : Number(hi), ...(alsoNone ? { also: ['none'] } : {}) };",
    "    else st.rule.ranges[st.dial] = { min: lo === '' ? null : Number(lo), max: hi === '' ? null : Number(hi) };",
    'aRangeCanKeepTheSettingsThatHaveNoValueForTheDial',
    'the tick is drawn and counted and never written into the rule, so the cut drops every market setting anyway'],
  // ---- THE TICK BOXES MOVE THE COUNT (3.52.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "      for (const [val, n] of ((st.read || {}).groups || [])) { total += n; if (on.has(String(val))) kept += n; }", "      for (const [val, n] of ((st.read || {}).groups || [])) { total += n; kept += n; }",
    'theKeepsCountBesideTheTickBoxesFollowsTheTicks',
    'the count line beside keep these values says every setting is kept whatever is ticked'],
  // ---- THE FILE-HASH CACHE READS SIZE AND TIME, NOT SIZE ALONE (3.47.0) ----
  [path.join(ROOT, 'lib', 'manifest.js'), "  if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return", "  if (known && known.size === st.size) return",
    'anUnchangedFileIsNotHashedAgainAndAChangedOneIs',
    'a candle file rewritten to the same length keeps its old hash, and the price-file check passes a parent whose data moved'],
  // ---- THE COUNT WITHOUT THE SETTINGS (3.46.3) ----
  [path.join(ROOT, 'lib', 'stages.js'), "      const key = `${it.g}|${repOf.get(shapeKeyOf(it.shape))}|${wkApplies ? (it.wk ? 1 : 0) : 0}`;", "      const key = `${it.g}|${shapeKeyOf(it.shape)}|${wkApplies ? (it.wk ? 1 : 0) : 0}`;",
    'theStageThreeCountIsTheLaunchsFoldWithoutTheSettings',
    'the cost line counts every band as its own trade, and says more settings than the launch will price'],
  // ---- THE BOARDS BOXES OFFER ONLY WHAT CAME OUT OF THE PICK ABOVE (3.46.2) ----
  [path.join(ROOT, 'public', 'construct.js'), '${bOptions(3, s3sel, s2sel)}', '${bOptions(3, s3sel)}',
    'theTwoScreensDrawTheSharedPanelsFromOneFunction',
    'the stage 3 box on Boards offers every stage 3 set again, related to the picked stage 2 set or not'],
  // ---- THE SORTERS HOLD THE PAGE STILL (3.46.1) ----
  [path.join(ROOT, 'public', 'construct.js'), "      if (out) drawBoardsHoldingPlace();\n    };\n  });\n}\n\n// THE RANKED TABLE SORTS BY ONE PICKED COLUMN",
    "      if (out) drawBoards().then(() => restoreScroll(tab));\n    };\n  });\n}\n\n// THE RANKED TABLE SORTS BY ONE PICKED COLUMN",
    'theColumnSortersOnBoardsLeaveThePageWhereItIs',
    'a sort on the stage 1 or 2 table restores from the memory again, and a long redraw lands the page higher than the owner was'],
  // ---- TUNING-SLICE MONEY (3.46.0) ----
  [path.join(ROOT, 'lib', 'stagework.js'), "  for (const m of nullMoney) if (money > m) beat++;\n", "  for (const m of nullMoney) if (money >= m) beat++;\n",
    'theTuningSliceMoneyPricesTheLeanOfTheVotesAgainstItsNullSet',
    'a unit beats a copy whose money equals its own to the cent, and a flat slice reads as beating every copy'],
  [path.join(ROOT, 'lib', 'stages.js'), "  beatMoney: ['beatMoney', 'pairs'],\n", "  beatMoney: ['beat', 'pairs'],\n",
    'theStageTablesServeTheTuningSliceMoney',
    'the beat its own null set — tuning-slice $ column sorts by the forecast-score beat while looking like it sorts by money'],
  [path.join(ROOT, 'public', 'construct.js'), "      nullN: Number($('#swNull1').value) || 0, fee: Number($('#swFee1').value) / 100, desc: $('#swDesc1').value,", "      nullN: Number($('#swNull1').value) || 0, desc: $('#swDesc1').value,",
    'theFeeIsDeclaredOnTheStageOnePanelAndSentWithTheLaunch',
    'the fee box is drawn and never sent, and every stage 1 launch is refused for a fee the owner typed'],
  // ---- THE TWO BOXES THAT NAME A PARENT FOLLOW THE BOX (3.76.1) ----
  [path.join(ROOT, 'public', 'construct.js'), "  const swMoved = swRefillParents(swSetsCache);", "  const swMoved = false;",
    'theTwoBoxesThatNameAParentAreRebuiltWhenWhatIsOnTheBoxMoves',
    'a stage 1 run watched from this screen lands and the box below still says there is no finished stage 1 record set, exactly as the owner found it'],
  [path.join(ROOT, 'public', 'construct.js'), "    box.innerHTML = swSetOptions(sets, stage, box.value || null);", "    box.innerHTML = swSetOptions(sets, stage, null);",
    'theTwoBoxesThatNameAParentAreRebuiltWhenWhatIsOnTheBoxMoves',
    "a rebuild throws away the set the owner had chosen and silently puts the first one on the list in the box instead"],
  [path.join(ROOT, 'public', 'construct.js'), "    const shape = swSetOptions(sets, stage, null);", "    const shape = swSetOptions(sets, stage, box.value || null);",
    'theTwoBoxesThatNameAParentAreRebuiltWhenWhatIsOnTheBoxMoves',
    'the owner choosing a set reads as the list having moved, so the box is rewritten under their cursor every four seconds and an open dropdown keeps closing itself'],
  [path.join(ROOT, 'public', 'construct.js'), "    if (swParentShown.get(sel) === shape) continue;\n", "",
    'theTwoBoxesThatNameAParentAreRebuiltWhenWhatIsOnTheBoxMoves',
    'both boxes are rewritten on every tick whether anything moved or not'],
  [path.join(ROOT, 'public', 'construct.js'), "  swProvenance();\n  if (swMoved) {\n    rememberSweepForm();", "  if (swMoved) {\n    swProvenance();\n    rememberSweepForm();",
    'theTwoBoxesThatNameAParentAreRebuiltWhenWhatIsOnTheBoxMoves',
    'the heading colours are set only when the option list moved, so a heading judged off the section above it or off the row behind the set its box names goes on saying what was true a tick ago'],
  // ---- THE ALWAYS GATE IS GONE (3.44.0) ----
  [path.join(ROOT, 'lib', 'bracket.js'), "  if (!GATES.includes(gate)) throw new Error(`gate must be one of ${GATES.join('/')} — not \"${gate}\"`);\n", "",
    'theAlwaysGateIsGoneAndAGateTheEngineDoesNotHaveIsRefused',
    'a stored row naming the always gate is priced as directional and nobody is told'],
  // ---- PICKED RECORDS (3.42.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "    records = records.filter((r) => want.has(r.u));", "    records = records.slice();",
    'thePickedRecordsSaveOnTheSetAndTheStageThreeLaunchPricesExactlyThose',
    'Selected records prices every record on the parent, and the owner\'s ticks decide nothing'],
  [path.join(ROOT, 'lib', 'stages.js'), "    if (!picked.length) throw new Error(`nothing is picked on ${parent.name || parent.id} — tick records on its stage 2 table on Boards, or price N records`);",
    "    if (false) throw new Error(`nothing is picked on ${parent.name || parent.id} — tick records on its stage 2 table on Boards, or price N records`);",
    'thePickedRecordsSaveOnTheSetAndTheStageThreeLaunchPricesExactlyThose',
    'a launch with Selected records and nothing ticked prices nothing, and the set it writes is empty'],
  [path.join(ROOT, 'lib', 'stages.js'), "  return { total: rows.length, of, from, sort: doc.sort || [], picked: pickedOf(doc), rows: rows.slice(from, from + n) };",
    "  return { total: rows.length, of, from, sort: doc.sort || [], picked: [], rows: rows.slice(from, from + n) };",
    'thePickedRecordsSaveOnTheSetAndTheStageThreeLaunchPricesExactlyThose',
    'the table draws every tick clear whatever is saved, and the next tick saves a list of one'],
  [path.join(ROOT, 'public', 'construct.js'), '<td ${btd0}><input type="checkbox" data-bpick="S2:${r.u}"', '<td ${btd0}><input type="checkbox" data-bpick="S2:${r.rank}"',
    'theStageTwoTableOffersATickOnEveryRecordThatSavesOnTheSet',
    'a tick names the record by its place in the sort, and re-sorting the table picks different records'],
  [path.join(ROOT, 'public', 'construct.js'), "      pick: $('#swPick3').value,\n", "",
    'theStageThreeSetUpPricesNRecordsOrTheSelectedOnes',
    'the set-up says Selected records and the launch prices by carry, and the set never says which'],
  [path.join(ROOT, 'lib', 'vocabulary.js'), "    stage3Pick: require('./stages').PICK_CHOICES.map((value) => ({ value, label: require('./stages').PICK_LABELS[value] })),",
    "    stage3Pick: [{ value: 'count', label: 'N records' }],",
    'theStageThreeSetUpPricesNRecordsOrTheSelectedOnes',
    'the dropdown offers one of the two choices the launch accepts, and Selected records cannot be chosen from the screen'],
  [path.join(ROOT, 'lib', 'vocabulary.js'),
    "    funnelTopColumn: Object.entries(require('./funnelset').TOP_COLUMNS)\n      .map(([value, label]) => ({ value, label })),",
    "    funnelTopColumn: [{ value: 'avgTest', label: 'avg test $' }, { value: 'avgHold', label: 'avg held-back $' }],",
    'theTopNIsOnlyOfferedByAColumnAScrambledCopyHas',
    'the sealed window is offered as a column to shop by, and a column no scrambled copy has makes the comparison meaningless'],
  // 3.48.0: a box nothing in the block reads is ghosted with its tick
  [path.join(ROOT, 'public', 'construct.js'), "swGhostGroup('#swGrpArm', staticStop);", "swGhostGroup('#swGrpArm', false);",
    'aBoxNothingInTheBlockReadsIsGhostedWithItsTick',
    'arm stays live under a static stop — a box nothing reads, offered as if it changed something'],
  [path.join(ROOT, 'public', 'construct.js'), "swGhostGroup('#swGrpCopy', notVoices);", "swGhostGroup('#swGrpCopy', false);",
    'aBoxNothingInTheBlockReadsIsGhostedWithItsTick',
    'one voice at stays live under count, conviction and families, none of which can read it'],
  // 3.48.1: the launch's answer reads the count it worked out, not a name that
  // lives in the background part
  [path.join(ROOT, 'lib', 'stages.js'), 'return { id, name: doc.name, units: parentRecords.length, settings: counted.kept };',
    'return { id, name: doc.name, units: parentRecords.length, settings: settings.length };',
    'theStageThreeLaunchAnswersWithTheCountItWorkedOut',
    'every press of start stage 3 starts a run and then tells the browser it failed'],
  // 3.49.0: the name is the owner's
  [path.join(ROOT, 'lib', 'stages.js'),
    '  if (taken) throw new Error(`a record set called "${name}" already exists (${taken.id}) — pick another name, or rename that one on Boards first`);',
    '  if (false) throw new Error(`a record set called "${name}" already exists (${taken.id}) — pick another name, or rename that one on Boards first`);',
    'theLaunchTakesTheOwnersNameAndRefusesADuplicate',
    'two record sets can share one name, and the pickers cannot tell them apart'],
  [path.join(ROOT, 'lib', 'stages.js'), '    child.parent.name = name;\n    saveSet(child);', '    saveSet(child);',
    'renamingASetIsTheOwnersAndCarriesToItsChildren',
    'a renamed set\'s children go on naming it by the old name — two vocabularies on disk'],
  [path.join(ROOT, 'public', 'construct.js'), "      name: $('#swName3').value,\n", '',
    'theNameBoxIsOnEveryStageOfSweepAndTheLaunchSendsIt',
    'the stage 3 name box is on the screen and the launch ignores it'],
  [path.join(ROOT, 'public', 'construct.js'), "    wireRename(`api/stageset/${encodeURIComponent(doc.id)}/name`, String(stage));\n", '',
    'theNameIsTheOwnersOnEveryOpenSection',
    'the rename button is on the screen and pressing it does nothing'],
  // 3.50.0: the bar is a share of the copies
  [path.join(ROOT, 'lib', 'funnel.js'), '  const want = Math.ceil((K * barPctOf(check)) / 100);', '  const want = Math.floor((K * barPctOf(check)) / 100);',
    'aValueCountsWhenItBeatsAtLeastTheBarOfTheCopies',
    '"at least 80%" of 19 copies is 15, below the share the owner set'],
  [path.join(ROOT, 'lib', 'stages.js'), "S4.normaliseRule(state.rule), require('./funnel').barPctOf(state)]);", "S4.normaliseRule(state.rule)]);",
    'theAcrossIsKeyedOnTheBarAsWellAsTheRule',
    'the same rule asked again under another bar is answered from the old reading'],
  [path.join(ROOT, 'public', 'construct.js'), "  if (saved && 'bar' in saved) delete saved.bar;\n", '',
    'theScreenOffersTheBarAndSendsItWithEveryRead',
    'a walk saved under the old count keeps it, and the page silently carries a stale field'],
  // 3.50.1: the bar stays where it is left, for every unit of the set
  [path.join(ROOT, 'public', 'construct.js'), '  if (shared.barPct !== undefined) fState.barPct = shared.barPct;\n', '',
    'theBarAndTheTargetStayWhereTheyAreLeftForTheWholeSet',
    'every switch of coin and shape puts the bar back to the default and the owner reads every unit twice'],
  // 3.51.0: the sealed window rides on the stage 2 record the Funnel reads
  [path.join(ROOT, 'lib', 'stages.js'), '          reserve: rec.reserve || null,\n          specs: merged.members.map(', '          specs: merged.members.map(',
    'theStageTwoRecordCarriesTheSealedWindowTheFunnelReads',
    'every stage 2 set written from now on carries no sealed window the day it lands'],
  // 3.51.1: step 2 keeps its dial box, and a count under `values` is not a list
  [path.join(ROOT, 'public', 'construct.js'), '    ${r.why && d.step !== 2 ? `<p class="note neg">${esc(r.why)}</p>`', '    ${r.why ? `<p class="note neg">${esc(r.why)}</p>`',
    'theStepTwoScreenKeepsItsDialBoxAndSurvivesARecommendedRange',
    'a dial the rule fixed leaves step 2 with a sentence and no way to pick the next dial'],
  [path.join(ROOT, 'public', 'construct.js'), '  const chosen = new Set((Array.isArray(kept) ? kept : (Array.isArray(rr.values) ? rr.values : [])).map(String));',
    '  const chosen = new Set((kept || rr.values || []).map(String));',
    'theStepTwoScreenKeepsItsDialBoxAndSurvivesARecommendedRange',
    'a recommended range with a count throws before the page paints and narrow this one does nothing'],
  // ---- THE TRAINING SETUP AS ONE STAGE 3 SETTING (3.71.0) ----
  [path.join(ROOT, 'lib', 'bracket.js'), "const T_HOURS = [...new Set([...T_BASE_HOURS, ...T_TRAINED_HOURS])].sort((a, b) => a - b);",
    "const T_HOURS = T_BASE_HOURS.slice();",
    'everyTrainingHoldLengthIsOnTheLadder',
    'the 60h a weekly chunk is held for is off the menu again, so the one setting the weekly units were trained on cannot be priced'],
  [path.join(ROOT, 'lib', 'agreement.js'), "  if (rule === 'trained') {\n    let s2 = 0;",
    "  if (false) {\n    let s2 = 0;",
    'trainedIsTheSignOfTheSummedLeanAndNotAHeadCount',
    'training\'s own rule falls through to the head count, so a setting named after the trainings prices something else'],
  [path.join(ROOT, 'lib', 'agreement.js'), "  if (READS_NO_BAR.has(rule)) return -Infinity;", "",
    'trainedReadsNoBarAtAnyLevel',
    'a rule with nothing to clear is handed a bar taken from its own history, and the setting stops being what it says it is'],
  [path.join(ROOT, 'lib', 'stages.js'), "      if (agreement.READS_NO_BAR.has(rule)) {", "      if (false) {",
    'theTrainingSetupIsOneSettingWithNoBarAndNoShare',
    'permuting a bar or a share multiplies a rule that reads neither, so the block fills with copies of one trade'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (agreement.READS_NO_BAR.has(a.rule)) {", "  if (false) {",
    'theTrainingSetupIsOneSettingWithNoBarAndNoShare',
    'a setting that read no bar prints one in its name, and the owner reads a number that was never consulted'],
  [path.join(ROOT, 'lib', 'stages.js'), "  _bar: (r) => (r.agreeBar == null ? 'does not apply' : r.agreeBar === 'own' ? 'its own history' : 'all of them'),",
    "  _bar: (r) => (r.agreeBar === 'own' ? 'its own history' : 'all of them'),",
    'aRowWithNoBarSaysTheBarDoesNotApply',
    'a row written under a rule that reads no bar prints all of them, which is the screen telling the owner a bar was used'],
  [path.join(ROOT, 'lib', 'committee.js'), "  const levelFor = (agr, decision) => (agreement.READS_NO_BAR.has(agr.rule) ? null",
    "  const levelFor = (agr, decision) => (false ? null",
    'theNoBarRuleIsNotGivenABarBackInsideThePricing',
    'the rung column prints what some other rule would have landed on, and the per-coin average is dragged by a number nothing read'],
  [path.join(ROOT, 'lib', 'stagework.js'), "    probs: agreement.READS_LEANS.has(agr.rule) ? probsFor(dealIdx, slice) : null,",
    "    probs: agr.rule === 'conviction' ? probsFor(dealIdx, slice) : null,",
    'everyRuleThatReadsTheMembersLeansIsHandedThem',
    'training\'s own rule is handed no leans to add up and every unit crashes the moment it is priced'],
  [path.join(ROOT, 'public', 'construct.js'), "    setV('#swAgreeRule', 'trained'); setC('#swPermAgreeRule', false);",
    "    setC('#swPermAgreeRule', false);",
    'theTrainingSetupControlFillsTheFormAndStartsNothing',
    'the control fills every box except the one that makes it the training setup, so it loads a setting nobody asked for'],
  [path.join(ROOT, 'public', 'construct.js'), "    setV('#swT', 'own'); setC('#swPermT', false);", "    setC('#swPermT', false);",
    'theTrainingSetupControlFillsTheFormAndStartsNothing',
    't is left on whatever was in the box, so the setting is priced at some other hold length and still called the training setup'],
  // ---- t SET TO THE CHUNK'S OWN HOLD LENGTH (3.72.0) ----
  [path.join(ROOT, 'lib', 'bracket.js'), "  if (tHours !== T_OWN) return Number(tHours);", "  return Number(tHours);",
    'theChunksOwnHoldLengthIsResolvedAgainstTheUnitBeingPriced',
    'the chunk\'s own hold length resolves to NaN and every unit prices a trade with no time exit at all'],
  [path.join(ROOT, 'lib', 'bracket.js'), "  if (h == null) throw new Error(`t is set to the chunk's own hold length and \"${geometry}\" is not a chunk shape this system implements`);", "  if (h == null) return 65;",
    'theChunksOwnHoldLengthIsResolvedAgainstTheUnitBeingPriced',
    'a chunk shape the system does not implement is silently priced at somebody\'s favourite number instead of refusing'],
  [path.join(ROOT, 'lib', 'stages.js'), "  return [st.decision, wk ? 1 : 0, st.entry, st.gate, bracketLib.tHoursOn(st.tHours, geometry),",
    "  return [st.decision, wk ? 1 : 0, st.entry, st.gate, st.tHours,",
    'theChunksOwnFoldsIntoTheHoursItLandsOnForThatUnit',
    'the same trade is priced twice on every unit whose own hold length is also on the hours menu'],
  [path.join(ROOT, 'lib', 'stages.js'), "    tHours: [...bracketLib.T_HOURS, bracketLib.T_OWN],", "    tHours: bracketLib.T_HOURS,",
    'theChunksOwnHoldLengthIsResolvedAgainstTheUnitBeingPriced',
    'the stage 3 grid stops accepting the chunk\'s own, so the training setup refuses at launch with a message about the grid'],
  [path.join(ROOT, 'lib', 'stagework.js'), "    const tHours = bracketLib.tHoursOn(st.tHours, geometry);", "    const tHours = st.tHours;",
    'theChunksOwnHoldLengthIsResolvedAgainstTheUnitBeingPriced',
    'the pricing is handed a word where hours belong, and every unit dies the moment the training setup is priced'],
  // ---- ON DISK BEFORE THE NETWORK, AND THE UNITS A RUN LOST (3.73.0) ----
  [path.join(ROOT, 'lib', 'pipeline.js'), "    if (!fs.existsSync(cachePath(symbol, year, month))) {", "    if (false) {",
    'theLoaderReadsWhatIsOnDiskBeforeAskingTheNetwork',
    'every unit asks the network again for months the box already holds as day files -- forty thousand pointless requests a run, and a blip kills a unit'],
  [path.join(ROOT, 'lib', 'binance.js'), "  if (notPublished.has(nk)) return null;", "",
    'theLoaderReadsWhatIsOnDiskBeforeAskingTheNetwork',
    'a month the exchange has already said does not exist is asked about once per unit, for ever'],
  [path.join(ROOT, 'lib', 'binance.js'), "  if (res.status === 404) { notPublished.add(nk); return null; }", "  if (res.status === 404) { return null; }",
    'theLoaderReadsWhatIsOnDiskBeforeAskingTheNetwork',
    'nothing is remembered, so the 404 storm comes straight back'],
  [path.join(ROOT, 'lib', 'stages.js'), "  for (let i = 0; i < list.length; i++) if (!have.has(i)) missing.push({ i, unit: list[i] });",
    "  for (let i = have.size; i < list.length; i++) missing.push({ i, unit: list[i] });",
    'theUnitsARunLostAreFoundBySubtractingWhatIsThereFromThePlan',
    'the gaps are assumed to be at the end of the plan, so the units actually put back are the wrong ones and the real gaps stay'],
  [path.join(ROOT, 'lib', 'stages.js'), "    && recordsInHand.rows.length !== rowstore.count(doc.id, 'records')) {", "    && false) {",
    'theUnitsARunLostAreFoundBySubtractingWhatIsThereFromThePlan',
    'the gaps are read off a list that predates the fill, so a filled set reports the same gaps for ever and is never stamped finished'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (pm !== MEASUREMENTS_VERSION) {\n    return `${doc.name} was built on measurement block",
    "  if (false) {\n    return `${doc.name} was built on measurement block",
    'fillingInUnitsRefusesAnythingThatWouldNotBeComparable',
    'a unit trained on numbers the rest of the set has never seen is added to it silently and ranked against them'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (!diff.same) {\n    const names = [...diff.changed, ...diff.onlyA, ...diff.onlyB];\n    return `the price files changed since",
    "  if (false) {\n    const names = [...diff.changed, ...diff.onlyA, ...diff.onlyB];\n    return `the price files changed since",
    'fillingInUnitsRefusesAnythingThatWouldNotBeComparable',
    'a unit trained on today\'s data joins a set trained on yesterday\'s, with nothing able to tell them apart'],
  // ---- THE ORDERING IS REBUILT BESIDE THE SET (3.73.1) ----
  // The first of these puts back the EXACT line that destroyed an eighteen-hour
  // run on 2026-09-06. If the suite ever stops noticing it, the test that reads
  // a real store back has stopped doing its job.
  [path.join(ROOT, 'lib', 'stages.js'), "  const rk = rowstore.writer(id, RANKING_SPARE);",
    "  rowstore.remove(id, 'ranking');\n  const rk = rowstore.writer(id, RANKING_SPARE);",
    'rebuildingTheOrderingLeavesEveryOtherStoreExactlyWhereItWas',
    'the records, the votes, the tau votes and the models are all deleted to rebuild one ordering — the fault that cost an 18-hour run'],
  // NOT GUARDED, AND SAID SO RATHER THAN PRETENDED: the row-count check in
  // rebuildRanking (`if (got !== all.length)`) fires only when the writer
  // hands back fewer rows than it was given, which nothing in a test can make
  // happen without contriving the store on disk. A guard on it read as
  // protection and caught nothing, so it is gone rather than left lying. The
  // check itself stays in the code -- it costs one comparison and it is the
  // last thing standing between a half-written ordering and the real name.
  [path.join(ROOT, 'lib', 'stages.js'), "  fs.renameSync(`${from}.meta.json`, `${to}.meta.json`);\n  fs.renameSync(from, to);\n  // an unsquashed ordering",
    "  fs.renameSync(from, to);\n  // an unsquashed ordering",
    'rebuildingTheOrderingLeavesEveryOtherStoreExactlyWhereItWas',
    'the ordering takes the real name while its row count stays behind, so the set reads back with the old number of rows'],
  // ---- Table 3.B names the coins a row is read against (2026-09-07) -------
  [path.join(ROOT, 'public', 'construct.js'),
    '<span class="muted">${esc(bGeo(r.geometry))}</span>${bAlso(r)}</td>',
    '<span class="muted">${esc(bGeo(r.geometry))}</span></td>',
    'theEveryCoinTableNamesTheCoinsARowIsReadAgainst',
    'a coin judged on its own and the same coin read against two others go back to being two rows with identical text and different money'],
  // ---- the Funnel's coin and shape, one box per part (2026-09-07) --------
  [path.join(ROOT, 'public', 'construct.js'),
    '    const next = rows.filter((u) => (u[field] || \'\') === (val || \'\'));\n    if (next.length) rows = next;',
    '    rows = rows.filter((u) => (u[field] || \'\') === (val || \'\'));',
    'theCoinAndShapeBoxIsOneBoxPerPart',
    'changing one of the four boxes to something the boxes on its right cannot fit lands on no board at all, instead of dropping what cannot be honoured'],
  // ---- step 6's press: one press, progress, and no other loads (2026-09-07) --
  [path.join(ROOT, 'public', 'construct.js'),
    "const fRichOf = (d) => (d && d.richOn) || { have: 0, need: Number((d && d.survivors) || 0), run: null };",
    "const fRichOf = (d) => (d && d.richOn) || { have: 0, need: 0, run: null };",
    'theStepSixPressFinishesOnItsOwnAndIsDeadWhenThereIsNothingLeft',
    'a reply that carries no count of its own ghosts the press with no explanation, which is the fault this release fixes arriving by another door'],
  [path.join(ROOT, 'public', 'construct.js'),
    '      if (mine !== asked) return;                       // a newer keystroke is already out',
    '',
    'theRemainingCountIsAskedOnEveryKeystrokeAndTheLastAnswerWins',
    'a slow answer to an older keystroke overwrites the newer one, so the count under the boxes is for a value no longer in them'],
  [path.join(ROOT, 'lib', 'stages.js'),
    '  const rich = richBusy();\n  if (rich) return rich;\n  return null;\n}',
    '  return null;\n}',
    'theStepSixPressFinishesOnItsOwnAndIsDeadWhenThereIsNothingLeft',
    'a sweep, a stage run or a totalling can be started on top of the step 6 press and fight it for the same workers'],
  // ---- a stage 3 run paused and started again (3.82.0) ----------------------
  [path.join(ROOT, 'lib', 'stages.js'), "doc.status = doc.cancelRequested ? (doc.stage === 3 && hasCheckpoint(doc.id) ? 'paused' : 'cancelled') : 'error';",
    "doc.status = doc.cancelRequested ? 'cancelled' : 'error';",
    'aRunPausedFromInsideAndStartedAgainEqualsTheReference', 'a paused run reads as cancelled, is offered nowhere, and forty hours of pricing are thrown away'],
  [path.join(ROOT, 'lib', 'stages.js'), "    writeCheckpoint(doc, live);\n    doc.progress = `paused at ",
    "    doc.progress = `paused at ",
    'aRunPausedFromInsideAndStartedAgainEqualsTheReference', 'a pause keeps the agreements from a minute ago beside the rows from now'],
  [path.join(ROOT, 'lib', 'stages.js'), '  dropCheckpoint(id);\n  if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }',
    '  if (activeSet && activeSet.id === doc.id) { activeSet = null; activePool = null; }',
    'aRunThatWasNeverStoppedIsTheReference', 'a finished set keeps a checkpoint and is offered to be started again, and starting it prices nothing and rewrites its tables'],
  [path.join(ROOT, 'lib', 'stages.js'), '        if (drop && drop.has(row.si)) continue;\n', '',
    'aUnitWhoseAgreementsWereLostGetsThemBackWithoutRepricingTheWholeUnit', 'a unit priced again for its agreements writes its rows a second time, and every table double-counts it'],
  [path.join(ROOT, 'lib', 'stages.js'), '      if ((haveA.has(ka) || coveredA.has(ka)) && (haveC.has(kc) || coveredC.has(kc))) continue;', '      continue;',
    'aUnitWhoseAgreementsWereLostGetsThemBackWithoutRepricingTheWholeUnit', 'a unit whose agreements were lost is kept as whole, and the tables show it with none'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (!['paused', 'interrupted', 'error'].includes(doc.status)) {", '  if (false) {',
    'aStartAgainRefusesWhatItCannotResume', 'a finished set can be started again over its own records'],
  [path.join(ROOT, 'lib', 'stages.js'), "        checkpoint: d.stage === 3 && d.status !== 'running' && hasCheckpoint(d.id),", '        checkpoint: false,',
    'theListRowSaysWhetherASetCanBeStartedAgain', 'no paused run is ever offered to be started again'],
  [path.join(ROOT, 'lib', 'rowstore.js'), '  fs.truncateSync(file, expected);\n  return size - expected;', '  return size - expected;',
    'aStoreCutOffMidWriteIsTrimmedBackToItsIndex', 'a run started again appends after a torn block, and the index and the file disagree forever'],
  [path.join(ROOT, 'public', 'construct.js'), "  const paused = stage === 2 ? swPausedOptions(sets, selected) : '';", "  const paused = '';",
    'theSweepOffersAPausedRunWhereANewOneIsSetUp', 'the paused run is on disk, can be started again, and the screen offers no way to'],
  [path.join(ROOT, 'public', 'construct.js'), "${canContinue ? ' It can be started again from the stage 3 section on Sweep.' : ''}", '',
    'theSweepOffersAPausedRunWhereANewOneIsSetUp', 'Boards shows a paused set and says nothing about where to start it again'],
  [path.join(ROOT, 'server.js'), "app.post('/api/stageset/:id/continue', (req, res) => {", "app.post('/api/stageset/:id/continue-gone', (req, res) => {",
    'theSweepOffersAPausedRunWhereANewOneIsSetUp', 'start stage 3 on a paused run posts to a route that is not there'],
  // ---- the start-again answers at once; the start buttons sleep on the press (3.83.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "        doc.status = before;\n        doc.progress = `not started again — ${err.message}`;",
    "        doc.status = 'error';\n        doc.progress = `not started again — ${err.message}`;",
    'aStartAgainRefusesWhatItCannotResume', 'a start-again refused after the answer leaves the set reading as failed instead of exactly as it was'],
  [path.join(ROOT, 'public', 'construct.js'), "    swStarting(cont ? 'again' : 3);\n", '',
    'theStartButtonsSleepOnThePressAndTheLineAtTheTopSaysStarting', 'start stage 3 can be pressed twice inside the poll gap and the top line says nothing until the box answers'],
  [path.join(ROOT, 'public', 'construct.js'), '      return { pending: true };', '      return null;',
    'theStartButtonsSleepOnThePressAndTheLineAtTheTopSaysStarting', 'a gateway that gave up reads as the box refusing, while the run has started'],
  // ---- a run reads the price files it was launched on (3.84.0) ----
  [path.join(ROOT, 'lib', 'manifest.js'), '  return { intact: !gone.length && !changed.length, pinned: true, checked, gone, changed };', '  return { intact: true, pinned: true, checked, gone, changed };',
    'aStartAgainRefusesWhatItCannotResume', 'a pinned price file that changed or went is never noticed, and the rest of a run is priced on different prices from the part already done'],
  [path.join(ROOT, 'lib', 'pipeline.js'), '      if (e.bundle) monthRows = read(e.bundle);', "      if (e.bundle || fs.existsSync(path.join(CACHE_DIR, `${symbol}-1h-${mm}.json`))) monthRows = read(`${symbol}-1h-${mm}.json`);",
    'thePinnedLoaderReadsExactlyTheFilesTheStampLists', 'a bundle that appeared after the launch is read in place of the pinned day files, and the run\'s data moves under it'],
  [path.join(ROOT, 'lib', 'stages.js'), '{ onlyFiles: pinnedFilesOf(parent.dataManifest) }', '{}',
    'aFreshLaunchAfterTheBundleAppearedIsPinnedToItsParentAndEqualsTheReference', 'a child is stamped over whatever is on disk instead of its parent\'s files, so a chain can read two histories'],
  [path.join(ROOT, 'lib', 'stagework.js'), '    pinnedFiles: p.pinnedFiles || null,', '    pinnedFiles: null,',
    'aRunPausedFromInsideAndStartedAgainEqualsTheReference', 'the pin never reaches the loader, and a start-again reads whatever is on disk'],
  // ---- a child is stamped over every coin its parent was stamped over; a narrow pin is widened (3.84.1) ----
  [path.join(ROOT, 'lib', 'stages.js'), '  const coins = parentPin && Object.keys(parentPin).length ? Object.keys(parentPin).sort() : coinsOfParent(parent);', '  const coins = coinsOfParent(parent);',
    'aChildIsStampedOverEveryCoinItsParentWasStampedOver', 'a child is stamped over its parent\'s trade coin alone, and the coins its units read alongside are never pinned'],
  [path.join(ROOT, 'lib', 'stages.js'), '    if (missing.length) {\n      const pc = pinnedIntact(parent.dataManifest);', '    if (false) {\n      const pc = pinnedIntact(parent.dataManifest);',
    'aUnitWhoseAgreementsWereLostGetsThemBackWithoutRepricingTheWholeUnit', 'a start-again of a set whose own record names one coin leaves the other coins reading whatever is on disk'],
  // ---- the actual date ranges are stored on every stage; the unread window has a start and no end (3.85.0) ----
  [path.join(ROOT, 'lib', 'stagework.js'), '    unread: reserve ? { fromTs: reserve.fromTs, chunks: reserve.chunks, seenToTs: reserve.toTs } : null,', '    unread: reserve ? { fromTs: reserve.fromTs, chunks: reserve.chunks, seenToTs: reserve.toTs, toTs: reserve.toTs } : null,',
    'aRunThatWasNeverStoppedIsTheReference', 'the unread window is stored with an end, so data that arrives after the run is never counted as unread'],
  [path.join(ROOT, 'lib', 'stages.js'), '          windows: res.windows || rec.windows || null,', '          windows: null,',
    'aRunThatWasNeverStoppedIsTheReference', 'a stage 2 record carries no date ranges, and every stage 3 set cut from it has none to keep'],
  [path.join(ROOT, 'lib', 'stages.js'), '      if (!windowsMap[unitKeyOf(rec)] && !todo.length && !extra.length) {', '      if (false && !windowsMap[unitKeyOf(rec)] && !todo.length && !extra.length) {',
    'aPausedRunWhoseCheckpointKeepsNoDateRangesPricesOneSettingPerUnitForThem', 'a run paused before 3.85.0 and started again lands with no date ranges for the units it had already priced'],
  // ---- the verdict on a Stage 4 record set (3.86.0) ----
  [path.join(ROOT, 'lib', 'funnelverify.js'), '    pass: comparisons.known && positive && comparisons.beatsBuyHold === true && comparisons.beatsShortHold === true,', '    pass: positive && comparisons.beatsBuyHold !== false && comparisons.beatsShortHold !== false,',
    'theVerdictCannotPassOnUnknownComparisons', 'a set whose parent kept no comparisons passes the held-back read on an unknown'],
  [path.join(ROOT, 'lib', 'funnelverify.js'), '  const pass = K > 0 && real != null && real > 0 && beats >= rules.bar;', '  const pass = K > 0 && real != null && real > 0 && beats >= 1;',
    'theOwnCopiesReadMatchesTheAcrossReadOnAFixtureBoard', 'beating one scrambled copy of eighty passes the verdict, and the bar the set was cut under is never read'],
  [path.join(ROOT, 'lib', 'stages.js'), '  if (!fresh.heldBackReadAt) fresh.heldBackReadAt = block.at;', '  fresh.heldBackReadAt = block.at;',
    'heldBackReadAtIsWrittenOnceAndNeverChanged', 'every press moves the first-look stamp, so a set can never say when its held-back window was first opened'],
  [path.join(ROOT, 'lib', 'stages.js'), '  fresh.verify = [block, ...blocks];', '  fresh.verify = [block];',
    'everyPressAppendsABlockAndOverwritesNone', 'a later press overwrites the verdict, and a set read three times keeps only the last reading'],
  [path.join(ROOT, 'lib', 'stages.js'), '  if (!doc.unit) throw new Error(BLEND_REFUSAL);', '  if (false) throw new Error(BLEND_REFUSAL);',
    'aBlendSetIsRefusedInWords', 'a set cut on all units together is read as if it had a unit, against comparisons kept per unit'],
  // ---- what the review of 3.86.0 found (3.86.1) ----
  [path.join(ROOT, 'lib', 'funnelverify.js'), '  const barPct = askedBar != null && Number.isFinite(askedBar) && askedBar >= 1 ? Math.min(100, askedBar) : own;', '  const barPct = askedBar != null && Number.isFinite(askedBar) ? Math.max(1, Math.min(100, askedBar)) : own;',
    'aBlankBoxMeansTheSetsOwnBarNeverAOnePercentOne', 'a blank bar box becomes a bar of one copy, which a forecast-free rule clears 99% of the time'],
  [path.join(ROOT, 'lib', 'stages.js'), '  const now = S4.applyRule(mine, rule);\n  const same = now.length === wanted.length', '  const now = S4.applyRule(all, rule);\n  const same = now.length === wanted.length',
    'theFootingReplaysOnTheSetsOwnCopyOfTheNumbers', 'a parent that lost a column the rule reads refuses a set whose own copy still replays'],
  // ---- the stage-engine check (3.87.0) ----
  [path.join(ROOT, 'lib', 'stagegate.js'), '  const g4 = fc.pass === false && fc.copies === copies;', '  const g4 = fc.copies === copies;',
    'aFairCoinClearingTheBarFailsTheExam', 'a fair coin whose rule clears the bar passes the exam, and an engine that invents things is certified'],
  [path.join(ROOT, 'lib', 'stages.js'), '    if (reserved && !params.exam) {', '    if (false) {',
    'theLauncherRefusesTheReservedCoinsUnlessTheExamLaunchesThem', 'a fabricated coin with a known rule can enter a real run, and a board would be judging fiction'],
  [path.join(ROOT, 'lib', 'stages.js'), '  if (examBusy() && !(params && params.exam)) throw new Error(`${examBusy()} is going right now — one heavy job at a time`);', '  if (false) throw new Error(`${examBusy()} is going right now — one heavy job at a time`);',
    'theExamRefusesWhileTheBoxIsBusyAndTheBoxRefusesWhileTheExamRuns', 'a stage run can launch under the exam and fight it for the workers'],
  // ---- the rule on the other units, and the held-back ride (3.88.0) ----
  [path.join(ROOT, 'lib', 'funnelverify.js'), "  const usable = (units || []).filter((u) => !u.keepsNothing);", "  const usable = (units || []).slice();",
    'aUnitWhereTheRuleKeepsNothingIsNotInTheDenominatorAndFewerThanHalfPositiveIsAMark', 'a unit the rule keeps nothing on counts as a unit that lost, and half the units on a board can read as negative for nothing'],
  [path.join(ROOT, 'lib', 'funnelverify.js'), "  const mark = of > 0 && positive < of / 2 ? `fewer than half of the ${of} other units are positive on the held-back window` : null;", "  const mark = null;",
    'aUnitWhereTheRuleKeepsNothingIsNotInTheDenominatorAndFewerThanHalfPositiveIsAMark', 'a rule that loses on most of the other units carries no mark'],
  [path.join(ROOT, 'lib', 'stages.js'), '      fresh.others = [reading, ...had];', '      fresh.others = [reading];',
    'theOtherUnitsAreReadOnTheHeldBackWindowAndAppendedNeverGated', 'a second reading overwrites the first, and a set read under a softer bar forgets the honest one'],
  [path.join(ROOT, 'lib', 'funnelverify.js'), "      hold: half(u.rich && u.rich.hold, (u.holdout || {}).pnl, (u.holdout || {}).trades),", "      hold: half(u.rich && u.rich.test, (u.holdout || {}).pnl, (u.holdout || {}).trades),",
    'theRideKeepsTheHeldBackHalfBesideTheTestHalfForThisUnitOnly', "the ride prints the test window's numbers as the held-back window's"],
  [path.join(ROOT, 'lib', 'stages.js'), "  const rides = (doc.ride || []).length;", "  const rides = 0;",
    'theRideIsALookAndTheNextVerdictCountsItAndTheRefusalsAreInWords', 'the ride opens the held-back window and no look is counted'],
  // ---- every recorded step carries the count the page had in hand (3.88.1) ----
  [path.join(ROOT, 'public', 'construct.js'), '  const fRecord = (step) => st.steps.push({ ...step, survivors: fCount() });', '  const fRecord = (step) => st.steps.push({ ...step });',
    'everyRecordedStepCarriesTheCountThePageHadInHand', 'every recorded step carries an empty count again, and the reserve grade cannot say how far the board was narrowed at each look'],
  [path.join(ROOT, 'lib', 'funnelset.js'), "  doc.backSteps.push({ at: new Date().toISOString(), from: from ?? null, to: to ?? null, why: why || null, survivors: survivors == null ? null : survivors });", "  doc.backSteps.push({ at: new Date().toISOString(), from: from ?? null, to: to ?? null, why: why || null, survivors: survivors == null ? 0 : survivors });",
    'everyRecordedStepCarriesTheCountThePageHadInHand', 'a step back with no read in hand is written as a count of zero, which reads as a rule that kept nothing'],
  // ---- the reserve grade on a Stage 4 record set (3.89.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  if (!unreadGateOf(doc)) return UNREAD_NO_PASS;", "  if (false) return UNREAD_NO_PASS;",
    'theReserveGradeRefusesInWordsBeforeAnythingPrices', 'the unread window is opened for a set whose verdict never stood, and the one look at unseen data is spent on a rule that failed'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const b = ((doc && doc.verify) || []).find((x) => x.verdict && x.verdict.pass && firstDigitOfRelease(x.release) === firstDigitOfRelease(ENGINE_VERSION)) || null;", "  const b = ((doc && doc.verify) || []).find((x) => x.verdict && x.verdict.pass) || null;",
    'theReserveGradeRefusesInWordsBeforeAnythingPrices', 'a verdict that passed under another first digit opens the door, and the grade is keyed to a release line it was never read under'],
  [path.join(ROOT, 'lib', 'stagework.js'), "    memberProbs = forecasts.map((f, mi) => [...unit.probs[mi].slice(0, testChunks.length), ...f]);", "    memberProbs = unit.probs;",
    'theReserveGradePricesTheUnreadWindowWithTheSavedForecastsAndCountsItsLooks', 'the members\' stored votes stand in for forecasts on a window they never voted on, and the unread window is priced on votes that run out before it ends'],
  [path.join(ROOT, 'lib', 'stagework.js'), "    holdChunks = got.chunks;\n    holdTrade = got.maps.trade;", "    holdTrade = got.maps.trade;",
    'theReserveGradePricesTheUnreadWindowWithTheSavedForecastsAndCountsItsLooks', 'the held-back window is priced in the unread window\'s place, and the grade reads a window the search already touched'],
  [path.join(ROOT, 'lib', 'stages.js'), "  fresh.unread = [block, ...had];", "  fresh.unread = [block];",
    'theReserveGradePricesTheUnreadWindowWithTheSavedForecastsAndCountsItsLooks', 'a second look overwrites the first, and the only look at unseen data is gone from the record'],
  [path.join(ROOT, 'lib', 'funnelverify.js'), "  parts.push(look > 1\n    ? `look ${look}: this window had been read ${look - 1} time(s) before, so it is no longer data nothing has seen and the floor below is the best case, not the strength`\n    : 'look 1: the first look at data nothing in the system has seen');", "  parts.push('look 1: the first look at data nothing in the system has seen');",
    'theReserveGradePricesTheUnreadWindowWithTheSavedForecastsAndCountsItsLooks', 'every look reads as the first, and a grade of a window read five times claims data nothing has seen'],
  // ---- the Stage 4 door on Greenlight (3.90.0) ----
  [path.join(ROOT, 'lib', 'funnelset.js'), "    if (!best || cand.worst < best.worst || (cand.worst === best.worst && cand.mean < best.mean)) best = cand;", "    if (!best || (r.avgHold || 0) > ((rows[best.index] || {}).avgHold || 0)) best = cand;",
    'theDepthPickIsTheSurvivorNearestTheMiddleOfEveryRangeAndNeverReadsMoney', 'the pick is the survivor with the most held-back money, which is shopping the one window that must not be shopped'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const gate = unreadGateOf(doc);\n  if (!gate) throw new Error(UNREAD_NO_PASS);\n  const join = await funnelVerifyJoin(doc);\n  const parent = join.parent;\n  const stage2 = getSet((parent.parent || {}).id);", "  const gate = unreadGateOf(doc) || { id: null, at: null, release: null, look: null };\n  const join = await funnelVerifyJoin(doc);\n  const parent = join.parent;\n  const stage2 = getSet((parent.parent || {}).id);",
    'theStage4GreenlightSourceIsReadOffTheSetAndRefusesWithoutAVerdictThatStood', 'a set whose verdict never stood is offered for a greenlight'],
  // ---- the live path speaks the stage engine's agreement (3.91.0) ----
  [path.join(ROOT, 'lib', 'live', 'stagesignal.js'), "  const call = stream[stream.length - 1] || 0;", "  const call = stream[0] || 0;",
    'bothPathsReadTheOneDefinitionAndNeitherKeepsACopy', 'the live call is read at the first moment of the run instead of the target, so +hold reads a moment that is not the one being traded'],
  [path.join(ROOT, 'lib', 'committee.js'), "    return Math.max(1, Math.min(n, Math.ceil((agr.pct / 100) * n)));", "    return Math.max(1, Math.min(n, Math.floor((agr.pct / 100) * n)));",
    'theRungIsTheShareOfWhatTheRuleCountsAndTheOwnBarIsReadFromTheTestSlice', 'a share lands one member short of the rung it asked for, on every unit, for both paths at once'],
  [path.join(ROOT, 'lib', 'committee.js'), "  const streamOf = (decision, agr, probsPerMember) => agreement.agreementStream(\n    ctxOf(decision, agr, probsPerMember), agr.rule, levelFor(agr, decision), { bothModels: agr.both, persist: agr.persist },", "  const streamOf = (decision, agr, probsPerMember) => agreement.agreementStream(\n    ctxOf(decision, agr, probsPerMember), agr.rule, levelFor(agr, decision), { bothModels: false, persist: 0 },",
    'theStreamIsTheRulesOwnCallAtEachMomentWithItsTwoModifiers', 'the two modifiers a setting was priced under are dropped on the way to its call, for stage 3 and the live path alike'],
  // ---- the per-trade capture of a Stage 4 record set, for Tune (3.92.0) ----
  [path.join(ROOT, 'lib', 'stagework.js'), "          list.push({ ts: chunksArr[i].startTs + (geo.entryOffsetH || 0) * 3600000, side: call === 1 ? 'LONG' : 'SHORT', agree, usd: one.pnl });", "          list.push({ ts: chunksArr[i].startTs + (geo.entryOffsetH || 0) * 3600000, side: call === 1 ? 'LONG' : 'SHORT', agree, usd: 0 });",
    'theCaptureIsTheStageThreeRecordsOwnTradesToTheCent', "a captured entry carries no money, so the capture can no longer be held to the record and a scan's population could drift from the simulator's unseen"],
  [path.join(ROOT, 'lib', 'stagework.js'), "          for (const m of per) if (m[i] === call) agree++;", "          for (const m of per) agree++;",
    'theCaptureIsTheStageThreeRecordsOwnTradesToTheCent', 'every entry reads as unanimous, so the conviction ladder sizes every trade at its top rung and reports an uplift nothing earned'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const entries = t.windows.flatMap((w) => (sv.entries[w] || []).map((e) => ({ ...e, window: w }))).sort((a, b) => a.ts - b.ts);", "  const entries = CAPTURE_WINDOWS.flatMap((w) => (sv.entries[w] || []).map((e) => ({ ...e, window: w }))).sort((a, b) => a.ts - b.ts);",
    'theTwoScansRunOnTheCapturedEntriesAndOnlyAHeldBackReadIsALook', 'a scan reads every window whatever was ticked, so the held-back entries are read without a look being counted'],
  [path.join(ROOT, 'lib', 'stages.js'), "  const look = isLook ? reads.filter((r) => r && r.look != null).length + 1 : null;", "  const look = null;",
    'theTwoScansRunOnTheCapturedEntriesAndOnlyAHeldBackReadIsALook', 'a read of the held-back entries is never counted as a look, on the capture or on Verify'],
  // ---- the stage-engine check builds four years (3.92.1) ----
  [path.join(ROOT, 'lib', 'stagegate.js'), "  windowLayout: 'reserve61', allLoaded: false, startMonth: SPAN.fromMonth, endMonth: SPAN.toDate.slice(0, 7),", "  windowLayout: 'reserve61', allLoaded: false, startMonth: '2024-01', endMonth: SPAN.toDate.slice(0, 7),",
    'theCheckBuildsFourYearsAndItsMonthsFollowItsSpan', 'the check fabricates four years and trains on one, and fails on its own starvation again while claiming the longer span'],
  // ---- the 80/20 layout removed from stage 1 (3.93.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  if (params.windowLayout === 'legacy80') throw new Error('the 80/20 window layout was removed:", "  if (false) throw new Error('the 80/20 window layout was removed:",
    'theEightyTwentyLayoutIsGoneFromStageOne', 'a launch asking for the removed layout is quietly relaid as 61/13/13/13 while its record claims what was asked'],
  // ---- the History half-life run (3.94.0) ----
  [path.join(ROOT, 'lib', 'halflife.js'), "  const weights = age.map((a, i) => a * (base ? base[i] : 1));", "  const weights = age.map((a, i) => (base ? base[i] : 1));",
    'theAgeWeightMultipliesIntoTheSetsOwnWeightsAndAStarvedHalfLifeIsRefusedInWords', 'the half-life changes nothing: every column is the unweighted training wearing a half-life name'],
  [path.join(ROOT, 'lib', 'halflife.js'), "  return best.v >= none + 1 ? best.key : NONE;", "  return best.v >= none ? best.key : NONE;",
    'theAgeWeightMultipliesIntoTheSetsOwnWeightsAndAStarvedHalfLifeIsRefusedInWords', 'a tie or a fraction of a cent turns a row green for a half-life, and the 4.h set built from the table carries records nothing improved'],
  [path.join(ROOT, 'lib', 'stages.js'), "          unit: { bandPct: rec.bandPct, probs: t.members.map((m) => m.probs), ts: t.ts, members: t.members.map((m) => ({ spec: m.spec, tauProbs: m.tauProbs, saved: m.saved })) },", "          unit: { bandPct: rec.bandPct, probs: base.unit.probs, ts: base.unit.ts, members: base.unit.members },",
    'theRunPricesEveryColumnOnOneStretchAndTheUnweightedColumnIsTheRecordsOwn', 'every half-life column is priced from the set\'s original votes, so the table shows the unweighted money under six names'],
  // ---- the 4.h set and the half-life carried forward (3.95.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  const kept = (run.rows || []).filter((r) => r.best && r.best !== HL.NONE);", "  const kept = (run.rows || []).slice();",
    'theBuildKeepsOnlyRowsAHalfLifeWonAndEachRecordCarriesIts', 'the half-life set carries every record of the table, including the ones nothing improved'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (doc.derived) { const src = getSet(doc.derived.from); return src ? unreadGateOf(src) : null; }", "  if (doc.derived) { return null; }",
    'theBuildKeepsOnlyRowsAHalfLifeWonAndEachRecordCarriesIts', 'a half-life set has no standing at all: Tune and Greenlight refuse every record it holds'],
  [path.join(ROOT, 'lib', 'live', 'stagesignal.js'), "  if (Number.isFinite(h) && h > 0) return require('../halflife').halfLifeWeights(training, trainChunks, fee, h).weights;", "  if (false) return require('../halflife').halfLifeWeights(training, trainChunks, fee, h).weights;",
    'theHalfLifeTravelsIntoTheCaptureTheGreenlightAndTheLivePath', 'a deployment minted from a half-life record trains its members with every day weighed the same, and trades a setup that was never priced'],
  // ---- the two checks live on Setup, under Version (3.96.0) ----
  [path.join(ROOT, 'public', 'construct.js'), "localStorage.setItem('setup-tab', 'version')", "localStorage.setItem('setup-tab', 'compute')",
    'theCheckLivesOnSetupsVersionTabAndTheMarkerGoesThere', 'the marker beside "stage-engine check:" opens Setup on the wrong tab, and the owner hunts for a check that is not there'],
  [path.join(ROOT, 'lib', 'stages.js'), "  out.blockedBy = stageGateBlockedBy();", "  out.blockedBy = 'a stage run';",
    'theBoxsBusyAnswerLivesOnTheChecksStatus', 'the status calls an idle box busy, so the deploy gate never deploys and the press sleeps forever'],
  [path.join(ROOT, 'lib', 'stages.js'), "  // and where \"sweep processor\" \"runs on\" (3.99.0), before anything is written\n  sweepHereOrRefuse();", "  // and where \"sweep processor\" \"runs on\" (3.99.0), before anything is written\n  void 0;",
    'theStageLaunchesReadTheRoleAndRefuseAnUnreachablePlatform', 'the Compute tab\'s sweep processor row stores a choice the stage launches do not read, and a stage run starts here whatever it says'],
  [path.join(ROOT, 'lib', 'stages.js'), "function sweepHereOrRefuse() {\n  const elsewhere = require('./compute').sweepRunsHereOr();", "function sweepHereOrRefuse() {\n  const elsewhere = null;",
    'theStageLaunchesReadTheRoleAndRefuseAnUnreachablePlatform', 'the one definition answers nothing, so every reader of it is a decoration'],
  [path.join(ROOT, 'lib', 'stages.js'), "function createPool() {\n  sweepHereOrRefuse();\n  return buildPool();", "function createPool() {\n  return buildPool();",
    'theStageLaunchesReadTheRoleAndRefuseAnUnreachablePlatform', 'the backstop is gone, so a launch by another road builds its workers here whatever the Compute tab says'],
];

const only = process.argv[2] || '';

// EVERY FILE THIS HARNESS BREAKS IS RESTORED, INCLUDING WHEN IT IS KILLED.
// It restored on a throw but not on a signal, and being stopped mid-run twice
// in one sitting left a planted mutation behind in the working tree — once it
// reached a commit and a deploy before anyone noticed. A held original and a
// signal handler close that: whatever ends this process, the file goes back.
const inFlight = new Map();   // path -> original text
function restoreAll() {
  for (const [file, orig] of inFlight) {
    try { fs.writeFileSync(file, orig); } catch (_) { /* best effort on the way out */ }
  }
  inFlight.clear();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { restoreAll(); process.exit(130); });
}
process.on('exit', restoreAll);
process.on('uncaughtException', (err) => { restoreAll(); throw err; });

// WHICH FILE HOLDS A TEST, IN EITHER SHAPE THIS REPO WRITES THEM IN
// (2026-09-06). This looked only for an INDENTED `name(` -- the member-of-the-
// exported-object shape most of these files use -- so every test in
// tests/test-uicontracts.js was invisible to it: that file declares its tests
// as `function name() {` at column 0 and hands each one out on its own line.
// A guard aimed at one of them reported "no test file holds a test by that
// name", which reads as a guard left pointing at a deleted test and is the
// opposite of the truth. The guard was fine; the harness could not see it.
//
// RUNNABLE, not merely written: run.js runs a file's EXPORTS and nothing else.
// An indented member of the exported object is handed out by being written; a
// top-level function has to be named in module.exports, and one that is not is
// a helper, not a test.
const rx = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// DECLARED, never merely called: `^\\s+name(` alone matches `  assert(...)`
// as readily as `  theTest() {`, and a guard aimed at a name some file happens
// to CALL would be run against the wrong file. run.js calls every test with no
// arguments, so an empty argument list and an opening brace tell the two apart.
function fileHoldsTest(src, testName) {
  const n = rx(testName);
  // a member of the exported object: `  theTest() {`
  if (new RegExp(`^\\s+(?:async\\s+)?${n}\\s*\\(\\s*\\)\\s*\\{`, 'm').test(src)) return true;
  // handed out on its own line: `module.exports.theTest = function () {`
  if (new RegExp(`^module\\.exports\\.${n}\\s*=\\s*(?:async\\s+)?function\\s*\\(\\s*\\)\\s*\\{`, 'm').test(src)) return true;
  // declared at the top level and handed out by name somewhere below
  return new RegExp(`^(?:async\\s+)?function\\s+${n}\\s*\\(\\s*\\)\\s*\\{`, 'm').test(src)
    && new RegExp(`module\\.exports(?:\\.${n}\\s*=|\\s*=\\s*\\{[^}]*\\b${n}\\b)`).test(src);
}
module.exports = { GUARDS, fileHoldsTest };

// REQUIRING THIS FILE MUST NOT RUN IT (2026-09-06). It is a script AND, since
// the finder above is worth testing from the suite, a module. Written without
// this line it was both at once: a `require` of it started deleting guards out
// of the product files, and killing that mid-flight left a line of lib/stages.js
// mutated in the working tree. Nothing about reading what this file knows may
// touch a file on disk.
if (require.main !== module) return;

let missed = 0;
for (const [file, from, to, testName, consequence] of GUARDS) {
  if (only && !testName.toLowerCase().includes(only.toLowerCase())) continue;
  const orig = fs.readFileSync(file, 'utf8');
  inFlight.set(file, orig);
  const hits = orig.split(from).length - 1;
  if (!hits) {
    console.log(`SKIP  ${testName}\n      the guard this breaks is no longer written that way, so nothing was tested`);
    missed++;
    continue;
  }
  // EVERY occurrence, not the first — a guard written twice must break twice.
  // THE ONE FILE THAT HOLDS THE TEST, not the whole suite (owner order,
  // 2026-09-02: ten guards took forty minutes, four of them per guard spent
  // running tests that could not see the line). The file is found by the
  // test's name in its source; a name no file holds is a guard aimed at
  // nothing and is reported as such rather than run against everything.
  const holders = fs.readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => /^test-.*\.js$/.test(f))
    .filter((f) => fileHoldsTest(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8'), testName));
  if (!holders.length) {
    fs.writeFileSync(file, orig);
    inFlight.delete(file);
    console.log(`SKIP  ${testName}\n      no test file holds a test by that name, so the guard is aimed at nothing`);
    missed++;
    continue;
  }
  fs.writeFileSync(file, orig.split(from).join(to));
  let out = '';
  try {
    out = execFileSync('node', [path.join(ROOT, 'tests', 'run.js'), ...holders], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
  } finally {
    fs.writeFileSync(file, orig);
    inFlight.delete(file);
  }
  if (new RegExp(`FAIL[^\\n]*${testName}`).test(out)) {
    console.log(`ok    ${testName}${hits > 1 ? `  (${hits} copies of that guard broken)` : ''}`);
  } else {
    missed++;
    console.log(`MISS  ${testName}\n      the guard was deleted and the suite stayed green, so ${consequence}`);
  }
}

console.log(missed
  ? `\n${missed} guard(s) are not really being checked — see above`
  : '\nevery guard was deleted in turn and the suite caught every one');
process.exit(missed ? 1 : 0);
