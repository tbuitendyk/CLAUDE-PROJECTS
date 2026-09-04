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
  [path.join(ROOT, 'lib', 'stages.js'), "      if (mine && mine.has(r.si)) { w.push(r); kept++; } else dropped++;", "      if (mine) { w.push(r); kept++; } else dropped++;",
    'aSetPricedBeforeTheFoldIsFoldedPerUnitOnceOnDisk',
    'the migration rewrites every record and drops none, and the set is stamped as folded while the doubles are still on disk'],
  // ---- A SET BEHIND ON THE FOLD IS NOT SERVED ITS OLD TABLES (3.52.1) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  if (alwaysStripPending(id) || foldPending(id)) return null;", "  if (alwaysStripPending(id)) return null;",
    'aSetPricedBeforeTheFoldIsFoldedPerUnitOnceOnDisk',
    'a set that already has tables is served as it stands and the per-unit fold never runs on it, which is how S3 #2 stayed doubled after the 3.52.0 deploy'],
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
  [path.join(ROOT, 'public', 'construct.js'), "  const share = Math.round(window.innerHeight * 0.8);", "  const share = Math.round(window.innerHeight * 0.45);",
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
  // ---- THE REBUILD CHECKS ITSELF AGAINST THE SWEEP (3.57.2) ----
  [path.join(ROOT, 'server.js'), "      if (!expect || !Object.keys(expect).length) expect = got.stored;", "",
    'pressingWorkOutTheMissingNumbersAsksForTheSurvivorsOfTheRule',
    'every rebuild goes back to reading NOT checked against the sweep, so a run against moved price data looks the same as a sound one'],
  // ---- THE PRESS NAMES THE RULE (3.57.1) ----
  [path.join(ROOT, 'public', 'construct.js'), "/rebuild`, { rule: st.rule, unit: st.unit, barPct: st.barPct })", "/rebuild`, { labels: [] })",
    'pressingWorkOutTheMissingNumbersAsksForTheSurvivorsOfTheRule',
    'the button goes back to asking for nothing, and every press answers "nothing was asked for"'],
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
    'theStageTablesServeTheTuningSliceMoneyAndSayWhenASetIsBehind',
    'the beat its own null set — tuning-slice $ column sorts by the forecast-score beat while looking like it sorts by money'],
  [path.join(ROOT, 'public', 'construct.js'), "      nullN: Number($('#swNull1').value) || 0, fee: Number($('#swFee1').value) / 100, desc: $('#swDesc1').value,", "      nullN: Number($('#swNull1').value) || 0, desc: $('#swDesc1').value,",
    'theFeeIsDeclaredOnTheStageOnePanelAndSentWithTheLaunch',
    'the fee box is drawn and never sent, and every stage 1 launch is refused for a fee the owner typed'],
  // ---- THE ALWAYS GATE IS GONE (3.44.0) ----
  [path.join(ROOT, 'lib', 'stages.js'), "  return alwaysLabelsOf(doc).size > 0;", "  return false;",
    'aSetPricedWithTheAlwaysGateIsBroughtUpToDateOnFirstOpen',
    'a set priced with the always gate opens as it is, a third of its board forecast-free, and nothing ever brings it up to date'],
  [path.join(ROOT, 'lib', 'bracket.js'), "  if (!GATES.includes(gate)) throw new Error(`gate must be one of ${GATES.join('/')} — not \"${gate}\"`);\n", "",
    'theAlwaysGateIsGoneAndAGateTheEngineDoesNotHaveIsRefused',
    'a stored row naming the always gate is priced as directional and nobody is told'],
  [path.join(ROOT, 'lib', 'stages.js'), "  if (alwaysStripPending(id)) return null;\n", "",
    'aSetPricedWithTheAlwaysGateIsBroughtUpToDateOnFirstOpen',
    'the old tables, a third of them a gate the engine no longer has, are served on every screen and the strip never starts'],
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
  // 3.51.0: the sealed window rides on stage 2 records and a set without it is filled in
  [path.join(ROOT, 'lib', 'stages.js'), '          reserve: rec.reserve || null,\n          specs: merged.members.map(', '          specs: merged.members.map(',
    'aStageTwoSetWithoutItsSealedWindowIsFilledInFromItsParent',
    'every stage 2 set written from now on is behind on its sealed window the day it lands'],
  [path.join(ROOT, 'lib', 'stages.js'), '  const run = startSealedFill(parent.id);\n  run.behindOf = behind.parent;', '  return null;',
    'aStageTwoSetWithoutItsSealedWindowIsFilledInFromItsParent',
    'the read sees a parent behind on its sealed window and never starts the fill — the line stays "no sealed window" for ever'],
  // 3.51.1: step 2 keeps its dial box, and a count under `values` is not a list
  [path.join(ROOT, 'public', 'construct.js'), '    ${r.why && d.step !== 2 ? `<p class="note neg">${esc(r.why)}</p>`', '    ${r.why ? `<p class="note neg">${esc(r.why)}</p>`',
    'theStepTwoScreenKeepsItsDialBoxAndSurvivesARecommendedRange',
    'a dial the rule fixed leaves step 2 with a sentence and no way to pick the next dial'],
  [path.join(ROOT, 'public', 'construct.js'), '  const chosen = new Set((Array.isArray(kept) ? kept : (Array.isArray(rr.values) ? rr.values : [])).map(String));',
    '  const chosen = new Set((kept || rr.values || []).map(String));',
    'theStepTwoScreenKeepsItsDialBoxAndSurvivesARecommendedRange',
    'a recommended range with a count throws before the page paints and narrow this one does nothing'],
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
  // THE ONE FILE THAT HOLDS THE TEST, not the whole suite (owner order,
  // 2026-09-02: ten guards took forty minutes, four of them per guard spent
  // running tests that could not see the line). The file is found by the
  // test's name in its source; a name no file holds is a guard aimed at
  // nothing and is reported as such rather than run against everything.
  const holders = fs.readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => /^test-.*\.js$/.test(f))
    .filter((f) => new RegExp(`^\\s+(?:async\\s+)?${testName}\\s*\\(`, 'm').test(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8')));
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
