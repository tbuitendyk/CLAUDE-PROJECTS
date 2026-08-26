// PLAIN-LANGUAGE HELP FOR EVERY CONTROL ON EVERY SCREEN (owner order, 2026-08-21).
//
// The owner's words: "make a useful help tab ... WITH SIMULATED STATIC SCREEN
// ELEMENTS AND *EVERYTHING* and i mean EVERYTHING described in plain language".
//
// Why it exists: there were no help pages at all, fourteen controls on the
// Sweep tab had not even hover text, and the only way to find out what
// something did was to ask — and be answered in words that are not on the
// screen. A word list stops that getting worse. This is the part that helps.
//
// THE RULES THIS FILE IS HELD TO, both checked by tests/test-help.js:
//   * every control on every screen has an entry here — no exceptions, and a
//     control added tomorrow fails the build until it gets one;
//   * no entry uses a word that is not either on that screen or ordinary
//     English. An explanation written out of more jargon is not an explanation.
//
// `what` is one or two sentences: what the control does, in the words on the
// screen. `more` is optional: the thing that is not obvious, the cost, or the
// trap.
window.HELP = {
  data: {
    title: 'Data',
    how: [
      ['Where every number in the system comes from',
        'This is the only part that reaches the internet. It fetches hourly prices — the opening, highest, lowest and closing price of each hour — from the public price service, and keeps them on the machine.\\n\\nEverything else in the system works from those stored files and nothing else. A month that is missing hours, or was never fetched, silently makes every result computed from it smaller than it looks, which is why the table above shows what is held rather than assuming.'],
    ],
    intro: 'The price history everything else is worked out from. Nothing here decides '
      + 'anything about trading — it only fetches and keeps the hourly prices, and shows what is held.',
    controls: {
      dlPairs: {
        what: 'The assets to fetch, written the way the exchange names them, separated by commas — for example LTCUSDT,XRPUSDT.',
        more: 'Leave it alone if you only want to top up what is already held; use Global Refresh for that instead.',
      },
      dlStart: { what: 'The first month to fetch.' },
      dlEnd: { what: 'The last month to fetch.' },
      dlBtn: {
        what: 'Fetches the assets named above, for the months between from and to.',
        more: 'This reaches the public price service over the internet. It is the only thing in the whole system that does.',
      },
      dlRefreshAll: {
        what: 'Tops up every asset already held, from its newest stored month through the current one. Nothing new is added — it only brings what you have up to date.',
        more: 'The progress appears beside the button while it runs.',
      },
    },
  },

  sweep: {
    title: 'Sweep',
    intro: 'Where a search is set up and started. It tries a great many settings against the '
      + 'price history and records how each one would have done. Nothing here places an order or '
      + 'commits to anything: a sweep produces a list to look at, and every result is a candidate, not a finding.\n\n'
      + 'The controls are drawn as two boxes because they fall into exactly two kinds. Everything in the '
      + 'first box shapes both passes. Everything in the second box the first pass ignores completely, '
      + 'however it is set. Between them sits promote top K, which is the only thing that travels from '
      + 'one pass to the other.',
    how: [
      ['What happens when you press Start sweep',
        'It builds a list of everything to try, then works through it twice.\n\n'
        + 'The list is every asset you asked for — on its own if singles is ticked, alongside one other '
        + 'if doubles is, alongside two if triples is — set against every combination of the four boxes '
        + 'under branch: chunk shape, decision, band % (or auto) and 24/5. Tick permute beside any of '
        + 'those and every value of it is tried instead of just the one showing, which multiplies the list.'],
      ['The first pass: everything, cheaply',
        'Every single item on that list is scored. Cheaply, in two specific ways: fewer separate '
        + 'forecasts are made for each asset, and only the stop that sits still is tried — the trailing '
        + 'plane tick is ignored on this pass however it is set.\n\n'
        + 'The point of this pass is to rank, not to measure. It puts the list in order.'],
      ['The second pass: the best of it, in full',
        'The best rows from the first pass are then scored again, properly. How many is exactly what '
        + 'promote top K says — 25 unless you change it, and it cannot go above 50.\n\n'
        + 'This time each asset gets its full set of forecasts, which is what the agree and with '
        + 'contexts fractions are counting out of. And if also try moving stops is ticked, every setting is '
        + 'also tried with stops that follow the price up behind you, at four distances and three '
        + 'starting points — roughly thirteen times the work, but only on these rows, not on all of them.'],
      ['What you end up with',
        'A board, on the Boards tab. One row per thing tried, with what it would have made, how many '
        + 'trades that took, and how it did against simply holding the asset. The rows scored twice are '
        + 'marked as such.\n\n'
        + 'Read it as a list of candidates. The best row on a board of thousands is the best of '
        + 'thousands of tries, and that flatters itself — which is what the Verify, History and Tune '
        + 'tabs exist to deal with.'],
      ['What null boards change, which is more than it looks',
        'Setting null boards above 0 does two things, and the second is not obvious.\n\n'
        + 'It adds that many companion runs on deliberately scrambled decisions, so you can see whether '
        + 'the real one did any better than nonsense. With 19 of them the strongest claim available is '
        + 'one-in-20.\n\n'
        + 'AND it changes how the run works: every row gets the full second-pass treatment instead of '
        + 'only the best ones, because a scrambled companion has to be scored exactly as deeply as the '
        + 'real thing or the comparison is worthless. So promote top K stops applying, and the run is '
        + 'not (N+1) times the size — it is very much more than that.'],
      ['What replication adds, if you tick it',
        'The search picks its winner after seeing the results, which is what makes the best row '
        + 'flatter itself. Replication is the opposite: YOU fix the settings before the run, and '
        + 'every asset is scored on what you fixed.\n\n'
        + 'With every permute left unticked that is one set of settings, and it is the strongest '
        + 'reading the system offers — nothing was chosen after the fact, so there is nothing to '
        + 'correct for.\n\n'
        + 'Tick permute on any of those boxes and it becomes every combination of them, each one '
        + 'scored on every asset. That is searching again, and it costs twice: the counter beside '
        + 'the boxes says how many sets you have declared and the run grows by that much, and the '
        + 'reading loses the very thing that made it strong. Having searched, the honest end is the '
        + 'sealed block you get with the 61/13/13/13 window layout.\n\n'
        + 'The boxes follow the run, not each other. Tick permute beside entry while entry reads '
        + 'market and gate, d, trail and arm all appear, because breakout is now in the run and '
        + 'needs them. Tick permute beside trail while it reads static and arm appears, because '
        + 'following stops are now in the run and every one of them needs a starting point.'],
    ],
    controls: {
      cxCampPick: {
        what: 'Pick a campaign that already exists. Choosing one switches to it straight away.',
        more: 'A campaign is a name you give a line of work. Every run started while it is set carries that name, so months later you can see which runs belonged together.',
      },
      cxCamp: { what: 'Type a name here to start a new campaign, then press Set.' },
      campSet: { what: 'Makes the name in the box the campaign in use. From then on, every run started carries it.' },
      campTree: {
        what: 'Shows every run and every greenlight that belongs to the campaign named in the box, and which run each one came from. Press it again to put them away.',
        more: 'It shows and hides the same panel Delete campaign… writes its summary into. A delete summary is never wiped by pressing this — the second press only puts away a list this button put up.',
      },
      campDelete: {
        what: 'Removes a campaign and everything underneath it — its runs, the saved files those runs produced, its greenlights, and any setups made from those greenlights.',
        more: 'It tells you exactly how many of each will go before it asks, and you have to type the name back. It refuses outright if any setup made from that campaign is still running on the Trade tab, and names which ones.',
      },
      swUni: {
        what: 'Which assets to search over. Leave it blank to use all of the ones held.',
        more: 'Write them separated by commas to narrow it down.',
      },
      swSingles: { what: 'Include each asset judged on its own price history alone.' },
      swDoubles: { what: 'Include each asset judged alongside one other asset, so how the two move against each other counts as well.' },
      swTriples: { what: 'Include each asset judged alongside two others.' },
      swAll: {
        what: 'Use every month of price history that is held, rather than a chosen range.',
        more: 'With this ticked, start and end are ignored.',
      },
      swStart: { what: 'First month of price history to search over. Ignored when all loaded data is ticked.' },
      swEnd: { what: 'Last month of price history to search over. Ignored when all loaded data is ticked.' },
      swGeom: {
        what: 'How long a stretch of prices each decision looks at, and how often a decision is made. Weekly 8-day looks at eight days and decides once a week; Daily 1-day looks at one day and decides every day.',
      },
      swPermGeom: { what: 'Try every chunk shape rather than only the one chosen. Multiplies the size of the search.' },
      swDec: {
        what: 'How a forecast becomes a decision. argmax takes whichever outcome is judged most likely. directional only acts when the forecast is confident enough, and stands aside otherwise.',
      },
      swPermDec: { what: 'Try both ways of deciding rather than only the one chosen.' },
      swBand: {
        what: 'How big a move has to be before it counts as a move at all, as a percentage. Anything smaller is treated as going nowhere.',
        more: 'Leave it as auto to have it worked out from each asset’s own history, which is usually what you want, because a percentage that suits one asset will not suit another.',
      },
      swPermBand: { what: 'Try more than one size of move rather than only the one chosen.' },
      swWeekdays: {
        what: 'Only decide and open on weekdays. Affects the daily chunk shapes only — the weekly one has no weekday rule, so ticking this does nothing to it.',
      },
      swPermWk: {
        what: 'Try it both ways — weekdays only, and every day.',
        more: 'When this is ticked the 24/5 tick is ignored, because both are being tried. Weekly 8-day is only tried one way, since the setting means nothing to it.',
      },
      swLayout: {
        what: 'How the price history is divided up between finding something and testing it. 70/15/15 keeps one block back to check against. 61/13/13/13 keeps a second block back, sealed, to be looked at once at the very end.',
        more: 'Use the sealed one when you intend to search hard, because the honest end of a search is a block of data the search never touched.',
      },
      swBoardRows: {
        what: 'How many rows the board of results keeps. It was stuck at 50 and there was no box for it anywhere, so you could not see it or change it.',
        more: 'Everything scored gets ranked, and only this many are kept. There is no limit — type any number and the cost of it is printed beside the box before you start. The cost is in the sorting: the list is re-ordered every time a new row lands on it, so a very large one is slower on a wide run. It also decides the most that can go into the second pass, because the second pass picks from this list.',
      },
      swK: {
        what: 'How many of the best rows get scored a second time, in full. It sits between the two boxes because it is the only thing that travels from one pass to the other.',
        more: 'Everything is scored once cheaply first. Only this many are then scored again with the fuller treatment. It used to be reduced to 50 without telling you; now it goes through as you typed it, and if you ask for more than the board keeps you are told so and asked to change one of the two boxes — neither is changed for you. Two things switch it off entirely: null boards above zero, and the replication tick — either of those sends EVERY row through the second pass, and this box then does nothing.',
      },
      swNulls: {
        what: 'How many companion runs to do on deliberately scrambled decisions, as a comparison. If the real run does no better than the scrambled ones, there was nothing there.',
        more: 'This is the single most expensive setting on the page. Each one costs a whole extra search, AND turning it on changes how the run works: every row is scored in full rather than only the best ones, so promote top K stops applying. With N companions the strongest claim you can make is one-in-(N+1) — 19 of them gets you one-in-20, and past that you are buying decimal places rather than evidence. There is no ceiling: type any number and the cost of it is printed beside the box before you launch.',
      },
      swMinTr: { what: 'Ignore any result that came from fewer trades than this. A handful of trades is luck, not evidence.' },
      swFee: {
        what: 'What a trade is assumed to cost, as a percent of the money in the position. It is charged each way — once going in and once coming out — so 0.125 here costs 0.25 percent over the whole trade.',
        more: 'This is not a detail. Most of what a search finds is eaten by what it costs to trade, and the point where a setting stops making money sits only a little above the cost you assume here — so the same run priced two ways can give two different answers about the same setting. Set it to what the place you would actually trade this on charges; different places charge different amounts, which is why the box is here and not fixed in the program. It follows the config: send one to the Trade page and it starts out priced at whatever it was found under here, and can be changed there.',
      },
      swTrail: {
        what: 'Makes the search try stops that follow the price up behind you, as well as the one that sits still.',
        more: 'Each setting is then tried with four following distances and three starting points, so roughly thirteen times as much work — and only on the rows that got scored a second time, never on the first cheap pass. This is about what the RUN looks at. The trail box further down this same box is a different question: which stop the one configuration YOU name uses. They were called almost the same thing until 2026-08-22, which is why this one is now spelled out.',
      },
      swDecOn: {
        what: 'As well as the search, score settings YOU fix here — before the run — on every asset. Leave every permute unticked and that is one set of settings; tick any of them and it becomes every combination of the boxes you ticked, each one scored on every asset.',
        more: 'With nothing permuted this is the strongest kind of reading available, because nothing was picked after seeing the results. Permuting is searching again, so that strength goes: the counter beside the boxes says how many sets you have declared, it multiplies the whole run, and the honest end of a search is the sealed block you get with the 61/13/13/13 window layout. Either way the search still runs as normal and this adds a separate table beside it.',
      },
      swDecEntry: {
        what: 'How the position is opened. market buys or sells at the opening price of the hour, in whichever direction was called. breakout waits until the price reaches a level set d away from where it started, and opens there.',
      },
      swPermDecEntry: { what: 'Score every way of opening as its own fixed set of settings.' },
      swDecGate: {
        what: 'When a position is allowed to be opened at all. directional only when a direction was called; active whenever anything is happening; always every single period.',
        more: 'market opens in the called direction and has nothing to gate, so this box is hidden while entry is market — unless permute beside entry is ticked, because then breakout is in the run too and needs a gate.',
      },
      swPermDecGate: { what: 'Score every gate as its own fixed set of settings.' },
      swDecD: {
        what: 'How far from the starting price the opening level sits, as a multiple of the band. Bigger means waiting for a larger move before opening.',
        more: 'Only applies to breakout, so it is hidden while entry is market — unless permute beside entry is ticked, because then breakout is in the run too.',
      },
      swPermDecD: { what: 'Score every distance as its own fixed set of settings.' },
      swDecT: { what: 'How many hours a position is held before it is closed, if nothing else has closed it first.' },
      swPermDecT: { what: 'Score every holding time as its own fixed set of settings.' },
      swDecTrail: {
        what: 'Which stop the one configuration you are naming here uses. static means the stop sits still, at the price level on the far side of where you opened. The others follow the price up behind you as it goes your way, at the distance shown. This is not the same control as also try moving stops above: that one decides whether the SEARCH tries moving stops at all, and this one has to have it ticked, because a named setting can only be found among the settings the run actually worked out.',
        more: 'static is NOT "no stop", and it is worth knowing how far away it sits: twice d. Two levels are placed either side of the starting price, each d away, and you open at whichever one the price reaches — so the other one, your stop, is d below the start plus the d you climbed to get in. Starting price 100 with d of 3%: levels at 103 and 97, you open long at 103, your stop is 97, which is 6 below your entry. To test with NO stop at all, set entry to market instead — that places no levels, so nothing can stop you out and the only way out is time.',
      },
      swPermDecTrail: { what: 'Score every kind of stop, static included, as its own fixed set of settings.' },
      swDecArm: {
        what: 'How far the price has to move in your favour before a following stop starts following. 0× follows from the very beginning.',
        more: 'A stop that does not move has nothing to start, so this box appears only when there is a following stop in the run: trail set to something other than static, or permute beside trail ticked, which puts the following stops in whatever the box itself says.',
      },
      swPermDecArm: { what: 'Score every starting point as its own fixed set of settings.' },
      swDecQ6: {
        what: 'How many of the 6 must say the same thing before a trade is taken, for an asset judged on its own.',
        more: 'The 6 are 3 views (full / prices / volume) × 2 models (logreg and boost). Those names are on the Boards screen: press a Survivor board row\'s inspect button and its view and model columns list them, one line per member.',
      },
      swDecQ8: { what: 'The same, for an asset judged alongside others — there are 8 to agree rather than 6.' },
      swPermDecAgree: {
        what: 'Score every level of agreement as its own fixed set of settings.',
        more: 'This one multiplies the work fastest of all of them.',
      },
      swDesc: {
        what: 'Why you are doing this run. It is kept with the run and shown in its heading from then on.',
        more: 'Worth writing. Months later it is the only thing that says what you were trying to find out.',
      },
      swStart2: { what: 'Starts the search with the settings above. Progress appears below.' },
      swStop: {
        what: 'Stops the running search.',
        more: 'The two heavy scans on the Tune tab do not stop — they take minutes and run to the end. The Tune tab shows which one is going.',
      },
    },
  },

  sweep2: {
    title: 'Sweep2',
    intro: 'A drawing, not a working screen. Every control on it is switched off, and nothing on it reads or '
      + 'writes anything. It shows a proposed redesign of the search as three stages you run one at a time, so the '
      + 'design can be marked up and corrected before any of it is built.',
    how: [
      ['Why this page exists, and what the three stages are',
        'The current sweep does everything in one run: it trains cheaply, trains fully, deals its scrambled copies by '
        + 'training them again, and prices the declared settings — all inside one job, and asking any new question '
        + 'afterwards means running the whole thing again.\n\n'
        + 'The drawing splits that into three stages, each writing a record set the next one reads. Stage 1 trains the '
        + 'cheap members once for every unit and KEEPS EVERY VOTE they cast. Stage 2 trains the fuller boards, but only '
        + 'on the rows you carry forward, and reuses the stage 1 members instead of training them a second time. '
        + 'Stage 3 never trains anything: it prices any setting, or any block of settings, straight from the kept '
        + 'votes — so the question you think of tomorrow costs minutes, not days.\n\n'
        + 'The worked example on the page: the run open on Boards today holds 25,704 units and cost 231,336 trainings. '
        + 'The same work as three stages is 77,112 trainings at stage 1 plus 3,000 at stage 2 — roughly a third — and '
        + 'every scrambled copy becomes free arithmetic instead of another training.'],
    ],
    controls: {
      s2Uni: { what: 'Which coins stage 1 scores. Leave it blank to use all of the ones held; write them separated by commas to narrow it down.' },
      s2Singles: { what: 'Include each coin judged on its own price history alone.' },
      s2Doubles: { what: 'Include each coin judged alongside one other coin.' },
      s2Triples: { what: 'Include each coin judged alongside two others.' },
      s2AllData: { what: 'Use every month of price history that is held, rather than a chosen range. With this ticked, start and end are ignored.' },
      s2Start: { what: 'First month of price history stage 1 works over.' },
      s2End: { what: 'Last month of price history stage 1 works over.' },
      s2Geom: { what: 'How long a stretch of prices each decision looks at, and how often a decision is made — same meaning as on Sweep.' },
      s2PermGeom: {
        what: 'Train every chunk shape rather than only the one chosen. This is a real multiplier of training, so it lives at stage 1 where the training happens.',
      },
      s2Layout: { what: 'How the price history is divided between finding something and testing it — same meaning as on Sweep. The sealed layout is the honest end of a search.' },
      s2Fee: { what: 'What a trade is assumed to cost, as a percent of the money in the position, charged each way — same meaning as on Sweep.' },
      s2Dec: {
        what: 'Part of the one ordering setting: how a forecast becomes a decision when stage 1 scores each unit for the ranking.',
        more: 'The ordering setting exists because a rank has to be taken under some setting. It is named here, before anything is read, and there is deliberately no permute beside it — blocks of settings belong to stage 3.',
      },
      s2Band: { what: 'Part of the one ordering setting: how big a move has to be before it counts as a move at all. auto works it out from each coin\'s own history.' },
      s2Wk: { what: 'Part of the one ordering setting: score the ranking on weekday activity only.' },
      s2Entry: { what: 'Part of the one ordering setting: how a position is opened — same meaning as on Sweep.' },
      s2Gate: { what: 'Part of the one ordering setting: when a position may be opened at all — same meaning as on Sweep.' },
      s2D: { what: 'Part of the one ordering setting: how far from the starting price the opening level sits — same meaning as on Sweep.' },
      s2T: { what: 'Part of the one ordering setting: how many hours a position is held before it is closed.' },
      s2Trail: { what: 'Part of the one ordering setting: which stop it uses. static sits still at the level on the far side of your entry; the others follow the price behind you.' },
      s2Arm: { what: 'Part of the one ordering setting: how far the price must move in your favour before a following stop starts following.' },
      s2Q6: { what: 'Part of the one ordering setting: how many of a single coin\'s members must say the same thing before a trade is taken. At stage 1 that is 3 members; the fuller 6 arrive at stage 2.' },
      s2Q8: { what: 'The same, for a unit judged alongside contexts.' },
      s2Copies1: {
        what: 'How many scrambled companions each unit is compared against, dealt from the kept votes after training — so they cost no training at all.',
        more: 'The share of its copies each unit beats becomes one of the orderings stage 2 can carry forward by. That is the point of copies at this stage: they steer the pick.',
      },
      s2Desc1: { what: 'Why this stage 1 exists. Kept on the record set and shown wherever it is named.' },
      s2Go1: { what: 'Would start stage 1. On this drawing it is switched off, like everything else here.' },
      s2From2: {
        what: 'Which stage 1 record set stage 2 carries forward from. A stage 2 record set names this parent forever.',
        more: 'It refuses a parent built on different price data — the record sets carry fingerprints of the price files and a mismatch refuses rather than mixes.',
      },
      s2Order: {
        what: 'Which stage 1 measure the carry is ordered by: test money, test money against just holding the coin, the share of its own copies each unit beat, or trades.',
        more: 'The order is taken on the test window only. The held-back window is never read to choose what carries forward.',
      },
      s2Carry: { what: 'How many rows carry forward into the fuller training, best first under order by. 0 carries all of them.' },
      s2Copies2: { what: 'Scrambled companions for the carried rows, dealt from the kept votes of all members — still no extra training.' },
      s2Desc2: { what: 'Why this stage 2 exists. Kept on the record set.' },
      s2Go2: { what: 'Would start stage 2. Switched off on this drawing.' },
      s2From3: {
        what: 'Which stage 2 record set the pricing reads its kept votes from. A stage 3 record set names this parent forever.',
      },
      s2P3Dec: { what: 'The decision to price, or with permute ticked, every decision — arithmetic on the kept votes either way.' },
      s2P3PermDec: { what: 'Price every way of deciding as its own setting in the block.' },
      s2P3Band: { what: 'The band to price, or with permute ticked, more than one size of move.' },
      s2P3PermBand: { what: 'Price more than one band as its own setting in the block.' },
      s2P3Wk: { what: 'Price weekday-only activity for this setting.' },
      s2P3PermWk: { what: 'Price it both ways — weekdays only, and every day.' },
      s2P3Entry: { what: 'The way of opening to price — same meaning as on Sweep.' },
      s2P3PermEntry: { what: 'Price every way of opening as its own setting in the block.' },
      s2P3Gate: { what: 'The gate to price — same meaning as on Sweep.' },
      s2P3PermGate: { what: 'Price every gate as its own setting in the block.' },
      s2P3D: { what: 'The opening-level distance to price.' },
      s2P3PermD: { what: 'Price every distance as its own setting in the block.' },
      s2P3T: { what: 'The holding time to price.' },
      s2P3PermT: { what: 'Price every holding time as its own setting in the block.' },
      s2P3Trail: { what: 'The stop to price. static sits still; the others follow the price behind you.' },
      s2P3PermTrail: { what: 'Price every kind of stop, static included, as its own setting in the block.' },
      s2P3Arm: { what: 'The starting point for a following stop.' },
      s2P3PermArm: { what: 'Price every starting point as its own setting in the block.' },
      s2P3Q6: { what: 'How many of a single coin\'s 6 members must agree, for the setting being priced.' },
      s2P3Q8: { what: 'The same, for a unit judged alongside contexts — 8 members rather than 6.' },
      s2P3PermAgree: { what: 'Price every level of agreement as its own setting in the block. It multiplies the block fastest, and here that multiplying costs arithmetic, not training.' },
      s2P3Copies: {
        what: 'Scrambled companions per setting, dealt from the kept votes.',
        more: 'The same deals are used for every setting in the block, so any two settings\' shares are always comparable.',
      },
      s2P3Desc: { what: 'Why this stage 3 exists. Kept on the record set.' },
      s2P3Go: { what: 'Would start stage 3 — pricing only, no training. Switched off on this drawing.' },
    },
  },

  boards: {
    title: 'Boards',
    how: [
      ['What a row is, and why the best one lies to you',
        'One row is one thing that was tried: an asset, a chunk shape, a decision, a band, and — for the rows scored twice — one particular combination of entry, gate, d, t, trail and arm.\\n\\nThe board is sorted, so the top row is the best of everything tried. That is exactly the problem. Try two thousand things against the same history and the best of them looks good whether or not anything real is there, because you picked it after seeing the answers. The number on the top row is not wrong; what is wrong is reading it as what you would have made.\\n\\nWhat the board is FOR is narrowing: it says which handful are worth the slower checks on the tabs after it. Picking a row here is what those tabs then work on.'],
    ],
    intro: 'What a finished search found, one row per setting tried. This is a list to read, not '
      + 'a set of answers: the best row on a board of thousands is the best of thousands of tries, and '
      + 'that flatters itself. Picking a row here is what the Verify, Tune and Greenlight tabs then work on.',
    controls: {
      bPick: { what: 'Which finished run to look at. The newest is at the top.' },
      bOpen: { what: 'Loads the chosen run and draws its rows below.' },
      bResume: {
        what: 'Carries on a run that stopped, from where it stopped. It scores only the units that have no result yet — everything already scored is kept exactly as it is — and then finishes as normal.',
        more: 'It refuses more than it accepts, on purpose. The price files have to fingerprint identically to the ones the run read, and the engine has to be the same version it started under. Half a board worked out from one history and half from another is not one board, and nothing on the finished screen would say so. It also refuses a run that finished, and one that is going now. Anything that failed the first time gets another go, since a failure left no result to keep.',
      },
      bCoinSort: {
        what: 'How the every-coin table is ordered. beat its own copies puts the strongest scores first, with more comparisons winning ties; comparisons puts the best-evidenced rows first; avg held-back, coin and configuration order by those.',
        more: 'The whole data set is sorted before the page is cut, so page one really is the top of everything — never just the top of a page.',
      },
      bCoinMin: {
        what: 'Hides rows whose score rests on fewer head-to-heads than this. Zero hides nothing.',
        more: 'A perfect score built on ten comparisons is luck wearing a score. The line under the table says how many rows a floor removed, so nothing disappears silently.',
      },
      bCoinMinShare: {
        what: 'Hides rows whose share of head-to-heads won is below this percent. Empty hides nothing.',
        more: 'A set floor also hides rows with no share at all — a row that was never measured cannot clear a bar, and letting it through would smuggle unmeasured rows past every filter.',
      },
      bCoinMinHold: {
        what: 'Hides rows whose avg held-back is below this many dollars. Empty hides nothing.',
        more: 'A set floor also hides rows that recorded no held-back money.',
      },
      bCoinMinTrades: {
        what: 'Hides rows whose avg trades is below this. Empty hides nothing.',
        more: 'A row whose money rests on a handful of trades is thin evidence however good the other columns look.',
      },
      bCoinMinVsLong: {
        what: 'Hides rows whose avg vs always-long is below this many dollars. Empty hides nothing.',
        more: 'Zero keeps only rows that beat just holding the coin, on average.',
      },
      bCoinGo: {
        what: 'Asks again with the sort and floor chosen beside it.',
      },
      bDelete: {
        what: 'Permanently removes the run that is open, together with the model and tuning files that belong only to it. You are shown exactly what will go, and then have to type the run id back, before anything is deleted.',
        more: 'It refuses two things. The run that is going right now — stop it first, so a job cannot be writing a file that is being taken away underneath it. And any run a greenlight names as the evidence it came from, because something on the Trade tab may be standing on that evidence. Neither refusal deletes anything; both say which it is.',
      },
      bNotes: { what: 'Your own notes on this run — what you were trying, what it showed, what it cost.' },
      bNotesSave: {
        what: 'Saves the notes onto the run.',
        more: 'Only works once the run has finished; nothing can be written to a run while it is still computing.',
      },
      bCopySettings: {
        what: 'Fills the Sweep tab with the exact settings this run used, so you can do it again or change one thing.',
        more: 'Everything comes across: the assets, the sizes, the date range, the chunk shape, the decision, the band, the permutes, the window layout, the null boards and also try moving stops.',
      },
      bSort: { what: 'What to order the rows by.' },
      bClearSel: {
        what: 'Unpicks the row you had selected.',
        more: 'Worth knowing: a row picked once keeps steering the Verify, Tune and Greenlight tabs until it is cleared here.',
      },
    },
  },

  boards2: {
    title: 'Boards2',
    intro: 'A drawing, not a working screen. Every control on it is switched off and every row on it is a worked '
      + 'example. It shows how the three stages drawn on Sweep2 would read back: one table per stage, with the chain '
      + 'between them always on screen.',
    how: [
      ['One table per stage, and the chain always visible',
        'Every record set names the one it came from, so the page always shows the whole chain: which stage 1 the '
        + 'ranking came from, which stage 2 carried what forward and by which measure, and which stage 3 priced what. '
        + 'No table mixes two stages, and every number says which record set it belongs to.\n\n'
        + 'The stage 1 table is the ranking — it shows exactly where the carry-forward cut fell, including the first '
        + 'row that missed it. The stage 2 table puts each unit\'s cheap score beside its full score, so the fuller '
        + 'board\'s effect is visible instead of remembered. The stage 3 tables are the pricing: the settings ranked '
        + 'against each other, and every coin of every setting with its own records opening underneath, the same two '
        + 'readings Boards offers today.\n\n'
        + 'The held-back window appears only on stage 3 tables, because only stage 3 prices it — under settings that '
        + 'were fully named first.'],
    ],
    controls: {
      b2Pick: { what: 'Which record set to read. Every set is listed with its stage, what it holds, and the parent it came from.' },
      b2Open: { what: 'Would open the chosen record set and draw its chain and tables below. Switched off on this drawing.' },
      b2MinShare: { what: 'Hides rows whose share of head-to-heads won is below this percent. Empty hides nothing — same meaning as the floor on Boards.' },
      b2MinHold: { what: 'Hides rows whose avg held-back is below this many dollars. Empty hides nothing.' },
      b2MinTrades: { what: 'Hides rows whose avg trades is below this. Empty hides nothing.' },
      b2MinVsLong: { what: 'Hides rows whose avg vs always-long is below this many dollars. Empty hides nothing.' },
      b2Sort: { what: 'How the every-coin table is ordered — the same choices as on Boards, with setting in place of configuration.' },
      b2MinPairs: { what: 'Hides rows whose share rests on fewer head-to-heads than this. Zero hides nothing.' },
      b2Go: { what: 'Would ask again with the sort and floors chosen beside it. Switched off on this drawing.' },
    },
  },

  verify: {
    title: 'Verify',
    how: [
      ['Checking the instrument, not the result',
        'Everything on the other tabs assumes the machinery works. These checks are what establish that, and they run against made-up price histories rather than real ones — because with a made-up one you know the right answer in advance.\\n\\nOne has a pattern deliberately hidden in it and the system must find it. One has nothing in it and the system must stay quiet. A miss on the first means it is blind; a hit on the second means it invents things. Either way every other number the system has produced is worthless until it passes, so this is the first thing to look at when something seems too good.'],
    ],
    intro: 'Checks on the machinery itself, not on any particular result. These answer the question '
      + '"can this system find something that is definitely there, and does it stay quiet when there is nothing?" '
      + 'If those checks fail, no result from the system means anything until they pass.',
    controls: {
      pgRun: {
        what: 'Runs the calibration check: a made-up asset with a known pattern hidden in it, which the system must find, and a made-up asset with nothing in it, which it must not.',
        more: 'A miss on the first means it is blind. A hit on the second means it invents things. Either way, stop and fix that before trusting anything else.',
      },
      t1null: { what: 'Which scrambled companion run to read.' },
      t1run: { what: 'Reads the verdict for the chosen scrambled run.' },
      t1rounds: { what: 'How many extra scrambled rounds to fire at this run.' },
      t1fire: { what: 'Runs that many more scrambled rounds, to sharpen the comparison.' },
    },
  },

  history: {
    title: 'History',
    how: [
      ['Is it still true, or was it true in 2018',
        'A setting that worked for two years and then stopped will still look good averaged across the whole history, because the good years carry the bad ones. That is the single easiest way to be fooled by a long backtest.\\n\\nThis re-scores the same setting while counting recent evidence more heavily than old evidence, at the rate half-life sets, and shows it beside the same run with everything weighted equally. If the two disagree, the effect is not where you think it is.\\n\\nThe two exam buttons check this test itself against made-up histories, for the same reason the Verify tab exists.'],
    ],
    intro: 'Whether an effect is still there now, or was only there years ago. A setting that '
      + 'worked in 2018 and stopped working in 2022 will still look good averaged over the whole '
      + 'history — this is what separates the two.',
    controls: {
      htRun: { what: 'Runs the still-current check on the row picked on the Boards tab.' },
      ht2hl: {
        what: 'How quickly older evidence stops counting. 12mo makes evidence from a year ago count half as much as today’s; 36mo stretches that to three years.',
      },
      ht2Run: { what: 'Runs the check at the chosen setting, alongside one that weights all history equally, so the two can be compared.' },
      ht2ExamA: {
        what: 'A check on the check. Uses a made-up asset whose pattern appears only recently — the system MUST find it.',
        more: 'A miss means this test cannot see a recent effect that is provably there, so its verdicts are worthless.',
      },
      ht2ExamB: {
        what: 'The other half. A made-up asset with no pattern at all — the system must NOT find anything.',
        more: 'A hit means it invents effects.',
      },
    },
  },

  tune: {
    title: 'Tune',
    how: [
      ['One variable at a time, on the whole history',
        'The Sweep tab is wide and shallow: many settings, each scored once. This is the opposite — one setting, taken apart carefully.\\n\\nThe two scans work across every value of one thing, over all the history, and report the whole shape rather than a winner: which protective stops would have cost nothing, and how much requiring more agreement is worth. Both take minutes and cannot be stopped part-way.\\n\\nThe comparison at the bottom is not a check on whether anything is real. It only tells you what differs between two runs and what each produced.'],
    ],
    intro: 'Adjusting one chosen setting rather than searching for new ones. Everything here works '
      + 'on the row picked on the Boards tab, over the whole history.',
    controls: {
      tuneTarget: { what: 'Which setting the scans below work on — the row picked on Boards, or one already saved.' },
      stopCustomPct: { what: 'A protective stop of your own choosing, as a percentage of the opening price.' },
      stopCustomApply: { what: 'Applies the percentage typed beside it.' },
      stopClear: {
        what: 'Runs with no fixed protective stop at all. The position then rests only on its scheduled closing time.',
      },
      stopWhy: { what: 'Why you chose this stop. Kept with the choice.' },
      stopWhySave: { what: 'Saves the reason on its own, leaving the stop exactly as it is.' },
      stopRun: {
        what: 'Tries every protective stop across the whole history and reports which ones would have cost you nothing.',
        more: 'Takes minutes and cannot be stopped part-way.',
      },
      convRun: {
        what: 'Tries every level of agreement across the whole history, to see how much conviction is worth requiring.',
        more: 'Takes minutes and cannot be stopped part-way.',
      },
      cmpA: { what: 'The first of two runs to compare.' },
      cmpB: { what: 'The second.' },
      cmpGo: {
        what: 'Shows what differs between the two runs and what each one produced.',
        more: 'This is NOT a check on whether either result is real. It only says how they differ.',
      },
    },
  },

  greenlight: {
    title: 'Greenlight',
    how: [
      ['Writing down a decision, not starting one',
        'Nothing here trades. It records that you decided to take one setting forward: who, when, why, and the exact settings frozen at that moment, together with the whole chain of runs that led to it.\\n\\nThe reason it exists: months later, when something is running on the Trade tab, the question is always "what was this based on, and did we check it?" — and the honest answer has to have been written at the time, not reconstructed afterwards. That is why the reason is required rather than optional.\\n\\nWhich row gets recorded matters as much as the decision. declared cell was fixed before the run and nothing was chosen after seeing results. best cell was chosen after, and is the weakest of the three for exactly that reason.'],
    ],
    intro: 'Recording a decision to take one setting forward, with who decided, when, why, and the '
      + 'exact settings frozen at that moment. Nothing here starts trading. It writes down the decision '
      + 'so that later, when a setup is running on the Trade tab, there is a record of what it was based on.',
    controls: {
      glTarget: {
        what: 'Which row of the run gets recorded. declared cell is the one fixed before the run started — nothing was picked after seeing results. best cell is the highest scoring one, which is the best of very many tries and flatters itself. widest region is the middle of the largest patch of neighbouring settings that all made money, chosen by how surrounded it is rather than by its score.',
        more: 'declared cell is the strongest of the three. best cell is the weakest, for the reason given.',
      },
      glWhy: {
        what: 'Why this is being taken forward. Required, and kept forever with the record.',
      },
      glGo: { what: 'Writes the record. Does not start any trading.' },
    },
  },
};
