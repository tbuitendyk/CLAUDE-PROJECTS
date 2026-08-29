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
const BATCH = path.join(ROOT, 'lib', 'batch.js');

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
  [BATCH, "const elsewhere = require('./compute').sweepRunsHereOr();\n  if (elsewhere) return elsewhere;",
    '',
    'theSweepLauncherReadsTheRoleAndRefusesAnUnreachablePlatform', 'the Compute tab choice becomes a decoration nothing reads'],
  [path.join(ROOT, 'lib', 'replication.js'), 'if (saved && saved.rowsSeen === rows) {', 'if (saved) {',
    'aSaveThatIsBehindSaysSoAndAFreshOneServesInstantly', 'a tally from an earlier sitting wears a finished run\'s face'],
  [path.join(ROOT, 'lib', 'batch.js'), "try { require('./replication').startTotals(doc.id); }",
    "try { void (doc.id); }",
    'theBuildRunsOffTheAnsweringThreadAndFiresAtCompletion', 'a finished run is never totalled until somebody waits the minutes for it'],
  [path.join(ROOT, 'lib', 'replication.js'), '  kept.sort(orders[key]);\n', '',
    'theFloorSaysWhatItRemovedAndPagesContinueOneOrder', 'page one of the every-coin table is whatever order the tally fell out in, presented as the top'],
  [path.join(ROOT, 'lib', 'replication.js'), 'if (saved && saved.v === TALLY_V && saved.rowsSeen === rows) {', 'if (saved && saved.rowsSeen === rows) {',
    'aTallyFromBeforeThePerCoinScoreRebuildsForTheCoinView', 'a save with no per-coin counts is served to the per-coin view as fresh, showing every coin unscored'],
  [path.join(ROOT, 'lib', 'replication.js'), 'avgHold: a.hold ? (a.sum || 0) / a.hold : null,', 'avgHold: a.sum || 0,',
    'theAveragesMatchThePencil', 'a 16-row sum is shown under the heading that says average, which is the exact uselessness the owner ordered out'],
  [path.join(ROOT, 'lib', 'replication.js'), 'avgTrades: a.hold ? (a.t || 0) / a.hold : null,', 'avgTrades: a.t || 0,',
    'theAveragesMatchThePencil', 'the trades column sums instead of averaging and reads 16 times too big'],
  [path.join(ROOT, 'lib', 'replication.js'), '    } else if (hold != null) {', "    } else if (hold != null) {\n      a.t += (r.holdout.trades || 0);",
    'theAveragesMatchThePencil', 'the scrambled copies\' trades pour into the average, which then measures the machinery instead of the coin'],
  [path.join(ROOT, 'lib', 'replication.js'), "  const got = rowstore.readBlocks(doc.id, 'replication', a.b);",
    "  const got = rowstore.readBlocks(doc.id, 'replication', (rowstore.blocksOf(doc.id, 'replication') || []).map((x, i) => i));",
    'theRecordsBehindACoinRowComeFromOnlyItsBlocks', 'opening one coin\'s records unpacks the whole store — the ten-minute freeze back under a new button'],
  [path.join(ROOT, 'lib', 'replication.js'), '      if (starts && starts.length) a.b = [...new Set(a.at.map(blockOfRow))].sort((x, y) => x - y);', '',
    'theRecordsBehindACoinRowComeFromOnlyItsBlocks', 'no save ever carries the record index, so the records button answers nothing forever'],
  [path.join(ROOT, 'lib', 'replication.js'), '      delete a.at;', '',
    'theRecordsBehindACoinRowComeFromOnlyItsBlocks', 'millions of row positions ride along in a file that is read back on every open'],
  [path.join(ROOT, 'lib', 'planted.js'), "  if ((!doc.edgeCensus || !doc.edgeCensus.length) && rowstore.exists(doc.id, 'census')) {", 'if (false) {',
    'theVerdictReadsRowsTheDocumentOnlyCounts', 'every gate run since the rows moved to disk reads UNREADABLE and the planted check fails healthy engines forever'],
  [path.join(ROOT, 'lib', 'planted.js'), '  if (prev && prev.readerV === GATE_READER_V\n    && prev.status === doc.status', '  if (prev && prev.status === doc.status',
    'aKeptVerdictFromTheOldReaderIsRetakenWhileTheRowsExist', 'the wrong FAIL kept by the blind reader is trusted until the run is deleted'],
  [path.join(ROOT, 'lib', 'planted.js'), '  if (prev && prev.runDeleted) return prev;', '',
    'aDeletedRunsVerdictIsNeverRetaken', 'a deleted run\'s kept PASS is retaken with no rows and manufactured into the very UNREADABLE the record exists to outlive'],
  [path.join(ROOT, 'lib', 'batch.js'), "        try { require('./planted').recordGate(hydrate(doc)); } catch (_) { /* the strip re-reads live runs anyway */ }", '',
    'theBootSweepRetakesStaleGateRecords', 'a wrong kept verdict lies in wait until somebody edits notes or deletes the run'],
  [path.join(ROOT, 'lib', 'replication.js'), '\n    && totalsInHand.mtimeMs === st.mtimeMs && totalsInHand.size === st.size) {', ') {',
    'theTotalsAreParsedOnceAndNeverServedStale', 'the build worker finishes a fresh tally and every screen keeps serving yesterday\'s from memory'],
  [path.join(ROOT, 'lib', 'replication.js'), '    totalsInHand = { runId, mtimeMs: st.mtimeMs, size: st.size, totals };\n    return totals;', '    return totals;',
    'theTotalsAreParsedOnceAndNeverServedStale', 'the cache caches nothing and every ask parses the whole file again'],
  [BATCH, '              decision: l.decision ?? null, bandMode: l.bandMode ?? null,\n              weekdaysOnly: l.weekdaysOnly ?? null, key: l.key ?? null,', '',
    'theRecordedRowNamesItsChoices', 'every new run\'s records go back to being anonymous settings in the very table read to learn which settings carry signal'],
  [path.join(ROOT, 'lib', 'choices.js'), '|| cur.labels.has(label)', '',
    'theOrderNamesWhatNoFieldCan', 'two same-signature units melt into one span and the vote wears the argmax\'s name'],
  [path.join(ROOT, 'lib', 'choices.js'), 'if (census[j].sig === cur.sig) { hit = j; break; }', 'if (true) { hit = j; break; }',
    'theOrderNamesWhatNoFieldCan', 'a span claims whatever census record the pointer happens to sit on, fields be damned'],
  [path.join(ROOT, 'lib', 'choices.js'), 'if (list.length <= 1) continue;', 'if (true) continue;',
    'duplicateClaimsInOneGroupAreBothStripped', 'a proven misalignment keeps its names and one unit wears another\'s choices'],
  [path.join(ROOT, 'lib', 'replication.js'), 'const s = choices.namesAt(units, ats[i]);', 'const s = choices.namesAt(units, i);',
    'theRecordsServeTheRecoveredNamesAndSaySo', 'records are named by their position IN THE ANSWER instead of in the store — every expansion past the first block lies'],
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
  [path.join(ROOT, 'lib', 'replication.js'), 'avgVsLong: a.vln ? (a.vl || 0) / a.vln : null,', 'avgVsLong: a.vl || 0,',
    'theAveragesMatchThePencil', 'the vs always-long column sums instead of averaging and reads 16 times too big'],
  [path.join(ROOT, 'lib', 'replication.js'), '    } else if (hold != null) {', "    } else if (hold != null) {\n      a.vl += (r.holdout.vsAlwaysLong || 0); a.vln++;",
    'theAveragesMatchThePencil', 'the scrambled copies thin the vs always-long average toward zero'],
  [path.join(ROOT, 'lib', 'replication.js'), '    vslong: (a, b) => byVsL(a, b) || byShare(a, b),\n', '',
    'theAveragesMatchThePencil', 'the new sort choice silently orders by nothing'],
  [path.join(ROOT, 'lib', 'replication.js'), 'if (!saved || !(saved.v >= SPANS_FROM_V)) {', 'if (!saved || saved.v !== TALLY_V) {',
    'aV3SaveKeepsTheRecordsWorkingWhileTheAveragesRebuild', 'every records button goes dark for the whole fifteen-minute rebuild after any tally change'],
  [path.join(ROOT, 'lib', 'replication.js'), 'const scoped = only ? rows.filter((r) => r.label === only) : rows;', 'const scoped = rows;',
    'aLabelNarrowsToOneConfigurationsCoins', 'an opened line shows every configuration\'s coins under one configuration\'s name'],
  [path.join(ROOT, 'lib', 'replication.js'), '  const kept = scoped.filter(clears);', '  const kept = atLeast ? scoped.filter((r) => r.pairs >= atLeast) : scoped;',
    'theFourFloorsMatchThePencil', 'four floor boxes that filter nothing — every bar typed into them is silently ignored'],
  [path.join(ROOT, 'public', 'construct.js'), '    if (Date.now() < scrollMemoryHeldUntil) return;   // the page moved itself', '',
    'theClampNeverOverwritesTheMemory', 'the clamped landing writes over the remembered place and every restore restores the wrong spot'],
  [path.join(ROOT, 'public', 'construct.js'), '  holdScrollMemory();\n  requestAnimationFrame(() => requestAnimationFrame(() => { holdScrollMemory(); window.scrollTo(0, y); }));', '  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));',
    'theClampNeverOverwritesTheMemory', 'the restore itself is what destroys the memory it restores from'],
  [path.join(ROOT, 'lib', 'replication.js'), 'for (const [mv, rec] of (g.realHold.get(k) || [])) { a.pairs++; if (mv > hold) { a.beat++; a.rb[rec]++; } }',
    'for (const [mv, rec] of (g.realHold.get(k) || [])) { a.pairs++; if (mv > hold) { a.beat++; } void rec; }',
    'theAveragesMatchThePencil', 'a copy arriving after a record never pays it — every record\'s own count under-reads and the sum stops matching the coin row'],
  [path.join(ROOT, 'lib', 'stages.js'), 'if (!diff.same) {', 'if (false) {',
    'theChainRefusalsNameThemselves', 'a stage launches over changed price files and two histories are quietly mixed into one chain'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'return [d / c, n / c, u / c];', 'return [d, n, u];',
    'theForecastScoreMatchesThePencil', 'a unit with more members outscores a better unit with fewer, by arithmetic alone'],
  [path.join(ROOT, 'lib', 'stagework.js'), 'if (!(sd > 0)) return 0;', 'if (!(sd > 0)) return null;',
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
    'theTwoScreensDrawTheSharedPanelsFromOneFunction', 'the stage 1 title stays green whatever the boxes show — the provenance flag stops flagging'],
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
    'everyCommitteeSeatIsADistinctOpinion', 'the fourth reading vanishes and a coin on its own is back to 6 members'],
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
    'unusualIsStrictestAtTheTop', 'the unusual dial runs backwards and a higher share quietly means looser'],
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
  fs.writeFileSync(file, orig.split(from).join(to));
  let out = '';
  try {
    out = execFileSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
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
