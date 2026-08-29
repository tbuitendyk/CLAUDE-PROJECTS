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

// SHARED PANELS GET SHARED ENTRIES (owner order, 2026-08-27: the campaign
// panel and the opened record set's head are each ONE piece of code drawn on
// both Sweep and Boards). Their help is written once here and spread into both
// sections, so the two screens' explanations cannot drift apart any more than
// their markup can.
const CAMPAIGN_PANEL_CONTROLS = {
  cxCampPick: {
    what: 'Pick a campaign that already exists. Choosing one switches to it straight away.',
    more: 'A campaign is a name you give a line of work. Every run and record set started while it is set carries that name, so months later you can see which belonged together.',
  },
  cxCamp: { what: 'Type a name here to start a new campaign, then press Set.' },
  campSet: { what: 'Makes the name in the box the campaign in use. From then on, every run and record set started carries it.' },
  campTree: {
    what: 'Shows every run, record set and greenlight that belongs to the campaign named in the box, and which one each came from. Press it again to put them away.',
    more: 'It shows and hides the same panel Delete campaign… writes its summary into. A delete summary is never wiped by pressing this — the second press only puts away a list this button put up.',
  },
  campDelete: {
    what: 'Removes a campaign and everything underneath it — its runs, the saved files those runs produced, its record sets, its greenlights, and any setups made from those greenlights.',
    more: 'It tells you exactly how many of each will go before it asks, and you have to type the name back. It refuses outright if any setup made from that campaign is still running on the Trade tab, and names which ones — and it refuses while a stage run is being written, because record sets are never deleted mid-run.',
  },
};
// The three Boards sections carry the same three controls each — written once
// here, one entry per literal id, so the nine cannot drift apart.
const BOARD_SECTION_CONTROLS = (() => {
  const out = {};
  const fills = {
    1: 'Picking one puts the stage 2 and stage 3 selections away — a new parent starts a new chain.',
    2: 'Picking one fills the stage 1 section with its parent and puts the stage 3 selection away.',
    3: 'Picking one fills the stage 1 and stage 2 sections with its whole chain, so the provenance is on screen.',
  };
  for (const n of [1, 2, 3]) {
    out[`bPick${n}`] = {
      what: `Which stage ${n} record set this section reads. Only stage ${n} sets are offered.`,
      more: fills[n],
    };
    out[`bDelete${n}`] = {
      what: 'Permanently removes the record set picked in this section — its records, kept votes and tables. You are shown what will go, and have to type the record set id back, before anything is deleted.',
      more: 'It refuses two things, by name: a set another set names as its parent (delete the children first), and any deletion while a stage run is going, because a run may be reading its parent at that moment.',
    };
    out[`bCopySettings${n}`] = {
      what: `Fills the stage ${n} box on Sweep with this record set's exact settings and description, so you can do it again or change one thing.`,
      more: 'Its parent record set is picked where it has one, so pressing start re-runs the same step of the same chain. The other boxes are left exactly as they are; nothing launches. It works whether the section is open or put away.',
    };
  }
  return out;
})();
const RUN_NOTES_CONTROLS = {
  bNotes: { what: 'Your own notes on this run — what you were trying, what it showed, what it cost.' },
  bNotesSave: {
    what: 'Saves the notes onto the run.',
    more: 'Only works once the run has finished; nothing can be written to a run while it is still computing.',
  },
};
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
    intro: 'The working three-stage system. Each stage writes a record set the next one reads, every set names '
      + 'its parent, and a launch refuses — by name — when the price files no longer match the ones its parent '
      + 'read. Stage 1 trains and keeps votes, stage 2 adds the BOOST members to the rows you carry forward, and '
      + 'stage 3 prices settings from the kept votes without training anything.',
    how: [
      ['What each stage does, and what it writes',
        'Stage 1 trains each unit once — LOGREG on every view — keeps every vote the members cast on the test and '
        + 'held-back windows, and ranks the units by one fixed rule: did the pooled votes beat their own null set, '
        + 'the same votes with the calendar shuffled away, at plain forecasting on the test window. No trade box '
        + 'and no fee exist at stage 1, so there is nothing to guess.\n\n'
        + 'Stage 2 reads a finished stage 1 record set, carries the best rows forward in the sort saved on its '
        + 'table on Boards (the against-null-set rule when none is saved), and trains only the BOOST members for '
        + 'them. The LOGREG members are never retrained; after this a carried unit holds all its members\' votes.\n\n'
        + 'Stage 3 reads a finished stage 2 record set and prices any block of settings from the kept votes: '
        + 'decision, band, 24/5, agree, entry, gate, d, t, trail, arm and the fee are all applied here, as '
        + 'arithmetic — test window and held-back window both, with the null set dealt from the same votes and '
        + 'the same deals used for every setting so any two settings\' shares are comparable. Ask a different '
        + 'block tomorrow and nothing retrains.'],
      ['What the launches refuse, and why',
        'One heavy job at a time: a stage refuses to start while a sweep or another stage run is going. A stage '
        + 'refuses a parent that is not finished, one written by a different engine release, and one whose price '
        + 'files no longer fingerprint identically — the refusal names the symbols that changed, and nothing is '
        + 'ever mixed. A set that finishes with failed units says INCOMPLETE on Boards rather than wearing a '
        + 'finished face: a set must match its own plan, written before anything ran.'],
    ],
    controls: {
      ...CAMPAIGN_PANEL_CONTROLS,
      swUni: { what: 'Which coins stage 1 scores. Leave it blank to use all of the ones held; write them separated by commas to narrow it down.' },
      swSingles: {
        what: 'Include each coin judged on its own price history alone — 4 members after stage 1, and 8 once stage 2 has added the BOOST members.',
        more: 'Each member reads a different slice of the same prices, so a coin on its own has four to read and one member for each. The count was wrong on this hover until 2026-08-28: it said 3, which was true before a fourth slice was added.',
      },
      swDoubles: {
        what: 'Include each coin judged alongside one other coin — 5 members after stage 1, and 10 once stage 2 has added the BOOST members.',
        more: 'One more than a coin on its own, and the extra member is the one that reads how the two coins move against each other — there is nothing for it to read when a coin is judged alone. It costs a great deal more than singles: every coin is paired with every other, so the number of things to train grows with the square of how many coins you name.',
      },
      swTriples: {
        what: 'Include each coin judged alongside two others — 5 members after stage 1, and 10 once stage 2 has added the BOOST members, the same as doubles.',
        more: 'The extra member reads how the coins move against each other, as with doubles; there is no sixth. What changes is the cost — every coin is grouped with every PAIR of others, which grows with the cube of how many coins you name and is far and away the most expensive box on this screen.',
      },
      swAllData: { what: 'Use every month of price history that is held, rather than a chosen range. With this ticked, start and end are ignored.' },
      swStart: { what: 'First month of price history stage 1 works over.' },
      swEnd: { what: 'Last month of price history stage 1 works over.' },
      swGeom: {
        what: 'How long a stretch of prices each decision looks at, and how often a decision is made. Weekly 8-day looks at eight days and decides once a week; Daily 1-day looks at one day and decides every day.',
      },
      swPermGeom: { what: 'Train every chunk shape rather than only the one chosen. A real multiplier of training, so it lives at stage 1 where the training happens.' },
      swLayout: {
        what: 'How the price history is divided up between learning, testing and the held-back look. 70/15/15 keeps one block back to check against. 61/13/13/13 keeps a second block back, sealed, to be looked at once at the very end.',
        more: 'Use the sealed one when you intend to search hard, because the honest end of a search is a block of data the search never touched.',
      },
      swNull1: {
        what: 'How many shuffled companions make up each unit\'s null set. Each one is the same kept votes with their dates shuffled away, given the same forecast score — no training, ever.',
        more: 'The ordering IS the against-null-set result: beat its own null set, ties broken by lead over null set. The null set always feeds the pick.',
      },
      swDesc1: { what: 'Why this stage 1 exists. Kept on the record set and shown wherever it is named.' },
      swGo1: { what: 'Starts stage 1. Progress shows at the top of this screen, and the finished set lands on Boards.' },
      swFrom2: {
        what: 'Which finished stage 1 record set stage 2 carries forward from. A stage 2 set names this parent forever.',
        more: 'The launch refuses when the price files no longer fingerprint identically to the ones the parent read — a mismatch refuses, it never mixes.',
      },
      swCarry: {
        what: 'How many rows carry forward into the BOOST training, from the top of the parent\'s table in the sort saved on it. 0 carries all of them.',
        more: 'Pick the sort on Boards — its columns save first/second/third priorities onto the record set, and the carry takes exactly that order. With nothing saved it is the fixed rule: beat its own null set, ties by lead over null set. Carry generously: the cut is for shedding the clearly-dead, not for picking winners.',
      },
      swDesc2: { what: 'Why this stage 2 exists. Kept on the record set.' },
      swGo2: { what: 'Starts stage 2 on the chosen parent. Only the BOOST members train.' },
      swFrom3: { what: 'Which finished stage 2 record set the pricing reads its kept votes from. A stage 3 set names this parent forever.' },
      swCarry3: {
        what: 'How many of the parent\'s units get priced, from the top of its table in the sort saved on it. 0 prices all of them.',
        more: 'The stage 2 table\'s columns on Boards save first/second/third sort priorities onto the record set, and a count here takes exactly that order. With nothing saved: forecast score — all members, best first, ties keeping their carry order.',
      },
      swFee: {
        what: 'What a trade is assumed to cost, as a percent of the money in the position, charged each way. It lives at this stage because stage 3 is the first place a trade is priced.',
        more: 'directional decisions also use it as their sure-enough bar — the bar is re-tuned from each member\'s kept votes at this fee, arithmetic, never a retrain.',
      },
      swNull3: {
        what: 'How many null-set deals each setting is read against, dealt from the kept votes — no training.',
        more: 'The same deals are used for every setting in the block, so any two settings\' shares are always comparable.',
      },
      swDec: { what: 'The decision to price: argmax takes whichever outcome the votes lean to most; directional acts only when the sureness clears the fee-priced bar.' },
      swPermDec: { what: 'Price both ways of deciding, each as its own setting in the block.' },
      swBand: { what: 'The size a move must reach to count as a move, for pricing the rails. auto uses the width each unit trained at, worked out from its own history.' },
      swPermBand: { what: 'Price every band on the menu as its own setting in the block.' },
      swWk: { what: 'Price this setting on weekday starts only. Weekly chunk shapes always span weekends, so for those units this reads the same either way.' },
      swPermWk: { what: 'Price it both ways — weekdays only, and every day.' },
      swEntry: {
        what: 'How the position is opened. market buys or sells at the opening price of the hour, in whichever direction was called. breakout waits until the price reaches a level set d away from where it started, and opens there.',
        more: 'market carries no gate, d, trail or arm — those four boxes disappear while it is chosen, because none of them means anything to it.',
      },
      swPermEntry: { what: 'Price every way of opening as its own setting in the block.' },
      swGate: {
        what: 'When a position is allowed to be opened at all. directional only when a direction was called; active whenever anything is happening; always every single period.',
      },
      swPermGate: { what: 'Price every gate as its own setting in the block.' },
      swD: { what: 'How far from the starting price the opening level sits, as a multiple of the band.' },
      swPermD: { what: 'Price every distance as its own setting in the block.' },
      swT: { what: 'How many hours a position is held before it is closed, if nothing else closed it first.' },
      swPermT: { what: 'Price every holding time as its own setting in the block.' },
      swTrail: { what: 'Which stop the setting uses. static sits still on the far side of the entry; the others follow the price behind you.' },
      swPermTrail: { what: 'Price every kind of stop, static included, as its own setting in the block.' },
      swArm: { what: 'How far the price must move in your favour before a following stop starts following.' },
      swPermArm: { what: 'Price every starting point as its own setting in the block.' },
      swAgreeRule: {
        what: 'How the members\' votes become one call.',
        more: 'count is how many members say the same thing. conviction is how strongly they lean, added up, so eight members barely leaning is not the same as eight certain ones. voices counts only INDEPENDENT members — members that call the same way almost every time share one vote between them. families needs different KINDS of evidence to agree, not just a number of members. unusual asks how rare this much agreement is for this particular committee, which makes one setting mean the same thing on a quarrelsome unit and a unanimous one.',
      },
      swPermAgreeRule: { what: 'Price every agree by choice as its own setting in the block.' },
      swAgreeShare: {
        what: 'How demanding the rule is, as a share of the committee.',
        more: 'Higher is stricter for every rule, so the dial never changes direction under you. A share rather than a count is what lets one number mean the same thing whether a coin\'s committee holds 8 members or 32 — and it is why no committee size appears in a setting\'s name any more.',
      },
      swPermAgreeShare: {
        what: 'Price every share as its own setting in the block.',
        more: 'Shares that land on the same rung for every unit in the run are counted once, so the block never carries two settings that would price identical trades.',
      },
      swAgreeBoth: {
        what: 'The winning side must include at least one LOGREG member and one BOOST member.',
        more: 'Without it a call can be one kind of member\'s quirk, agreed with by its own near-copies.',
      },
      swPermAgreeBoth: { what: 'Price both with and without the both kinds requirement.' },
      swAgreeHold: {
        what: 'How many decision moments in a row the same call must have stood before it is acted on. off acts at once.',
        more: 'A hold is a plain noise filter: it costs entries and keeps only the calls the committee stayed with.',
      },
      swPermAgreeHold: { what: 'Price every hold as its own setting in the block.' },
      swDesc3: { what: 'Why this stage 3 exists. Kept on the record set.' },
      swGo3: { what: 'Starts stage 3 — pricing only, no training. The tables land on Boards.' },
      swStop: { what: 'Stops the stage run that is going. Everything already written stays; the set reports itself cancelled.' },
    },
  },

  boards: {
    title: 'Boards',
    intro: 'Where the record sets are read: one section per stage, the whole provenance on screen. Picking a '
      + 'stage 3 record set fills the stage 2 and stage 1 sections with its parents; picking a stage 2 set fills '
      + 'its stage 1 parent; picking a parent puts the child selections away. Each section can be put away and '
      + 'comes back as you left it. No table mixes two stages.',
    how: [
      ['One table per stage, and the chain always visible',
        'A stage 1 set shows the ranking: every unit under the fixed rule — forecast score, beat its own null '
        + 'set, lead over null set — with no money anywhere, because stage 1 never prices a trade. A stage 2 set '
        + 'shows the carried rows: members trained, and the forecast score with the stage 1 members beside the '
        + 'score with every member, so what the BOOST members bought is visible before any pricing. A stage 3 '
        + 'set shows the pricing: the settings ranked against each other with coins in the money beside the '
        + 'averages — sortable by any one column, picked on the column and saved on the record set — and every '
        + 'coin of every setting with floors, one-click sorting on every column, avg test $ beside the held-back '
        + 'averages, and each row\'s records opening underneath — the decision, band and 24/5 variants that make '
        + 'the row up. Apply, a column sort, a records button and a page turn all hold the page still.\n\n'
        + 'A set that finished with failed units carries an INCOMPLETE banner: it does not match its own plan, '
        + 'and every table under the banner is missing those units. The held-back window appears only on stage 3 '
        + 'tables, because only stage 3 prices it.'],
    ],
    controls: {
      ...RUN_NOTES_CONTROLS,
      ...BOARD_SECTION_CONTROLS,
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
