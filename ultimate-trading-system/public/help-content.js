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
    what: 'Removes a campaign and everything underneath it — its record sets, its greenlights, and any setups made from those greenlights.',
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
// One notes box per section, so each record set on screen can be written on
// where it is shown.
const RUN_NOTES_CONTROLS = (() => {
  const out = {};
  for (const n of [1, 2, 3]) {
    out[`bName${n}`] = { what: `The stage ${n} record set's name, as it appears everywhere it is named. Yours to change.` };
    out[`bRename${n}`] = {
      what: `Gives the stage ${n} record set the name in the box.`,
      more: 'Every record set that names this one as its parent carries the new name too. A name another record set already has is refused. Only works once the record set has finished; nothing can be written to one while it is still computing, and not while a run that reads from it is going.',
    };
    out[`bNotes${n}`] = { what: `Your own notes on the stage ${n} record set — what you were trying, what it showed, what it cost.` };
    out[`bNotesSave${n}`] = {
      what: `Saves the notes onto the stage ${n} record set.`,
      more: 'Only works once that record set has finished; nothing can be written to one while it is still computing.',
    };
  }
  return out;
})();
// HELD AND RESERVE SHARE ONE SCREEN, SO THEY SHARE ONE HELP. The two tabs are
// one renderer handed the stretch, and their help is written once here with
// the stretch's own words filled in, so the two explanations cannot drift any
// more than the two screens can.
const JUDGE_HELP = (() => {
  const one = (stretch) => {
    const w = stretch === 'reserve' ? 'reserve' : 'held-back';
    const tab = stretch === 'reserve' ? 'Reserve' : 'Held';
    const kind = stretch === 'reserve' ? 'reserve set' : 'held set';
    return {
      title: tab,
      how: [
        ['One result judged here; the check on Setup',
          'Everything on this tab assumes the machinery works. The check that establishes that lives on the Setup page, under Version: the stage-engine check builds two made-up coins where the right answer is known in advance, one with a rule deliberately hidden in it that the system must find, one with nothing in it on which it must stay quiet, and runs the real three stages on them, all the way through to a verdict read the way this tab reads one. A miss on the first means the engine is blind; a hit on the second means it invents things. The marker beside "stage-engine check:" at the top of every Construct screen says whether the check stands for this release, and opens that tab.\n\nHere, one result is judged: a rule, read as a whole. A rule can be checked against scrambled data and a single row cannot, which is why the Funnel writes a rule and why nothing here judges one row.'],
        ['One screen, two windows',
          `Held and Reserve are the same screen over two different stretches of history. Held reads a rule on the held-back window, the days the search never touched while it chose. Reserve reads the same rule, the same way, on the reserve window: the stretch sealed away before anything trained, opened only after the rule stood on the held-back window. Everything on one tab is on the other; only the window differs.${stretch === 'reserve'
            ? ' A rule is listed here only when its layout keeps a reserve and its newest held set passed.'
            : ' A rule whose layout keeps no reserve is marked held alone: a held set of it that passed is the whole verdict, and Greenlight takes it as such.'}\n\nA rule is a Stage 4 record set: one cut on the Funnel, or a half-life set built on History, which is judged here as its own rule while the set it was built from keeps its own verdict.`],
        ['A press writes a set',
          `Reading a rule on the ${w} window writes a ${kind} of that rule: the rule and its survivors as they stand, the stop choices on record frozen in, and one verdict. It is named after the rule, and a second press writes a second set, numbered, never a second verdict on the first. What Greenlight takes forward is that set, so what was judged and what is frozen are one thing. A ${kind} takes no stop choice of its own: set the stop on the rule and read it again.`],
        ['The tunings applied on Tune',
          `A stop forced onto a survivor on Tune, and the conviction sizing applied to it there, are frozen into the ${kind} a press writes. The two are not treated alike, and they must not be. A stop changes WHICH trades happen and at what price, one clip a trade throughout, so a survivor read under its stop is the same size of bet as the scrambled copies it is judged against, as the four comparisons and as every other survivor: the press prices its captured trades again under the stop and every reading on the set then reads it at that money. The sizing changes HOW MUCH is bet, up to one clip for each member that agreed, so its dollars are a different quantity altogether - up to that many times the money and that many times the money at risk. Its figure is worked out, written on the set, carried by a greenlight and printed in the survivors table beside the money without it, along with the clips a trade it would deploy. It is in no average and in no comparison, because everything it would be compared with bets one clip. One currency for all of it: the record's own dollars, $100 a trade. A rule with no capture on Tune, or a reserve read on a capture that holds no reserve entries, says so on the set and reads every survivor plain; capture the trades on Tune and press again. Apply a tuning or take it off on Tune and read again: each press freezes what was on record at that moment. The capture's own plain re-pricing is held against the record's money to the cent, and a gap is said on the set.`],
        ['What the verdict reads, and what it does not',
          `The press reads what each of the rule's survivors made on the ${w} window and holds every one of them against four simpler things priced at that survivor's own hold length: buying the coin and going away, shorting it and going away, being long every period and being short every period. A survivor clears when it is in the money and ahead of all four by at least a cent, and the set passes when the bar share of its survivors clear, the same share as the bar on the scrambled copies. The average survivor and the best of the four at the worst hold length in use are printed beside that as a hindsight reading, because knowing which of the four to be on is itself a forecast, and being long every period grows with the hold length; neither of them gates. Then it reads the same settings' money on every scrambled copy and counts how many of those copies the real figure beats, against the bar the rule was cut under. Each survivor gets the same reading on its own copies, printed beside how many would pass by chance, and that never picks a survivor and never gates the set. A sanity line says whether noise loses money, as fees demand; when it does not, the readings above it cannot be trusted.\n\nIt does not price the choosing of the survivors. The walk chose its ranges on the test window over its recorded steps; pricing that search itself would need the whole walk replayed on each scrambled board, which nothing here does.`],
        ['What is priced, and what is read',
          stretch === 'reserve'
            ? 'The reserve window is priced for nothing until the reserve board of the unit is priced here: every setting of the coin and shape, its scrambled copies and the four comparisons, priced on the reserve window with the members forecasting it from the models they were trained as, and kept beside the stage 3 set so a second rule cut on the same unit reads the same board. That first pricing is the one look at data nothing in this system has seen. The press then reads the rule\'s survivors off that board and prices nothing, exactly as Held reads the stage 3 records; on a half-life set it prices them with the members retrained at each survivor\'s own half-life. The first press on a rule is the only look at data nothing in this system has seen; every later one is counted and says so. The other units and the settings the rule dropped refuse in words until they are priced on the reserve window.'
            : 'On a rule cut on the Funnel the held-back window is already priced, copies and comparisons included, and the press reads those records and prices nothing. On a half-life set the retrained forecasts have never been priced on it, so the press prices its survivors with the members retrained at each survivor\'s own half-life first, and says so on the set it writes; that pricing is a counted look, and the other units and the dropped settings cannot be read with those forecasts.'],
        ['Every look is counted',
          `Opening this tab reads no ${w} figure. The press is the stamped look. ${stretch === 'held'
            ? 'Before any stamp, the held-back number was already on a screen at every step and step back of the walk, at the cut, and wherever Boards sorts or filters on it; the record says at least how many times.'
            : 'Every reserve set already read from the rule is a look at the reserve window, and the set a press writes says which look it is.'} Every press writes a set and none is overwritten. What a pass buys is this window only; the forward paper test after freezing is the real judge.`],
        ['The three readings under the sets',
          `Three more readings sit under the sets, each taken on the rule itself and each information only, never a pass or fail. The first asks whether the same rule holds on the other coin-and-shape units of the same stage 3 set, each on its own ${w} window against its own scrambled copies, and prints two counts: how many of them are positive and how many clear the bar, with a mark when fewer than half are positive. The second reads the settings the rule did NOT keep on the same window, beside the survivors, so a count of survivors that clear a bar can be read against what did not survive. The third works out what the ${w} window looked like from inside for each survivor: the largest drawdown, the worst and best single trade, trades won, stopped out, gross per trade and money by third, beside the same numbers on the test window. Each is appended to the rule on every press, and each is a counted look.`],
      ],
      intro: `The verdict on one rule, read on the ${w} window: what its survivors made there, each against the simpler `
        + 'things a rule has to beat at its own hold length and against the same settings on scrambled copies, with '
        + `every rule declared before its number and every look counted. Each press writes a ${kind} of the rule, `
        + 'which is what Greenlight reads.',
      controls: {
        vSet: {
          what: `Which rule to read on the ${w} window, from every rule on this box, newest first, each with its coin and shape, its survivors of its target, and the newest ${kind} read from it.${stretch === 'reserve' ? ' Only a rule whose layout keeps a reserve and whose newest held set passed is offered.' : ' A rule whose layout keeps no reserve says held alone.'}`,
          more: `Choosing a rule reads its footing only: whether it still gives back its own survivors, what it was checked against, its marks, and how many looks the ${w} window has already had. No ${w} figure is read until the button is pressed.`,
        },
        vBarPct: {
          what: `The share of the scrambled copies the survivors' ${w} money has to beat, and the share of survivors that must beat all four comparisons at their own hold length, for the verdict to pass.`,
          more: 'It opens on the share the rule was cut under, which is the honest bar. A change is written onto the verdict as a guessed threshold, so a verdict read under a softer bar says so.',
        },
        vSanityPct: {
          what: `The share of the scrambled ${w} figures read that must be losing money for the copies to count as noise.`,
          more: 'A guessed threshold, written onto the verdict. On a window that paid one direction the copies are paid too, so this can fail honestly; when it fails, the readings above it are not to be read.',
        },
        vRead: {
          what: `Reads the rule on the ${w} window and writes a ${kind} of it, with the verdict stamped on that set. This is the one press that opens the ${w} window on this screen.`,
          more: `It refuses while a run, a totalling or a rebuild is going, when the rule no longer gives back its own survivors, when the rule carries anything but dials and the two limits, and on a rule cut on all units together.${stretch === 'reserve'
            ? ' It also refuses a rule whose layout keeps no reserve, whose sealed window is not intact, or whose newest held set did not pass, and a plain rule whose unit has no reserve board priced yet, naming the press that prices it; on a half-life set it prices the survivors first, which takes minutes.'
            : ' On a half-life set it prices the survivors with their retrained members first, which takes minutes.'} Every press writes a new set, numbered from the second; none is overwritten.`,
        },
        vOthers: {
          what: `Reads the same rule on every other coin-and-shape unit of the stage 3 set this was cut from, each on its own ${w} window against its own scrambled copies at the bar declared above, and prints two counts: how many are positive and how many clear the bar.`,
          more: `Information only, never a pass or fail on the set; a mark when fewer than half are positive, and a unit where the rule keeps nothing is printed as such and left out of the count. About five seconds a unit, read one at a time and appended to the rule on every press. It refuses while a run, a totalling, a rebuild, the Funnel's own read of the other units or another read on this tab is going${stretch === 'reserve' ? ', and until the other units are priced on the reserve window' : ''}. A verdict stamped after a reading carries its counts.`,
        },
        vDropped: {
          what: `Reads the settings the rule did NOT keep on the same ${w} window as the survivors, and prints both sides side by side: how many there are, how many made money, how many beat the best of the four comparisons, and the average and middle figure of each.`,
          more: `A count of survivors that clear a bar cannot be read without it. If nearly every setting on the board was positive on this window, then all the survivors being positive says the window rose and says nothing about the picking. Each side is read against the four at its OWN hold lengths, because a setting the rule dropped may hold for a length no survivor uses. Nothing is priced: every figure is already on the board, so it answers at once. It is still a read of the ${w} window, so it is a counted look, and it is information only, never a pass or fail on the set. Appended on every press, never replaced.${stretch === 'reserve' ? ' It refuses until the settings the rule dropped are priced on the reserve window.' : ''}`,
        },
        vDroppedN: {
          what: 'How many of the settings the rule dropped to read. Blank or 0 reads all of them, and the count beside the box says how many that is.',
          more: 'Fewer than all are taken with an even stride through the board\'s own order. Never the first N, which would read one region of the board, and never the top N by any figure, which would be the very shopping this reading exists to detect.',
        },
        vBoard: {
          what: `Prices the reserve board of this rule's coin and shape: every setting of the unit on the reserve window, its scrambled copies and the four comparisons at each hold length, with the members forecasting it from the models they were trained as, kept beside the stage 3 set.`,
          more: 'Minutes for one unit. The first pricing is the one look at data nothing in this system has seen, counted on the unit and said on every reserve set read from it; a later pricing reprices the window as the box\'s data stands today and is stamped on the board as a further pricing. It refuses while any other heavy job is going, on a rule whose newest held set did not pass, and on a half-life set, which prices its own survivors.',
        },
        vBoardOthers: {
          what: 'Prices the reserve board of every other coin and shape of the stage 3 set not yet priced, one at a time, each kept beside the set as it lands.',
          more: 'Minutes a unit and hours for a set of hundreds; units already priced are skipped, so a stopped or interrupted run carries on from where it was. The read of the rule on the other units reads whatever is priced and names the units that are not.',
        },
        vBoardStop: {
          what: 'Lets the unit being priced land and prices no further unit.',
          more: 'What has landed is kept beside the stage 3 set; the next press carries on from there.',
        },
        vRide: {
          what: `Works out what the ${w} window looked like from inside for each survivor: the largest drawdown, the worst and best single trade, trades won, stopped out, gross per trade and money by third, beside the same numbers on the test window.`,
          more: `The same pass as the missing numbers on the Funnel, on this unit only; minutes. Written onto the rule with the release that computed it, appended on every press, and counted as a stamped look at the ${w} window on every later verdict. Never a gate. It refuses while any other heavy job is going and on a rule cut on all units together.`,
        },
      },
    };
  };
  return { held: one('held'), reserve: one('reserve') };
})();
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
      swUni: { what: 'The coins this run buys and sells. Leave it blank to use all of the ones held; write them separated by commas to narrow it down.' },
      swPassers: {
        what: 'Run only the coins and shapes ticked on Coins, in its table of coins and shapes that pass. Each pair is a unit at its own chunk shape, so five pairs across four shapes is one launch of five units.',
        more: 'With it on, trade coins, chunk shape and permute are greyed: the pairs replace all three. Compare coins still applies to doubles and triples. The pairs are read off Coins at the moment of the launch and written on the set, so the set says what ran even if Coins changes later. With nothing ticked on Coins the launch refuses and says so.',
      },
      swCompare: {
        what: 'The coins each traded coin is READ AGAINST. They are context only \u2014 never bought, never sold. Left blank they are every coin downloaded on this box, the same as the box beside it, so one coin in trade coins and nothing here is that coin against everything.',
        more: 'Only doubles and triples read it. A single is a coin on its own price history alone, so with only singles ticked this box is greyed and nothing anywhere reads what is in it. It exists so one coin can be read against a whole field: with one list, asking for triples on a single coin gave nothing at all, because a triple reads a coin against two OTHERS and a list of one holds no others. A coin appearing in both lists is never read against itself. Doubles need one other coin, triples need two.',
      },
      swSingles: {
        what: 'Include each coin judged on its own price history alone — 4 members after stage 1, and 8 once stage 2 has added the BOOST members.',
        more: 'Each member reads a different slice of the same prices, so a coin on its own has four slices to read and one member for each. Stage 2 adds a second member per slice, which is what doubles the count.',
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
      swByMoney: {
        what: 'Weighs each training trade by the money its decision was worth, instead of counting every trade the same. One chunk of history is one decision and one trade: a week on the weekly shape, a day on the daily ones.',
        more: 'Off - which is how every record set before this one was trained - a trade where the price moved 0.6% and one where it moved 14% are one lesson each, because the label only says up, flat or down and throws the size away. A forecast that is right nine times on crumbs and wrong once on a landslide therefore trains as a good forecast and loses money. On, a trade is weighed by the gap between the best its decision could have done and the worst: on a trade that moved, about twice the move, because the fees are paid whichever way you call it; on one that barely moved, the round trip, because staying out earns nothing and taking it the wrong way wastes the fees. So a trade too small to cover its fees is never weightless - it is exactly what teaches the forecast when to stay out - and no floor had to be invented, the arithmetic of the trade sets it. The weights are read off the training trades only, never the test or the held-back window, and are scaled so the average trade counts 1, which leaves the strength of the fit meaning what it meant. This carries to stage 2 with the rest of the settings, so both halves of a committee are trained the same way.',
      },
      swCap1: {
        what: 'How many ordinary trades the biggest trade may count for. 0 turns the limit off. What it did on each unit is the column called biggest before the ceiling on Boards, stage 1 table: the biggest trade\u2019s count before this box held it down, and after the slash how many trades were held at it.',
        more: 'One freak trade can otherwise outweigh fifty ordinary ones, and a fit to one trade is not a fit. Measured on a realistic run of two hundred trades the biggest counts about four ordinary ones and this limit never bites; it is insurance against a genuine outlier, such as the week the market fell by half. It only does anything when weigh each trade by the money it was worth is ticked.',
      },
      swNull1: {
        what: 'How many shuffled companions make up each unit\'s null set. Each one is the same kept votes with their dates shuffled away, given the same forecast score — no training, ever.',
        more: 'The ordering IS the against-null-set result: beat its own null set, ties broken by lead over null set. The null set always feeds the pick. '
          + 'The same null set is dealt again at stage 2, for every member, and both stages read their tuning-slice $ against it too.',
      },
      swFee1: {
        what: 'The cost of one side of a trade, as a share of the position — the same box stage 3 has. Here it prices only the tuning-slice $ on Boards: each unit\'s own votes on the last quarter of its training window, one buy or sell per chunk in the direction they lean.',
        more: 'Nothing else at stage 1 costs anything; no trade shape and no decision exist here. Stage 2 inherits this fee, reads the stage 1 members\' tuning-slice $ again and refuses a unit whose figure differs from the parent\'s by a cent.',
      },
      swName1: {
        what: 'What this stage 1 record set is called everywhere it is named — on Boards, in every picker, on the status line. Yours to choose.',
        more: 'Left empty, it takes the next free number, which is what the box shows greyed. A name another record set already has is refused, so no two sets can share one; rename the other on Boards first.',
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
      swName2: {
        what: 'What this stage 2 record set is called everywhere it is named — on Boards, in every picker, on the status line. Yours to choose.',
        more: 'Left empty, it takes the next free number, which is what the box shows greyed. A name another record set already has is refused, so no two sets can share one; rename the other on Boards first.',
      },
      swDesc2: { what: 'Why this stage 2 exists. Kept on the record set.' },
      swGo2: { what: 'Starts stage 2 on the chosen parent. Only the BOOST members train.' },
      swFrom3: {
        what: 'Which finished stage 2 record set the pricing reads its kept votes from. A stage 3 set names this parent forever. A paused stage 3 run is offered here too, and Start stage 3 then starts it again where it stopped.',
        more: 'A paused run keeps every record it had already priced and the state it held in memory when it was paused, so starting it again prices only what is left. While a paused run is chosen the boxes below are ghosted: it keeps the settings it was launched with, and none of them can be changed here. A run that was interrupted by a service restart, or that failed, is offered the same way when it kept that state.',
      },
      swPick3: {
        what: 'Which of the parent\'s records get priced. N records: the carry forward box beside it decides — 0 for all, N for the top of the parent\'s table. Selected records: exactly the records ticked on the parent\'s stage 2 table on Boards.',
        more: 'The ticks on the stage 2 table save on that record set, so what is picked survives a page flip and a restart, and the count of picked records is shown beside this when Selected records is chosen. A launch with Selected records and nothing ticked refuses rather than pricing nothing or everything. The stage 3 set records the exact list it priced, so a rebuild or a relaunch prices those same records whatever is ticked later.',
      },
      swCarry3: {
        what: 'How many of the parent\'s units get priced, from the top of its table in the sort saved on it. 0 prices all of them. Applies when records to price says N records.',
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
      swKeep3: {
        what: 'How many of those null-set deals have their money written down, rather than only being counted. '
          + 'Keeping some builds a whole second copy of Table 3.A and Table 3.B out of scrambled money alone, which is the '
          + 'only thing the Funnel can measure a real result against. 0 keeps none, which is how every run before '
          + 'this one worked.',
        more: 'It costs one extra pricing per setting per coin for each one kept, so 10 makes the run about 10% '
          + 'longer. It cannot ask for more deals than the null set has, and it refuses rather than quietly '
          + 'keeping fewer. Two figures are stored for each one: the money on the test window, which is what the '
          + 'Funnel reads, and the money on the held-back window, which is free because working out beat its own '
          + 'null set prices it anyway. Both are rounded to the cent.',
      },
      swTrained3: {
        what: 'Fills the boxes below with the conditions the units were actually trained and scored under in stages 1 and 2, so what those stages did can be priced here as one setting and read on the same table as everything else. Nothing is started: press Start stage 3 yourself.',
        more: 'It sets quorum by to trained, entry to market, t to the chunk\u2019s own, band % (or auto) to auto, decision to argmax, 24/5 off and every permute off. Two of those are not fixed numbers: the chunk\u2019s own means each unit is held for exactly as long as its own chunk shape is held in stages 1 and 2 \u2014 60 hours on a weekly 8-day chunk, 17 on a daily 1-day or 2-day, 41 on a daily 3-day or 4-day \u2014 and auto means each unit is priced at the width its own stage 1 worked out. So this is ONE setting that is nevertheless right on every unit, however many chunk shapes the records carry, and both values are read off what stage 1 already stored rather than worked out again.',
      },
      swT: {
        what: 'How long a position is held before it is closed on time. The hours on the list are the same on every unit; the chunk\u2019s own is not a number \u2014 it holds each unit for exactly as long as its own chunk shape is held when stages 1 and 2 score it.',
        more: 'A weekly 8-day chunk is held 60 hours, a daily 1-day or 2-day 17, a daily 3-day or 4-day 41. Those three are on the hours list as well, so you can ask for one of them flat across every unit; the chunk\u2019s own asks for whichever of them belongs to the unit being priced. On a run whose records all share one chunk shape the two come to the same thing, and a setting asking for each is priced once, not twice.',
      },
      swDec: { what: 'The decision to price: argmax takes whichever outcome the votes lean to most; directional acts only when the sureness clears the fee-priced bar.' },
      swPermDec: { what: 'Price both ways of deciding, each as its own setting in the block.' },
      swBand: { what: 'The size a move must reach to count as a move, for pricing the rails. auto uses the width each unit trained at, worked out from its own history.' },
      swPermBand: { what: 'Price every band on the menu as its own setting in the block.' },
      swWk: {
        what: 'Price this setting on weekday starts only. Weekly chunk shapes always span weekends, so on those units the two values place the same orders and only one is priced. Ghosted while '
          + 'no unit being priced has a weekday version of its chunk shape: nothing in the block reads it then.',
      },
      swPermWk: { what: 'Price it both ways — weekdays only, and every day. Ghosted with the 24/5 box whenever nothing in the block can read it.' },
      swEntry: {
        what: 'How the position is opened. market buys or sells at the opening price of the hour, in whichever direction was called. breakout waits until the price reaches a level set d away from where it started, and opens there.',
        more: 'market carries no gate, d, trail or arm — those four boxes disappear while it is chosen, because none of them means anything to it.',
      },
      swPermEntry: { what: 'Price every way of opening as its own setting in the block.' },
      swGate: {
        what: 'When a position is allowed to be opened at all. directional only when a direction was called; active whenever anything is happening.',
      },
      swPermGate: { what: 'Price every gate as its own setting in the block.' },
      swD: { what: 'How far from the starting price the opening level sits, as a multiple of the band.' },
      swPermD: { what: 'Price every distance as its own setting in the block.' },
      swT: { what: 'How many hours a position is held before it is closed, if nothing else closed it first.' },
      swPermT: { what: 'Price every holding time as its own setting in the block.' },
      swTrail: { what: 'Which stop the setting uses. static sits still on the far side of the entry; the others follow the price behind you.' },
      swPermTrail: { what: 'Price every kind of stop, static included, as its own setting in the block.' },
      swArm: {
        what: 'How far the price must move in your favour before a following stop starts following. Ghosted while '
          + 'trail is static and trail is not being permuted: no setting in the block has a following stop then, so nothing reads it.',
      },
      swPermArm: { what: 'Price every starting point as its own setting in the block. Ghosted with the arm box whenever nothing in the block can read it.' },
      swAgreeRule: {
        what: 'WHAT IS WEIGHED when the members are polled. Half of the quorum; quorum bar is the other half.',
        more: 'Every coin is judged by 8 members, each reading a different slice of the numbers, worked out two '
          + 'different ways. This box says what is measured when they are polled.\n\n'
          + 'count is the plain head count: how many say the same thing. It is the honest baseline, and its one '
          + 'permanent weakness is that it cannot tell independent opinions from near-copies.\n\n'
          + 'conviction is how hard they lean, added up. Six members that are certain and six that barely lean are '
          + 'the same to count and very different here. This is the only choice that reads how sure they are '
          + 'rather than how many they are.\n\n'
          + 'voices is a head count in which members that almost always call the same way as each other share one '
          + 'vote between them, so a crowd of near-copies cannot outvote a genuine disagreement. On a committee '
          + 'whose members all differ it gives the same answer as count.\n\n'
          + 'families is how many different KINDS of evidence agree. The 8 members read four slices of the '
          + 'numbers between them; two members reading the same slice agreeing is weaker evidence than one price '
          + 'reader and one volume reader agreeing, and this is the only choice that can say so. Its bar is '
          + 'coarse by nature — with four kinds there are only four steps.',
      },
      swPermAgreeRule: { what: 'Price every quorum by choice as its own setting in the block.' },
      swAgreeBar: {
        what: 'WHAT THE BAR IS A SHARE OF. The other half of the quorum.',
        more: 'all of them sets the bar as a share of what EXISTS. 75% of 8 members is 6 of them, worked out from '
          + 'the committee\'s size and nothing else. Simple, and it never moves.\n\n'
          + 'its own history sets the bar as a share of what this committee ACTUALLY REACHES. Every moment in the '
          + 'test window is sorted by how much agreement it drew, and 75% admits only the strongest quarter of '
          + 'them.\n\n'
          + 'Why the second one exists. A bar set as a share of what exists only makes sense when the thing being '
          + 'weighed reaches its maximum in practice. A head count does — eight of eight happens. A sum of how '
          + 'hard eight members lean does not: on a noisy market the leans are small, so a bar of 6 out of a '
          + 'possible 8 cannot be cleared however good the setting is. The own history bar cures that for every '
          + 'way of weighing at once, because the bar comes from what the numbers actually do.\n\n'
          + 'It is read from the test window only. The held-back window is never used for it. Note though that '
          + 'the test window is also the window the ordering was done on, so the bar is chosen knowing the window '
          + 'it will be scored on — a mild flattery, and the reason a held-back number always matters more.\n\n'
          + 'Because the same share means two different things under the two bars, own is written into the name '
          + 'of every setting that uses it and shown beside the rule on the ranked table.',
      },
      swPermAgreeBar: {
        what: 'Price both bars as their own settings in the block.',
        more: 'It roughly doubles the block. Against all of them, shares landing on the same bar are counted '
          + 'once; against its own history every share stands, because the bar is worked out per coin.',
      },
      swAgreeCopy: {
        what: 'How alike two members have to be to count as ONE voice. Only voices reads it. Ghosted unless quorum by is voices or quorum by is being permuted.',
        more: 'Two members that make the same call at least this often across the test window share a single vote '
          + 'between them, so a crowd of near-copies cannot outvote a real disagreement.\n\n'
          + 'Lower is harsher on copies. At 80% two members that agree four times in five are already one voice and '
          + 'the committee shrinks a lot. At 100% only members that never once differ are folded, which almost never '
          + 'happens — so at 100% voices gives the same answer as count, every time.\n\n'
          + 'This was a fixed number in the code until now, and it was set so high that the rule could barely ever '
          + 'fold anything: on a committee whose members all differ somewhere, voices IS count. Being able to move it '
          + 'is what makes the choice worth having.\n\n'
          + 'It rides in the name of every voices setting, because it changes which calls get made. The other three '
          + 'ways of weighing cannot read it, so the block is never multiplied by it for them.',
      },
      swPermAgreeCopy: {
        what: 'Price every one voice at choice as its own setting in the block. Ghosted with the one voice at box whenever nothing in the block can read it.',
        more: 'It only multiplies the part of the block that uses voices. The other three ways of weighing are '
          + 'priced once, because the threshold cannot change anything they do.',
      },
      swAgreeShare: {
        what: 'HOW MUCH IS ENOUGH. Higher is stricter whichever bar is picked.',
        more: 'The dial never changes direction under you: a bigger number always demands more. What it is a '
          + 'share OF is quorum bar\'s business. With all of them it is a share of the committee — 75% of 8 '
          + 'members is 6. With its own history it is a share of that committee\'s own moments — 75% admits the '
          + 'strongest quarter of them.\n\n'
          + 'A share rather than a count is what lets one number mean the same thing whether a coin\'s committee '
          + 'holds 8 members or 32, and it is why no committee size appears in a setting\'s name.',
      },
      swPermAgreeShare: {
        what: 'Price every share as its own setting in the block.',
        more: 'Shares that land on the same bar for every unit in the run are counted once, so the block never '
          + 'carries two settings that would price identical trades. That folding only applies against all of '
          + 'them; against its own history the bar is worked out per coin, so no share can be ruled out up front.',
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
      swConfirm: {
        what: 'What the coin\u2019s own lean changes about the trades, on a unit whose coin and chunk shape pass on Coins. off changes nothing: every trade at size 1, exactly as before this box existed. confirmed only drops every call the lean disagrees with. sized trades a call the lean agrees with at confirmed \u00d7 the size and one it disagrees with at unconfirmed \u00d7 the size.',
        more: 'The lean is read the way Coins reads it: at the unit\u2019s own sweet spot band, each window is rising, falling or inside the band, and the coin\u2019s history says which way a trade should go after rising and after falling. A call made when the window sat inside the band has no lean and trades at size 1 under every value. A trade at twice the size is exactly twice the money, fees included, so the six numbers behind each row \u2014 money and count of the confirmed, the unconfirmed and the no-lean trades \u2014 say whether the lean adds anything: Boards prints a verdict word beside every setting and every coin. On a unit whose coin and chunk shape do not pass, the three values place the same trades and are priced once. Greyed while no unit being priced passes.',
      },
      swPermConfirm: { what: 'Price all three values of confirm, each as its own setting, so off, confirmed only and sized sit side by side on Boards. Only a unit that passes on Coins prices the three apart.' },
      swConfirmedX: { what: 'The size of a trade the coin\u2019s own lean agrees with, as a multiple of the plain size. Read by sized only. 2 doubles it, 0 drops it.' },
      swUnconfirmedX: { what: 'The size of a trade the coin\u2019s own lean disagrees with, as a multiple of the plain size. Read by sized only. 1 leaves it as it was; 0 drops it, which is what confirmed only does.' },
      swName3: {
        what: 'What this stage 3 record set is called everywhere it is named — on Boards, in every picker, on the status line. Yours to choose.',
        more: 'Left empty, it takes the next free number, which is what the box shows greyed. A name another record set already has is refused, so no two sets can share one; rename the other on Boards first.',
      },
      swDesc3: { what: 'Why this stage 3 exists. Kept on the record set.' },
      swGo3: { what: 'Starts stage 3 — pricing only, no training. The tables land on Boards. With a paused run chosen in the box above, starts that run again where it stopped.' },
      swDelete3: {
        what: 'Deletes the paused stage 3 run chosen in from stage 2 record set, after asking you to type its record set id back. Everything it had priced goes with it.',
        more: 'Live only while a paused run is chosen in that box, because that is all it acts on. A finished record set is deleted on Boards, with the same two steps. A run another record set names as its parent is refused, and nothing is deleted while a stage run is going.',
      },
      swStop: { what: 'Pauses a stage 3 run, or stops a stage 1 or 2 run. Everything already written stays. A paused stage 3 run keeps the state it held in memory as well, and is offered in the stage 3 section\'s box to be started again; a stopped stage 1 or 2 run reports itself cancelled and cannot be.' },

    },
  },

  boards: {
    title: 'Boards',
    intro: 'Where the record sets are read: one section per stage, the whole provenance on screen. Picking a '
      + 'stage 3 record set fills the stage 2 and stage 1 sections with its parents; picking a stage 2 set fills '
      + 'its stage 1 parent; picking a parent puts the child selections away. Each box offers only the record sets '
      + 'that came out of what is picked above it. Each section can be put away and comes back as you left it. No '
      + 'table mixes two stages.',
    how: [
      ['One table per stage, and the chain always visible',
        'A stage 1 set shows the ranking: every unit under the fixed rule — forecast score, beat its own null '
        + 'set, lead over null set — beside the tuning-slice $, the members\' own votes priced on the last quarter '
        + 'of the training window, the only money read before stage 3, sortable so the carry can follow it. A stage 2 set '
        + 'shows the carried rows: members trained, and the forecast score with the stage 1 members beside the '
        + 'score with every member, so what the BOOST members bought is visible before any pricing. A stage 3 '
        + 'set shows the pricing: the settings ranked against each other with coins in the money beside the '
        + 'averages — sortable by any one column, picked on the column and saved on the record set — and every '
        + 'coin of every setting with floors, one-click sorting on every column, avg test $ beside the held-back '
        + 'averages, and each row\'s records opening underneath — the decision, band and 24/5 variants that make '
        + 'the row up. A column sort, a records button and a page turn all hold the page still.\n\n'
        + 'Both stage 3 tables print four numbers beside every filter that takes one: the minimum, the median, '
        + 'the average and the maximum that column holds. They describe the rows the table is showing at that '
        + 'moment, after every filter already in force, so a floor is set by reading rather than by guessing and '
        + 'asking again; they move as you filter. A filter that takes words rather than a number leaves its four '
        + 'cells empty. Every table that runs past one page also lets the page be typed: the box between rows '
        + 'and Prev holds the page showing, and a number past the end goes to the last page.\n\n'
        + 'Two columns describe the agreement, and they are different numbers. share is what the setting was '
        + 'built to demand, and rung it landed on is what that share worked out to for these coins — six of '
        + 'eight, say. share that agreed is what the members actually did at the moments the setting spoke. A '
        + 'setting fires at or above its bar, never only on it, so this sits at the share or above it: at the '
        + 'share means it only ever scraped in, 100% means every member lined up every time. It is measured on '
        + 'the test window and the held-back window is never read for it. Open the records under a coin row and '
        + 'each one shows its own, with the least and the most it ever reached beside the average and how many '
        + 'calls that rests on. A record priced before this was measured shows a dash rather than a nought.\n\n'
        + 'A set that finished with failed units carries an INCOMPLETE banner: it does not match its own plan, '
        + 'and every table under the banner is missing those units. The held-back window appears only on stage 3 '
        + 'tables, because only stage 3 prices it.'],
    ],
    controls: {
      bHeldBack: {
        what: 'Shows the held-back window on the stage 3 tables: the held-back columns of Table 3.A and Table 3.B and of the records under a row. Off every time this tab is opened. Ticking it on is written on this record set as one dated look, which Held counts the way it counts a scan on Tune.',
        more: 'Off, a sort saved on a held-back column is set aside and the table reads in its own order, and a floor on a held-back column is not applied \u2014 a table ordered or cut by hidden held-back money would still be a look. The held-back window is priced at stage 3 and kept for Held; nothing on the Funnel reads it, and the trade floor on the Funnel\u2019s step 6 reads test trades.',
      },
      bPin3b: {
        what: 'Shows, in Table 3.B below, only the coins this setting was priced on — and picks this exact setting out of them.',
        more: 'It takes every other filter on Table 3.B off first, so none of the setting\'s coins can be hidden by '
          + 'something set earlier, and it brings that table onto the screen.\n\n'
          + 'The button you pressed stays bold until you press another one or press Revert filters.\n\n'
          + 'Each of those coins opens its records straight away, and one record in each is highlighted: the eight '
          + 'records under a coin are the decision, band and 24/5 variants of the setting, and the highlighted one is '
          + 'the row of Table 3.A you actually pressed. So the averages above and the one setting you asked about are '
          + 'both in front of you.\n\n'
          + 'Every coin opens its own records separately, so a setting priced on many coins takes a moment.',
      },
      bFillUnits: {
        what: 'Re-runs exactly the units a stage 1 run lost, and marks the record set finished when it matches its plan again. Only the absent ones are trained \u2014 eighteen units out of ten thousand costs minutes, not another whole run.',
        more: 'It uses the record set\u2019s OWN saved choices, never the boxes on Sweep. A unit trained on a different window would sit in the same table, be ranked against the rest and be carried forward beside them, with nothing able to tell them apart \u2014 so the window, the fee, the null set size and how the units were trained all come off the set itself. Three things would make a new unit incomparable and each refuses by name before anything runs: a different measurement block, a different first digit of the release, and price files that have changed since the set was written. Nothing already in the set is read, touched or trained again.',
      },
      bDropUndeclared: {
        what: 'Deletes the settings this record set holds that its own block does not declare, and renumbers what is left.',
        more: 'A setting entered at market opens at the candle\'s open with no price levels, so the band cannot change one '
          + 'cent of what it does. Four settings that differ only by their band are therefore four copies of one trade, '
          + 'and the enumerator keeps one of them.\n\n'
          + 'A set priced before the enumerator worked that out holds all four. This deletes the copies.\n\n'
          + 'IT DELETES PRICED RECORDS AND CANNOT BE UNDONE without running the whole set again. The one way it could delete '
          + 'the wrong thing is a refusal instead: a record is filed under its setting\'s '
          + 'position in the set\'s list of names, so every record is checked against that list before anything is '
          + 'written, and any disagreement stops it.\n\n'
          + 'What is kept is written BESIDE the old records, counted, and checked for gaps in the numbering before '
          + 'anything is replaced — so an interruption leaves the set exactly as it was. The tables are worked out again '
          + 'afterwards.',
      },
      bKeptN: {
        what: 'How many of this record set\'s null-set deals should have their money written down, so the Funnel '
          + 'has a whole second copy of Table 3.A and Table 3.B made of scrambled money alone to measure a real result against.',
        more: 'It cannot ask for more than the set was swept with — the deals it writes down have to be deals it '
          + 'actually made. The line beside it says how many the set keeps today and how many pricings the chosen '
          + 'number costs, before the button is pressed.',
      },
      bKeptGo: {
        what: 'Fills in the kept null money on a set that was priced before the column existed. It re-prices only '
          + 'what is missing, never the whole run.',
        more: 'This works at all because the deals are worked out from a hash of the record set\'s name, so deal '
          + 'seven is the same deal seven it always was and pricing it again reproduces exactly what the run would '
          + 'have written.\n\n'
          + 'It re-prices the real test money alongside, as a proof: a disagreement of more than a cent means the '
          + 'price files moved or the engine did, and it stops rather than writing numbers from one world beside '
          + 'numbers from another. Nothing is replaced until every row is written: the records are built BESIDE the '
          + 'old ones, checked for the same row count and the same block boundaries, and only then swapped. The '
          + 'tables are worked out again afterwards.\n\n'
          + 'It runs for hours on a large set, so pressing it takes you straight to the Sweep section, whose '
          + 'status line at the top is where this reports — not the line beside the button, which stops moving '
          + 'the moment the fill starts. The box refuses while anything else heavy is running, because it reads '
          + 'the same units they do.',
      },
      bCheckSet: {
        what: 'Reads every record in this set and says whether it is sound. It adds nothing and changes nothing.',
        more: 'Each line is a plain statement about the records that is either true or it is not, and a false one says '
          + 'how many and shows three examples.\n\n'
          + 'The load-bearing one is "every name is the one today\'s code would write". It rebuilds each setting\'s name '
          + 'from the fields on the record itself, through the same writers a launch writes with — so a name today would '
          + 'not write fails, whoever wrote it and whenever. Nothing here consults which passes have been run; the '
          + 'records answer for themselves.\n\n'
          + 'The last line needs the set\'s own block and costs a few seconds more: it says whether the set holds exactly '
          + 'what a launch with these same choices would price, no more and no less. Anything it holds and the block does '
          + 'not is a duplicate or a leftover; anything the block declares and it does not is a gap.\n\n'
          + 'Run it before and after anything that touches the records. Two sound readings either side of a change is the '
          + 'only evidence worth having.',
      },
      bUndoAppend: {
        what: 'Puts this record set back to how it was before a fill-in that did not finish. It deletes the records that run wrote.',
        more: 'Filling in the missing settings writes its rows one unit at a time, and writes the set’s list of setting names '
          + 'once, at the very end. A run that is stopped, or that dies, therefore leaves records sitting at positions the '
          + 'list does not reach, and nothing is written down anywhere to say so.\n\n'
          + 'They are found without any note having been kept: a whole set holds exactly one record per setting per unit, so '
          + 'a count that is not settings × units says a run is unfinished. That check costs nothing, so the screen makes it '
          + 'every time it draws.\n\n'
          + 'Those records cover some of this set’s coins and not others. Left in place they would be averaged over the coins '
          + 'that landed and read on every table like an ordinary row, while resting on fewer — which is worse than a row '
          + 'that is plainly absent. So the choice offered is to put the set back, and fill in again, which prices the whole '
          + 'thing once.\n\n'
          + 'What is kept is written BESIDE the old records and counted before anything is replaced, so an interruption '
          + 'leaves the set exactly as it was. Nothing else on this screen will run while this stands.',
      },
      bStopFill: {
        what: 'Asks a running fill-in to stop when the unit it is on finishes.',
        more: 'It is asked, not forced: a unit is either whole or it is not, so the run stops between them and never tears '
          + 'one in half.\n\n'
          + 'A stopped run is not a finished one. The set’s list of setting names is deliberately NOT written, because the '
          + 'units that landed do not cover every coin — so the set is left exactly as an interrupted run leaves it, and the '
          + 'line above offers to put it back.',
      },
      bFillIn: {
        what: 'Prices the settings this record set\'s own block declares and its records do not hold, and adds them to it.',
        more: 'A set can be priced before its block is whole. This one ran when the quorum was five named choices; it is '
          + 'two dials now, and four ways of weighing against two bars is eight ways of asking where five were priced. '
          + 'Nothing on this screen can answer for the other three, and no filter or column can invent them.\n\n'
          + 'What is missing is worked out by the SAME enumerator a launch runs, so the count offered and the count '
          + 'priced are one number. Nothing already priced is read for it, touched, or priced again — the new rows are '
          + 'appended and take setting numbers after everything on disk.\n\n'
          + 'It refuses if the finished tables would not fit in memory, and says by how much, before anything runs.\n\n'
          + 'A set that has been added to says so, with the release each addition ran under. It is no longer one run '
          + 'under one engine and that is worth knowing rather than inferring — the money is comparable because the '
          + 'pricing is the same code on the same votes, but the set\'s own stamp names only the first release.\n\n'
          + 'When it lands the tables are worked out again from all the records, old and new together.',
      },
      ...RUN_NOTES_CONTROLS,
      ...BOARD_SECTION_CONTROLS,
    },
  },

  funnel: {
    title: 'Funnel',
    how: [
      ['Finding a rule instead of picking a row',
        'A stage 3 sweep prices every setting you asked for against every coin. That is often half a million rows, and the only thing anyone can do with half a million rows by hand is sort them and take the top one.\n\nThat is the worst possible move. The best of half a million tries looks good even when there is nothing there at all - that is simply what maximums do. So this screen never asks you to pick a row. It walks a fixed set of steps that ask, in order: which of the dials actually changes the result, what shape that change has, whether two dials matter together, whether the answer holds up somewhere else, whether the good settings have good neighbours or stand alone, and how ugly the ride was.\n\nWhat comes out is a RULE - a description like "t between 65 and 113 hours, gate active, drawdown under 400" - and the settings that match it. A rule is worth having because the same rule can be run against scrambled data to see whether it finds anything there too. A single row cannot be checked that way, which is why picking one is a dead end.'],
      ['Why every number here is test money',
        'A sweep splits its history into three parts: one to learn from, one to try things on, and one that is held back and never looked at.\n\nThe held-back part is the only honest judge you get, and it stops being honest the moment you use it to CHOOSE. If you sort half a million rows by held-back money and take the best, you have fitted to it just as surely as if you had trained on it.\n\nSo every figure on this screen comes from the try-things-on part. The held-back part is opened once, at the very end, on the handful that survive - and then it still means something.'],
    ],
    intro: 'Turns a stage 3 board of hundreds of thousands of priced settings into a small set worth investigating, '
      + 'by walking a fixed sequence of readings rather than letting you sort a table and pick the winner. '
      + 'Every figure shown is test-window money; the held-back window is opened once, at the end, on what survives. '
      + 'What it writes is the RULE you arrived at, because a rule can be checked against scrambled data and a single row cannot.',
    controls: {
      fUnit: {
        what: 'The traded coin this walk is on, or "all units together" for the blend. One rule per coin and shape - ten of them, ten rules.',
        more: 'A unit\'s board is its own records: one row per setting it holds (a unit holds only the settings that place different orders on it), every dial on it, its own test money and its own scrambled copies. The units are listed in the order of the parent\'s stage 2 table on Boards - its saved sort - and the walk opens on the first of them. Each unit keeps its own walk, so you can leave one half-done and come back. "all units together" is the blended table, one row per setting averaged over the units that hold it; it hides what any one coin does and is kept only so the choice is yours.',
      },
      fUnitA1: {
        what: 'The first coin the traded coin is read against. "- none -" is the coin judged on its own.',
        more: 'Context only: it is read against, never bought or sold. Only the coins this set actually holds beside the chosen coin are offered, so no combination of these four boxes can land on a board that was never priced.',
      },
      fUnitA2: {
        what: 'The second coin the traded coin is read against. "- none -" is the coin read against one other, or on its own.',
        more: 'Context only, the same as the first. It is offered only where the set holds a third coin beside the two already chosen.',
      },
      fUnitGeom: {
        what: 'How long a stretch of prices each decision looks at, and how often a decision is made.',
        more: 'Fixed when the unit was trained, so this box offers only the shapes the set holds for the coins chosen to its left. Change a box on the left and anything on the right that no longer exists is dropped for the nearest board that does.',
      },
      fCutPick: {
        what: 'Which Stage 4 record set to look at, of the ones already cut from this coin and shape. Choose "new rule" to start the steps again and cut another - it always gives you a new rule, at step 1 with nothing on it.',
        more: 'Changing the coin, either alongside box or the chunk shape puts this box back on "new rule" and shows the steps for the board you just chose - never a record set somebody cut from it earlier. That board\'s own walk is where you left it, because there is one rule per coin and shape; only which of the two things is shown changes. "new rule" means what it says: step 1, an empty rule, whatever was on the walk before. If that clears a walk you had part way through, you are asked first and told which step it was on; a walk whose rule has already been cut to a set is finished and goes without a question. A coin and shape with nothing cut from it opens on step 1, the way it always has. Once one or more have been cut from it, it opens on the newest instead: the heading becomes the record of that set - its rule, its target size, the bar it was read under, whether its window was sealed, and how the walk went - and the settings it kept are listed below it, one row each, sortable by any column. Nothing on that screen changes anything except the name. Only the sets cut from THIS coin and shape are offered; another has its own.',
      },
      fCutName: {
        what: 'The name of the Stage 4 record set showing. Type a new one and press Rename.',
        more: 'Eighty characters at most, and no two record sets may share a name. The name is what every list and heading shows, so changing it here changes it everywhere.',
      },
      fCutDelete: {
        what: 'Permanently deletes the Stage 4 record set chosen beside it, and nothing else. It asks for the record set id typed back first.',
        more: 'It is here because this is the only screen a Stage 4 record set appears on, and because without it whole chains could not be cleared: a record set that another set was cut from refuses to be deleted while that set is still here, so one Stage 4 set left behind made its stage 3 parent undeletable, and the stage 2 and stage 1 sets above that with it. Deleting the Stage 4 sets first is what clears the way. The screen drops back to new rule afterwards, because the set it was showing is gone.',
      },
      fHeldBack: {
        what: 'Shows the held-back window on the Stage 4 record set\'s table: the held-back row under each setting and the sorts on it. Off every time the Funnel is opened and every time the record set showing changes. Ticking it on is written on this Stage 4 record set as one dated look, which Held counts the way it counts a look on Boards.',
        more: 'Off, the held-back numbers are not sent to the screen at all, a sort saved on one of them is set aside and the table reads in its own order. The held-back window is the once-only look at days no part of the search touched; every look at it is counted so the verdict can say how many there were.',
      },
      fCutRename: {
        what: 'Saves the name typed beside it.',
        more: 'It is the only control on this screen that changes anything. Everything else on it is the record of a decision already made, and a record you can edit is not a record.',
      },
      fCrosses: {
        what: 'Reads every pair of dials whose values still vary, and lists the ones where the two dials genuinely depend on each other. Ordered by how many scrambled copies each one beats.',
        more: 'Step 3 asks whether two dials interact, and this reads every pair of them so you do not have to guess which two are worth looking at. A pair is listed only when it has a block at all - at least one box beating the bar - AND that block does not stretch across every value of both dials, because one that does says nothing the two separate ranges cannot. It is never ordered by money: a block is scored on how many of the copies the boxes inside it beat, then on how big it is, then on how far above the copies it sits. The line above the button says how many pairs there are and roughly how long it will take before you start it, because on a board with nothing narrowed yet that can be a long wait; once it is going, what is left is worked out from the pairs already read. Each row has a button that opens that pair\'s grid.',
      },
      fCrossOn: {
        what: 'Keeps the list of pairs up to date by itself: every time your rule changes, the pairs are read again.',
        more: 'Using a cross writes ranges on both of its dials, so every pair containing either of them drops off the list and the ones left are worth different amounts than they were. With this ticked that happens without you asking. With it clear, the button is the only way, and a list worked out under a rule you have since changed is not shown at all - it would be worse than no list. A reading that FAILED is never started again by itself; press the button to try it again.',
      },
      fAcross: {
        what: 'Applies the rule you have built on this unit to each of the other units\' records, one at a time, and reports how many come out positive.',
        more: 'This is the honest form of "Does it hold elsewhere": the same rule on other coins and shapes, judged against each of their own scrambled copies. It is pressed rather than automatic because it reads every other unit\'s board, one at a time. The result is kept for this exact rule; change the rule and it asks again.',
      },
      fBar: {
        what: 'The share of the scrambled copies a value has to beat to count as real - to go bold, to be recommended, to be a square in a block. 80% unless you change it, and the count that comes to on this set is printed beside the box.',
        more: 'The share is worked out as a count per set, rounded up: 80% of 20 copies is 16, of 10 is 8, of 3 is 3. With no forecast at all the real figure is one more draw among the copies, so it beats at least N of K about (K + 1 - N) in (K + 1) of the time: 24% at 16 of 20, 27% at 8 of 10, 62% at 8 of 20. That rate is printed beside the box so you see what a bar buys, and the line at the top of step 1 says how many values clear the bar against how many would by chance. The bar is saved with this walk and written on the set it cuts, as the share and as the count it resolved to, because a bold row means one thing under 16 of 20 and another under 8. It stays where you leave it for every coin and shape of this set.',
      },
      fTarget: {
        what: 'Roughly how many settings you are hoping to end up with. It is a guide, not a knife - nothing is ever trimmed to reach it. It stays where you leave it for every coin and shape of this set.',
        more: 'It shows you the distance to the target at every step, so you can see whether you are narrowing too fast or too slowly while there is still time to change course. If your rule overshoots at the end, you are offered three ways to close the gap and told what each one costs.',
      },
      fDial: {
        what: 'Which setting to look at the shape of.',
        more: 'The list is every dial a sweep can vary, read from the engine rather than typed into this page, so it cannot quietly disagree with what your records actually hold. Each is listed with the name of its box on Sweep in brackets, the way the table on step 1 lists them.',
      },
      fMin: {
        what: 'The lowest value of this dial to keep.',
        more: 'Leave it blank for no lower limit. Keep a RANGE rather than a single value: one value far clear of its neighbours is what a shuffle produces, and taking it is the shopping this whole screen exists to avoid.',
      },
      fMax: {
        what: 'The highest value of this dial to keep. Blank means no upper limit.',
        more: 'Together with the lowest value this becomes one clause of the rule, and you can come back and change it at any point.',
      },
      fAlsoNone: {
        what: 'Keeps the settings that have no value for this dial as well as the range. Without it a range drops them, because "none" is not a number. Clear both range boxes and it keeps those settings and NOTHING else.',
        more: 'Shown only when the table above has a none row. With a range in the boxes the rule reads "or none"; with both boxes clear it reads "is none" instead, and keeps only the settings that have no value for this dial at all. That is the one value on an ordered dial that can be kept on its own, because it is not a point on the dial\'s scale - it is a different kind of setting, so keeping it is choosing a kind rather than picking a peak. The count beside the button follows whichever of the two you have set up, before you press it.',
      },
      fAddRange: {
        what: 'Adds the range you have chosen for this dial to the rule.',
        more: 'The survivor count at the top updates straight away. Nothing is written to disk until the last step.',
      },
      fA: {
        what: 'The first of two dials to lay against each other on a grid. The list is every dial the engine knows, each with the name of its box on Sweep in brackets; it starts on the leading dial from step 1.',
        more: 'This is where you see things like a short distance only working when the holding time is long - which no ranked list can show you.',
      },
      fB: {
        what: 'The second dial for the grid. It starts on the second dial from step 1.',
        more: 'Each square shows the average for the settings that carry both values, and the second grid underneath shows the same square on the check - so a square that only looks good is told apart from one that beats the check.',
      },
      fKeepValues: {
        what: 'Keeps the ticked values of this dial and drops the rest. For dials whose values are words rather than numbers. The count beside it follows the ticks as you change them.',
        more: 'A word-valued dial cannot be kept as a range - there is no order to "active" and "directional". The ticked values become part of the rule, so a scrambled copy handed the same rule keeps the same values. The recommended values are ticked when you arrive; untick or tick as you see fit. Ticking none removes this dial from the rule.',
      },
      fKeepBlock: {
        what: 'Writes a range on BOTH dials at once from a block of squares on the grid, replacing whatever the rule held for those two dials. The money each block is worth is printed beside it; it is never what the recommendation is chosen by.',
        more: 'Your own block if you pressed two corners; otherwise the recommended one - the largest rectangle of squares that beat the check and are not thin. Use it when the good part of one dial sits at particular values of the other; two ranges set one at a time cannot say that. The step records whether the two dials interact.',
      },
      fAccept4: {
        what: 'Records that you accepted the rule across these slices, and opens the next step.',
        more: 'What you accepted is written on the set in words - "accepted 4 of 6; the check managed 3 of 6" - as a mark, so anyone reading the set later can see how much of the board the rule held on and how much of that the check managed anyway. It is disabled when there is nothing to compare.',
      },
      fSetRebuild: {
        what: "Prices this record set's own settings again and keeps the answer on the set itself.",
        more: 'Six numbers are not stored by a sweep - the worst losing streak, the biggest single loss, the best single trade, how many trades won, how many were stopped out, and the gross per trade. On a walk they are worked out by "Work out the test history numbers" at the top of the screen, for every setting in the stage 3 record set, and kept in one file beside THAT set. A set cut before that press had covered the whole of its parent can find them gone from the parent\'s board: its columns go empty and, if its rule puts a limit on the worst losing streak or on trades, its rule stops keeping anything at all. This press is the one thing that puts it right, and it differs from the one on a walk in where the answer lands - it keeps it on THIS set, for good, so nothing done to the parent can take it away again. It takes minutes and it waits for any sweep that is running.',
      },
      fRegionAtLeast: {
        what: 'How much a setting is allowed to lose and still count as part of the region. A setting has to BEAT this number, not match it, so at 0 one that broke even to the cent is left out. 0 means it has to have made money, which is how this step has always read.',
        more: 'The region is the widest run of neighbouring settings that all work. With the bar at 0 a single setting a cent under splits what would be one wide area into two narrow ones, and a narrow area is the thing this step exists to warn you about - so the split can mislead you in the direction that matters. Set the bar below 0 and a shallow dip is walked through instead. The scrambled copies are measured under exactly the same bar, or a region grown under a loose bar would be compared against copies measured under a strict one, which is not a comparison at all. Whatever it papers over is counted under the box, marked on the set, and cannot be cleared.',
      },
      fRegionReach: {
        what: 'How far apart two settings may be and still count as neighbours. 1 means neighbours only, which is how this step has always read.',
        more: 'The region is grown by walking from one setting to the next along one dial at a time. At 1 it stops dead at any setting that is missing from the board - not one that lost money, one that was never priced, because your rule cut it out or the sweep never made it. A bigger number lets the walk step over that gap and carry on. The money bar cannot help with this: an absent setting has no money to be above or below.',
      },
      fRegionRead: {
        what: 'Reads the region again with the three limits you have set: the money bar, how far apart neighbours may be, and which word-valued dials the region may step across.',
        more: 'All three are also read again the moment you leave one of their boxes or tick one of the dials, so this button is for when you want to be sure. Nothing is written into the rule by reading; that is the button below. The tick boxes are offered only for the dials that still hold more than one value on this board, because crossing a dial the rule already pinned would do nothing - and every one of the three is recorded on the set if you use it.',
      },
      fKeepMine: {
        what: 'Leaves every range and value you chose exactly as it is and moves on to step 6. What it keeps is printed beside it, next to what the region would keep, and both rules are printed under the buttons.',
        more: 'Keeping the auto-plateau region REPLACES the whole rule with the region\'s edges. This is the way past that: your own rule goes to step 6 whole. The set you cut then says the auto-plateau region was never kept on this walk, and the rule it holds is the one you built. Use it when the region is telling you less than your own narrowing already did.',
      },
      fKeepRegion: {
        what: 'Replaces every range and value in the rule with the edges of the region this step worked out for you.',
        more: 'The region is the widest run of neighbouring settings that all made money. Its edges on each dial ARE a rule - the most defensible narrowing this screen can make, because it was chosen by how many neighbours a setting has and never by its score. But a rule can only ever be ranges and values, never a list of settings, so this keeps the smallest BOX that contains the region, and a region with notches in it has a box bigger than itself. The count beside the button is what the box keeps, and when it is larger than the region the difference is spelled out under it: those extra settings are the ones the region walked around, which at your bar are the ones that did not clear it. The rule it would write is printed under the button, beside the rule you already have, so you can see whether the two are actually different.',
      },
      fFloor: {
        what: 'How many settings must sit behind a square before you trust it.',
        more: 'Squares below this are greyed and show their count instead of being hidden. A square built from two settings looks exactly like one built from two thousand, and it will often be the best-looking square on the grid precisely because small groups swing further. The line above the grid tells you how many squares each choice of floor would keep, so you are not picking the number blind.',
      },
      fGrid: {
        what: 'Builds the grid for the two dials named in the boxes, with the thin below cut-off. Changing a dial box reads the grid again by itself; a new thin below number needs this button.',
        more: 'Nothing here changes the rule - this step is for looking. Only Keep this block writes anything.',
      },
      fRebuild: {
        what: 'Works out the numbers a sweep does not keep - the worst losing streak, the biggest single loss, how many trades won, how much of the result rests on guessing what happened inside a single bar, and what each setting made in each of the three parts of the test window. Press it FIRST, before anything below: it runs for every setting of what is chosen under coin - one coin and shape, or every one when all units together is chosen - and nothing else on this screen can be read until it has. Every coin and shape needs it pressed once before it can be walked.',
        more: 'These are calculated during the sweep and thrown away, because keeping them for every one of half a million settings is not worth the disk. Here they are calculated again and kept beside the set, so a second press only works out what is still missing. It also re-checks the money and the trade count against what the sweep stored, for every setting on the board: if they disagree, something underneath has changed and it says so rather than mixing numbers from two different runs. Every copy of this press, here and on step 6, works out what is chosen under coin: a coin and shape picked means that one only, all units together means every one - and with all units together showing it asks first, because that is the long job on this screen. The line beside it says which, and each coin and shape prepared stays prepared.',
      },
      fHoldRead: {
        what: 'Reads every coin and shape in this record set and asks whether putting its settings in order by what they made on one part of the test window still picks the good ones on another part.',
        more: 'The whole walk below is one way of choosing: order the settings by their money and keep the best. Nothing else on this screen asks whether that order means anything. This does, and it does it before you narrow anything - a coin and shape whose own order does not survive its own test window is worth knowing about now rather than after the held-back window has been opened on it. It reads nothing from the held-back window and nothing from the unread stretch, so it costs nothing that can only be spent once. It changes no rule and writes nothing.',
      },
      fHoldAtLeast: {
        what: 'The settings are put in order by the money they made on one part of the test window, then put in order again by their money on another part. This number is how far the two orders agree, from -1 to 1: 1.00 is the same order on both parts, 0.00 no relation at all, below zero the order comes out backwards. A coin and shape clears the bar when its number reaches this on as many of the four boundaries as on how many of the four asks for. Leave it blank and no row can clear the bar, because nothing has been asked of it.',
        more: '1.00 is the same order on both parts, 0.00 no relation at all, and below zero the order comes out backwards - which is worse than useless, because what is being selected for is actively wrong across the boundary. There is no right number here and none is suggested: what counts as enough is your call, and it is recorded as the bar you set.',
      },
      fHoldOn: {
        what: 'How many of the four boundaries have to reach that number before a coin and shape counts as clearing the bar.',
        more: 'Four is the strictest and one the loosest. A boundary that could not be read is not a boundary that passed: if fewer than this many have an answer at all, the row reads as not clearing rather than as clearing on the ones that could be read.',
      },
      fHoldRanked: {
        what: 'The fewest settings a coin and shape must have carrying all three parts of the test window before it is ranked at all. One setting is one combination of entry, gate, d, t, trail and arm.',
        more: 'This counts SETTINGS, not history. Three settings put in order against each other says nothing however long the window is, and a reading off a handful looks exactly like a reading off thousands. Below this the row says it could not be read instead of showing a figure. How much history is behind each figure is the box beside this one, and the two do not guard each other.',
      },
      fHoldChunks: {
        what: 'The fewest chunks the shortest of the three parts of a coin and shape\'s test window must hold before it is ranked at all. Zero turns this off.',
        more: 'This counts HISTORY, not settings. A shape that decides once a week gets about sixteen chunks a part on today\'s history where one that decides daily gets over a hundred, so each setting\'s figure in a weekly part is a handful of trades. That noise drags every column towards 0.00, which means a short coin and shape reads as worse than it is - you would drop a good one for being short. This floor is what stops that, and it is the number that cuts off the shapes deciding once a week. It is read off the window each run actually recorded, never worked out from the layout.',
      },
      fHoldShow: {
        what: 'Which rows the table draws: every coin and shape, only the ones that clear the bar, or only the ones that do not.',
        more: 'Nothing is thrown away. A row hidden here is still counted in the line under the table, which always says how many of the whole set you are looking at.',
      },
      fHoldSort: {
        what: 'The order the rows are drawn in.',
        more: 'It changes nothing about what any row says. The order the set lists them in is the order the sweep worked through them.',
      },
      fDD: {
        what: 'The worst losing streak you are willing to accept, in dollars, per coin - the deepest the running total ever sat below its own best point, on the stake named at the top of this step.',
        more: 'A total says nothing about the ride. A setting that made money by sitting through a loss deep enough to end you is not a setting you want, and the total looks identical either way.',
      },
      fTrades: {
        what: 'The fewest trades a setting must have made to stay in, counted over the window named at the top of this step - not over a year. The line beside each rung says what a count comes to a year.',
        more: 'A handsome result from four trades is four coin flips. This is a blunt way of saying you want enough of them to mean something.',
      },
      fAddFloors: {
        what: 'Adds the limits you have set to the rule.',
        more: 'Like every other step, this changes the survivor count immediately and writes nothing until the end.',
      },
      fName: {
        what: 'What to call the set this produces. Leave it blank and it is numbered for you.',
        more: 'The name is what you will pick it by on every screen after this one, so something you will recognise in a month is worth the ten seconds.',
      },
      fClose: {
        what: 'What to do if your rule keeps more settings than you were aiming for.',
        more: 'Accepting what the rule gives costs nothing - the target was only ever a guide. Tightening the ranges narrows them inward from both ends, which keeps the middle of the good region rather than drifting toward the best single value. Taking the top N is shopping, on the very board this screen exists to stop you shopping, and it is offered anyway because the choice is yours. Whichever you use is recorded, so the final check at the end of the chain knows what it is judging.',
      },
      fCutCol: {
        what: 'Which column the top N is taken by.',
        more: 'Only columns a scrambled copy of the table really has are offered. A scrambled copy is your table with the money swapped for what each setting made when the forecasts were dealt onto the wrong days; every OTHER column on it is still the real one. So taking the top N by anything else would sort the scrambled copy by real numbers and hand back the same rows - a comparison that looks like one and is not.',
      },
      fCutN: {
        what: 'How many settings to keep off the top.',
        more: 'It is seeded from your target when you pick this, because reaching the target is what it is for, and you can set it to anything. It becomes part of the rule rather than a trim done afterwards, which is what lets a scrambled copy be handed the same rule and take its own top N - so you can see how much of your best N is the strategy and how much is the deal.',
      },
      fCut: {
        what: 'Writes what you have arrived at as a new record set, and opens the held-back window on it for the first time.',
        more: 'What gets written is the rule and the settings it keeps, along with every step you took and every step you took back. An empty result or a single-setting result is written with a warning rather than refused - it is your call, and a rule that keeps nothing is still worth being able to read back.',
      },
      fClear: {
        what: 'Throws away every choice and starts the rule again, keeping the same board open.',
        more: 'This counts as going back, and it is recorded. That is deliberate: a board you have looked at from five different angles has been looked at more than one you walked through once, and the final check needs to know.',
      },
    },
  },
  held: JUDGE_HELP.held,
  reserve: JUDGE_HELP.reserve,

  history: {
    title: 'History',
    how: [
      ['After the Funnel, before Tune, Held and Reserve',
        'History takes a Stage 4 record set straight from the Funnel and asks nothing of Held or Reserve, which come at the very end, after Tune, and judge what leaves here. A half-life set built here is judged there as its own rule.'],
      ['Is it still true, or was it true in 2018',
        'A setting that worked for two years and then stopped will still look good averaged across the whole history, because the good years carry the bad ones. That is the single easiest way to be fooled by a long backtest.\n\nThis re-scores the same setting while counting recent evidence more heavily than old evidence, at the rate half-life sets, and shows it beside the same run with everything weighted equally. If the two disagree, the effect is not where you think it is.'],
    ],
    intro: 'Whether an effect is still there now, or was only there years ago. A setting that '
      + 'worked in 2018 and stopped working in 2022 will still look good averaged over the whole '
      + 'history — this is what separates the two.',
    controls: {
      hSet: {
        what: 'Which Stage 4 record set to retrain, from every set on this box, newest first, each with its coin and shape and its survivors.',
        more: 'Choosing a set reads nothing on the held-back window: it shows the set\'s window layout, which stretch the retraining trains on and which it is judged on, and how many times the run has been pressed.',
      },
      hHl12: { what: 'Whether to retrain at a 12-month half-life: a training day a year old counts half as much as today.' },
      hHl18: { what: 'Whether to retrain at an 18-month half-life.' },
      hHl24: { what: 'Whether to retrain at a 24-month half-life: a training day two years old counts half as much as today.' },
      hHl30: { what: 'Whether to retrain at a 30-month half-life.' },
      hHl36: { what: 'Whether to retrain at a 36-month half-life: a training day three years old counts half as much as today.' },
      hHl48: { what: 'Whether to retrain at a 48-month half-life: a training day four years old counts half as much as today.' },
      hHalfLife: {
        what: 'Retrains the forecasts behind every setting of the chosen set, once per ticked half-life, and prices the same settings again beside the unweighted figures on the Test window, which the retraining never touched.',
        more: 'The set\'s own layout, judged on the Test window either way: a set built 61/13/13/13 (sealed exam) retrains on its 61% and is judged on its 13% test window, with its held-back 13% not read and its last 13% sealed; a set built 70/15/15 retrains on its 70% and is judged on its 15% test window, with its held-back 15% not read. Both kinds of forecast are retrained; every other training choice stays as the set was made. The best of each row is green, and a half-life wins only by at least a cent. History comes before Held and asks nothing of it, and it never reads the held-back window: that stays secret until Held, or until a scan on Tune is told to read it. Every press appends a table; none is overwritten.',
      },
      hHlName: { what: 'The name of the half-life set built from the newest table, as it will read on Tune and Greenlight.' },
      hHlBuild: {
        what: 'Builds a record set from every row a half-life won on the newest table, each record carrying the half-life that won on it. Rows the unweighted column won are left out.',
        more: 'It appears in the Stage 4 record set boxes on Tune and Greenlight, named with the set it was built from, and goes forward under that set\'s name. A greenlight from one of its records carries the half-life, and the live path trains that setup the same way.',
      },
    },
  },

  tune: {
    title: 'Tune',
    how: [
      ['First, the trades of a Stage 4 record set',
        'A Stage 4 record set holds money per window and never the trades, and the two scans need the trades. The first panel writes those down — every hour the rule of a survivor spoke, on the training, test and held-back windows, with the side and how many members called it — for every survivor that enters at market with no trailing stop. Once captured, the set can be chosen under "Tuning targets" below, with one survivor of it or all of them, and the windows to read.\n\nReading the held-back entries is a counted look at the held-back window, the same count Held keeps. Reading the training and test entries is not: those windows were read to choose the rule. Nothing from a Stage 4 record set is ever applied to the trading machine.'],
      ['One variable at a time, on one survivor\'s trades',
        'The Sweep tab is wide and shallow: many settings, each scored once. This is the opposite — one setting, taken apart carefully.\n\nThe two scans work across every value of one thing, over the captured trades of one survivor on the windows ticked, and report the whole shape rather than a winner: which protective stops would have cost nothing, and how much requiring more agreement is worth. Both take minutes and cannot be stopped part-way.'],
    ],
    intro: 'Adjusting one chosen setting rather than searching for new ones. Everything here works '
      + 'on one survivor of a Stage 4 record set whose trades were captured, over the windows ticked.',
    controls: {
      tnSet: { what: 'Which Stage 4 record set to capture the trades of, from every set on this box, newest first.' },
      tnCapture: {
        what: 'Writes down every trade of every survivor that enters at market with no trailing stop, on the training, test and held-back windows, and on the reserve window when the set\'s layout keeps one and its seal is intact.',
        more: 'Tune comes before Held and asks nothing of it. A second press replaces the capture on record; the looks already counted stay.',
      },
      tuneTarget: { what: 'Which Stage 4 record set the two scans below work on, from those whose trades were captured.' },
      tnPick: {
        what: 'Which captured survivor of the Stage 4 record set the scans read, or all of them.',
        more: 'By depth is the setting nearest the middle of every range of the rule, among the captured survivors, chosen without looking at money: the same pick Greenlight makes, so a scan can be aimed without shopping the survivors. All survivors pools every captured survivor\'s trades into one list, each trade held for its own survivor\'s length, so the scan reads the whole table at once. Naming one records it as your pick.',
      },
      tnWinTrain: { what: 'Whether the scans read the entries of the training window. Not a look: this window was read to choose the rule.' },
      tnWinTest: { what: 'Whether the scans read the entries of the test window. Not a look: this window was read to choose the rule.' },
      tnWinReserve: {
        what: 'Whether the scans read the reserve window\'s captured trades: the stretch sealed away before anything trained, written down by the capture when the set\'s layout keeps a reserve.',
        more: 'A scan that reads them is a counted look on the reserve, stamped on the capture and said on every reserve set read from the rule. A capture taken before this existed holds no reserve entries and says so; capture the trades again.',
      },
      tnWinHold: {
        what: 'Whether the scans read the entries of the held-back window.',
        more: 'Every scan that reads them is a counted look at the held-back window, stamped on the capture and counted on Held.',
      },
      stopCustomPct: {
        what: 'A protective stop of your own choosing for the survivor picked under Tuning targets, as a percentage of the opening price.',
        more: 'The floor is twice the round trip at the fee this set\'s trades were priced at: tighter than the round trip and a triggered stop is a guaranteed loss; tighter than the floor and it fires on ordinary hourly noise.',
      },
      sizingWhy: {
        what: 'Your reason for applying the conviction sizing to the survivor picked under Tuning targets, or for taking it off. Saved with the choice on that survivor.',
      },
      sizingApply: {
        what: 'Records on the survivor picked under Tuning targets that its trades are sized by conviction: one clip for each member that agreed, the ladder the conviction scan reads.',
        more: 'A tuning you can apply or not. The next held set or reserve set read from the rule freezes the choice, a greenlight carries it, and the picture on Greenlight shows the survivor\'s money with and without it, worked out from its captured trades by the scan\'s own arithmetic. Nothing is applied to any trading machine.',
      },
      sizingOff: {
        what: 'Records that the survivor picked under Tuning targets is not sized by conviction: every trade at one clip.',
        more: 'The same record, switched off; the reason box goes with it.',
      },
      stopCustomApply: {
        what: 'Records the percentage typed beside it as the stop forced onto the survivor picked under Tuning targets, and scans that survivor\'s captured entries over the windows ticked, so the table below carries the stop as one row.',
        more: 'It is a record on the Stage 4 record set and a row of the table; it is applied to no trading machine. A read of the held-back entries is a counted look, as for any scan.',
      },
      stopClear: {
        what: 'Records NO fixed protective stop on the survivor picked under Tuning targets — its positions then rest only on their scheduled closing time — and scans its captured entries the same way: the no-stop row of the table below.',
        more: 'A cleared stop is a choice made on purpose and the record says so; it is not the same as no choice ever recorded. Applied to no trading machine.',
      },
      stopWhy: { what: 'Why you chose this stop, or no stop, for the survivor picked under Tuning targets. Kept with the choice on that survivor.' },
      stopWhySave: { what: 'Saves the reason on its own, leaving the stop on record exactly as it is. No scan runs.' },
      stopRun: {
        what: 'Tries every protective stop across the whole history and reports which ones would have cost you nothing.',
        more: 'Takes minutes and cannot be stopped part-way. When a stop is on record for the survivor picked, the table carries it as its first row, priced on the same entries by the same arithmetic.',
      },
      convRun: {
        what: 'Tries every level of agreement across the captured trades, to see how much conviction is worth requiring: as money, and as a return on the amount traded.',
        more: 'The money line can rise simply because the ladder trades more; the return on the amount traded, flat against ladder and per level of agreement, cannot. Takes minutes and cannot be stopped part-way.',
      },
    },
  },

  coins: {
    title: 'Coins',
    how: [
      ['What this screen is for, and what it will never do',
        'It draws what each coin\'s history holds, decision by decision, so you can judge before a sweep whether '
        + 'the coin is apt for dual member voting — two sets of members, one trained towards rising and one towards '
        + 'falling, each sitting out on the other\'s kind of decision — or better left on the traditional single '
        + 'member set voting. It REPORTS. It never refuses a coin and it never decides which coins a sweep runs on; '
        + 'the choice of what to sweep stays yours, made by looking.'],
      ['What one coloured unit is',
        'One decision: one moment a setup could open a trade, which is one row of what Sweep trains on. Each is '
        + 'read on its own window — the run of hourly candles that decision sees before its trade opens, 24 hours '
        + 'on Daily 1-day up to 192 on Weekly 8-day. The window move is how far price moved from the first candle '
        + 'of that window to the price the trade opens at. Green: it rose by more than the sit-out band. Red: it '
        + 'fell by more. Black: it moved too little either way, and a decision like that would sit out. Nothing '
        + 'after the open is read, so the same reading is known live at the moment a real trade would open. Hover '
        + 'a point on a bar to read that decision\'s day, its window move, how it reads, and how its trade then '
        + 'went.'],
      ['Five bars, and why not three',
        'One bar per chunk shape. Daily 1-day and Daily 2-day open their trades at the same moments but read '
        + 'different windows, 24 hours against 48, so the same moment can read differently under each; the same '
        + 'holds for three-day and four-day. Trade length never enters: the window belongs to the shape, and how '
        + 'long the trade is then held changes nothing about what the decision saw before it opened.'],
      ['The two divisions marked on every bar',
        'Above each bar, 70/15/15 marks where train, test and held fall. Below it, the shaded boxes mark '
        + '61/13/13/13 (sealed exam): train, test, held and the reserve. Each box is as wide as the share of '
        + 'decisions that part holds, so it lines up with the bar exactly, and each box says the day its part '
        + 'starts; the test box above is shaded. The table under the bar counts, per part under each division, '
        + 'how many decisions read rising, how many falling, how many sit out, and how many times the colour '
        + 'changes — a held or a reserve that is all one colour is exactly the thing this screen exists to show '
        + 'you before the sweep is spent.'],
      ['The gap: what dual member voting is betting on',
        'Under every bar, one table. Its first row is the whole bar; then every part under 70/15/15; then '
        + 'every part under 61/13/13/13 (sealed exam), each with the day it starts. Beside the counts of rising, '
        + 'falling and sit out is the gap: of the decisions whose window read rising, the share whose trade then '
        + 'went up, against the same share after a falling window, and the difference in points; and the average '
        + 'move from open to close after each kind of window, and that difference. The window ends where the '
        + 'trade opens, so nothing leaks between them. A gap near zero means a set trained towards rising and a '
        + 'set trained towards falling would learn the same lesson twice, and each would be silent half the time '
        + 'for nothing: that coin stays on the traditional single member set voting. A wide gap means the split '
        + 'has something to learn from. Two columns qualify it: the thin side, the smaller of rising and falling, '
        + 'because a gap built on forty decisions is not a gap; and the run, decisions per colour change, '
        + 'because a reading that flips every day is not a regime. Read the gap per part — one that is there in '
        + 'train and gone in held is the case that has burned us before. None of it is a cut-off.'],
      ['The sit-out band: one number, every coin on its own scale',
        'You type one number. On each coin, for each shape, it is read against that coin\'s median window move '
        + 'ignoring direction — the median, because a few wild days do not move it — so the same setting means the '
        + 'same thing on a calm coin and a wild one. At 50 a decision sits out when its window moved less than half '
        + 'what the coin typically moves over that window; at 0 nothing sits out; higher blacks out more. It is '
        + 'applied when the screen draws, never when a coin is read, so changing it recolours every bar at once and '
        + 'reads no candle again. It lives in one place, and Sweep trains with the same number.'],
      ['What a reading says about itself',
        'Every coin\'s heading carries when it was read, the release that read it and how many candles it was read '
        + 'from. When more history has been cached for that coin since, the heading says how many months. A coin '
        + 'that could not be read is still listed, with a sentence saying why — it is never left off. A file on disk '
        + 'written by an older release that drew something else is named at the top rather than drawn wrong, and '
        + 'nothing old is left lying around: reading a coin replaces every older file for that coin, and the '
        + 'control beside the note removes the ones a read does not reach.'],
    ],
    intro: 'A picture of each coin\'s history, one bar per chunk shape: every decision the history offers, coloured '
      + 'green where price rose across that decision\'s own window, red where it fell, black where it moved too little '
      + 'either way and would sit out. It exists so a sweep can be started knowing which coins are apt for dual member '
      + 'voting. Nothing on this screen refuses a coin or decides anything.',
    controls: {
      cCoins: 'which coins to read, comma separated. Blank reads every coin whose prices are downloaded on this box, the same as a blank box on Sweep. There is no fixed list, so a coin downloaded today is read tomorrow without anybody adding it anywhere.',
      cSweepFrom: 'the lowest sit-out band the sweep starts from. It is not the setting itself — it is one of three boxes that, with Apply, write a list into sit-out bands to sweep, and that list is what is swept.',
      cSweepTo: 'the highest sit-out band the sweep reaches. A band above the ones in the list can never come out as a shape\'s best sit-out band however well it would have read, so it wants to reach at least as high as the sit-out bands to try on Walk it forward.',
      cSweepStep: 'how far apart the bands the three boxes make are. Halving it doubles what a reading costs, because every band in the list is scored on every coin and every chunk shape.',
      cSweepApply: 'puts the three boxes above into sit-out bands to sweep. It stores nothing by itself: the list is yours to edit afterwards, and the list is what counts.',
      cSweepBands: 'the sit-out bands this reading sweeps, comma separated, and the only thing that decides them. Apply fills it from the three boxes above and after that it is yours — leave gaps in it, add one band on its own, take one out; how it was arrived at does not matter. The best sit-out band a coin and chunk shape comes out with is one of these and can be no other, and each shape at its own best sit-out band on How each coin reads names the sweep the bars were drawn from.',
      cBand: 'how small a window move counts as sit out, as a percentage of the coin\'s median window move for that shape. One number for every coin, read on each coin\'s own scale: at 50 a decision sits out when it moved less than half what the coin typically moves over that window. It recolours the bars and does nothing else: nothing is read again, no record changes, and nothing outside that section reads it. Sweep has its own band, and Walk it forward has its own sit-out bands to try.',
      cPassBar: 'the bar a coin and shape must clear to be listed as passing: of the fifty deals with the link cut, at most this many may have produced a plateau at least as strong as the real one. 0 is the strictest, the default is 2. The table under it lists every passer with the numbers read at its own sweet spot, one tick per row; the ticked rows are what Sweep runs when its own tick, only the coins and shapes ticked on Coins, is on. It has one home, beside the band.',
      cAuto: 'ticked, every coin and chunk shape is drawn at the sit-out band that suits it rather than the one typed beside this — its own best sit-out band, which is the band inside its plateau that keeps the most edge per decision (edge per called trade times the share of decisions still called), smoothed three bands wide, the lower band on a tie. Where the signal line says no band beats chance for three steps together, the typed band applies, and the bar\'s heading says which band it is drawn at and why. Unticked, the typed band applies everywhere. This only changes which band the bars are drawn at: nothing is read again either way, nothing outside that section reads it, and it lives beside the band in the same home.',
      wBacks: 'the look-backs, in hours, comma separated, and the only box for them. The chunk shape decides the TRADE — when it opens and how long it is held — and a look-back decides what is LOOKED AT, which there is no reason to tie together: a Daily 2-day trade can be judged on the last two days, or the last week, or the last fortnight. Blank walks each chunk shape\'s own span and nothing else. EVERY look-back in the box is walked: one the records do not carry is worked out from the candles when the walk starts and kept, so it costs a slower start once and nothing afterwards. Every look-back ends at the same moment the decision is taken, so none of them can see past it.',
      cRun: 'reads every coin named above at every chunk shape, and writes each coin\'s window moves against its history. One coin that cannot be read does not stop the others. The sit-out band is not part of a reading, so changing it never needs this pressed again.',
      cStop: 'stops after the coin being read now. What has already been written stays, and the line beside the buttons says a stopped run was stopped and where it got to.',
      wWindow: 'how long one window of the walk is, in months. Each chunk shape turns it into its own number of decisions, so six months is about 183 decisions on a daily shape and 26 on a weekly one. Short windows show a phase turning on and off; long ones hold more trades each and say less about when.',
      wWarm: 'how much history has to sit behind the first window before anything is priced, in months. Which way a coin leans is learned from it, so too little history and the first windows are learned from almost nothing.',
      wBandFrom: 'the lowest sit-out band this walk starts from. One of three boxes that, with Apply, write a list into sit-out bands to try; that list is what is walked.',
      wBandTo: 'the highest sit-out band this walk reaches.',
      wBandStep: 'how far apart the bands the three boxes make are. Every band in the list is walked on every coin, every chunk shape and every look-back, so halving this doubles the walk.',
      wBandApply: 'puts the three boxes above into sit-out bands to try. It starts nothing and stores nothing: the list is yours to edit first.',
      wBands: 'the sit-out bands this walk tries, comma separated, and the only thing that decides them. Apply fills it from the three boxes above and after that it is yours — leave gaps, add one band on its own, take one out. Every one of them is walked and every one is reported, never only the best.',
      wSpot: 'ticked, the walk also runs at the band the reading above searched out for each coin and shape. It is marked searched in the table, because it was chosen across the whole history while the typed bands were not, and side by side they would otherwise read as a fair comparison.',
      wUsual: 'what the bands are a percentage OF. trailing works it out from everything before each window, which is what a run would have had in hand at the time. whole history uses one figure across the whole span, which is what the reading above uses — kept so the two can be put side by side.',
      wSigns: 'learned before each window: which way the coin leans is worked out afresh from everything behind each window, so the figures are what the walk would actually have made. learned once on train: worked out once from train and never touched again, which says whether the relationship itself holds still rather than what it paid.',
      wScrambles: 'how many copies of the same coin to walk. With hundreds of rows on the table a handful will shine for nothing, so a row that beats its own copies is saying something and a row that is merely positive is not. Each copy is built two ways and BOTH are reported, in the last two columns of the table. Dealt: the outcomes are put in a new order, leaving every move and every threshold where it was. Slid: the outcomes are moved along by the same amount and the tail wraps round to the front. Dealing cuts two things where only one was meant to go — the link between what was seen and what followed, which is the point, and the outcomes\' own order in time, which is not. Sliding cuts only the first. It matters: on a made-up coin that simply drifts one way for a stretch and then the other, the dealt copies come out far harder to beat than they should be, and the slid ones come out fair. Where the two counts disagree, trust the slid one. Zero skips both and the walk is well over twice as fast.',
      wFloor: 'a window with fewer trades than this shows a dash and is left out of the totals and the counts, because a window of two trades is not a reading. It is not dropped from the strip: you can still see it was thin.',
      wCoins: 'which coins to walk, comma separated. Blank walks every coin that has been read. Every chunk shape of each is walked; the passing table above is not consulted, because it answers a different question and filtering by it here would hide the comparison.',
      wName: 'the name the set this walk writes will carry. Blank takes the greyed name beside it. EVERY FINISHED WALK WRITES A SET to disk — until 3.164.0 it wrote nothing at all, and nineteen minutes of compute went the moment the service restarted. A walk you Stop does not write one, which is the behaviour Stop always had and the reason it had it: a table missing the coins it never reached would read as a comparison and is not one.',
      wSet: 'every finished walk on this box, newest first, with how many rows it holds, how many of them you have picked, what it takes on disk, when it finished and which release walked it. Opening one puts its table on this screen exactly as a fresh walk would be — the same filters, the same sorters, the same window strips, and Choose early, read late reads it too — so there is no second way for a saved set to be drawn. The release matters: a set walked under an older release was walked by older arithmetic.',
      wSetOpen: 'puts the chosen set\'s table on this screen. Whatever walk was in hand is replaced; nothing on disk is touched, so the one you were looking at is still there to open again.',
      wSetName: 'renames the chosen set. Names have to be different from each other, because a name is how you will recognise it in a month.',
      wSetDel: 'removes the chosen set from disk. Two steps, the way a record set is removed: the first press answers with what would go — how many rows, how many megabytes, how many picks — and only the set\'s own id typed back does it. It cannot be undone and the walk would have to be run again.',
      wf_minBest: 'hide rows whose best single window made less than this.',
      wf_minWorst: 'hide rows whose worst single window made less than this. Set it at nought to keep only the rows that never had a losing half-year.',
      wf_maxSpread: 'hide rows whose best window is further than this above their worst one. Spread is the best window less the worst, in the same units as per trade, so SMALL keeps the tight rows — the ones whose half-years all paid about the same rather than being carried by one.',
      wf_minPerSpread: 'hide rows that pay less than this for every point of scatter between their best half-year and their worst. This is the one box that asks for high money AND tight windows at once: it is per trade divided by the spread, so the same money earned evenly reads higher than the same money earned by one spectacular window. A row with only one counted window has no spread and no ratio, and is left out rather than put at the top on nothing.',
      wPromote: 'puts every row ticked in the leftmost column of the walk table into the list at the top of Coins, under the walk set it came from. It is a REFERENCE, not a copy: the row stays on its walk set and is read back off it, so deleting that set takes these rows with it and nothing at the top can go stale against a re-walk. A walk has to be saved before a row of it can be promoted, because there has to be a set to reference. Promoted rows arrive ticked; untick one at the top to leave it out of a sweep without giving up the promotion.',
      wBacksAll: 'sets the look-backs box to exactly what the records already carry, so the walk has nothing to work out before it starts. Use it to see what is there and then trim it.',
      wf_bothOnly: 'keep only the rows Choose early, read late picked AND that also topped the LATE half — one setting winning both halves of the history. Where a pick did not, the column beside it names the look-back and band that did win late. It is NOT the same as same pick on that reading, which compares the early half against the WHOLE history: the whole contains the early half, so agreement there is partly baked in, where these two halves share nothing. Until you press Choose early, read late there is no reading to filter on and the tick hides nothing.',
      wfApply: 'puts every filter box on at once and redraws the table. The same control, and the same words, as Apply settings on Boards. Greyed out until a box says something different from what the table is already showing, and greyed out again if you type the old value back. Typing into a box does NOT redraw the table on its own — it used to, which replaced the box being typed into and threw the cursor out of it, so only the first character could ever be entered.',
      wfAuto: 'ticked, each filter box goes on the moment you leave it. Unticked, nothing goes on until you press Apply settings — one wait for the whole set of boxes rather than one wait per box. The same choice the filters on Boards offer.',
      wfClear: 'empties every filter box at once, so the whole table is shown again. The same control, and the same words, as Clear filters on Boards.',
      wfClear2: 'the same as Clear filters above it. It appears where the table would be when the filters have hidden every row, because a table that has gone empty should carry the way back to it rather than make you scroll up looking for one.',
      wsClear: 'drops every column out of the sort. The table falls back to the order the walks landed in.',
      wTickAll: 'ticks every row the filter boxes are leaving — all of them, not the hundred on the page you are looking at. The count beside it says how many that is. Nothing is promoted by this: the ticks are still a list you can edit, and Promote the ticked rows is still its own press. The way to use it is to narrow the boxes until the table holds what you want, press this, then untick the few you do not.',
      wTickNone: 'unticks every row the filter boxes are leaving. It reaches the same rows Tick every row shown does, so a narrow set of boxes unticks a narrow set of rows and leaves any tick outside them alone.',
      ssClear: 'drops every column out of the sort on this table.',
      // CHOOSE EARLY, READ LATE'S OWN FILTER BOXES (3.178.0). Same grid, same
      // button words and the same blank-hides-nothing rule as the boxes above.
      sf_coin: 'show only rows whose coin contains one of these, comma separated. Blank shows every coin. The same box, and the same rule, as coins on the filters above.',
      sf_shape: 'show only rows whose chunk shape contains one of these, comma separated — daily, weekly, 3-day all work. Blank shows every shape.',
      sf_minEarly: 'hide rows whose pick made less than this a trade on the early windows. That is the half the pick was chosen on, so a high figure here is what the choosing was aiming at and says nothing on its own about whether it carried — read least lead, % for that.',
      sf_minLate: 'hide rows whose pick made less than this a trade on the late windows, which the choosing never saw. Set it at the 0.25% round trip to keep only the picks that actually pay after the cost of getting in and out.',
      sf_minLead: 'hide rows whose pick is less than this far ahead of picking blind — what taking a row at random from the same coin and chunk shape would have paid on those same late windows. At nought it keeps only the rows where the choosing carried something, which is the single most useful cut on this table.',
      sf_minPct: 'hide rows whose pick ranked below this among its own coin and chunk shape\u2019s rows on the late windows. 50 is the middle, which is where a pick with no skill behind it lands. It says the same thing as lead more finely, because it is not moved by how much money the whole coin happened to make.',
      sf_minLateWindows: 'hide rows read on fewer late windows than this. A short window leaves some pairs resting on two or three, and two or three late windows is not a reading however good the figures on them look.',
      sf_minLateUp: 'hide rows where fewer than this share of their late windows made money.',
      sf_minLatePaid: 'hide rows where fewer than this share of their late windows cleared the 0.25% round trip. Made money and paid are not the same thing, and this is the one that matters: unlike late it cannot be carried by one spectacular window.',
      sf_minLateWorst: 'hide rows whose worst single late window made less than this. Set it at nought to keep only the picks that never had a losing late window. Read it beside least late windows paid, % — one asks for as many paying windows as possible, the other for no bad ones.',
      sf_minWhole: 'hide rows whose WHOLE-history row makes less than this a trade. That row is the setting to tune with, and it is the row a tick on this table promotes, so this is the box that screens what you would actually carry forward rather than what the reading was taken on.',
      sf_bothOnly: 'keep only the rows whose pick also topped the LATE half — one setting winning both halves of the history, two stretches that share nothing. It is the strictest thing on this table and it cuts hard, so it is a tick and not a default.',
      sf_sameOnly: 'keep only the rows where the whole history chose the same look-back and band as the early windows did. They need not agree — the early half has less to go on — so this is a strictness you turn on, not a fault when it is off.',
      sfApply: 'puts every filter box on this table on at once. The same control, and the same words, as Apply settings on the filters above. Greyed out until a box says something different from what the table is already showing.',
      sfAuto: 'ticked, each filter box on this table goes on the moment you leave it. Unticked, nothing goes on until you press Apply settings.',
      sfClear: 'empties every filter box on this table at once, so every pair is shown again.',
      sfClear2: 'the same as Clear filters above it. It appears where the table would be when the filters have hidden every row, because a table that has gone empty should carry the way back to it rather than make you scroll up looking for one.',
      wf_shownPairsOnly: 'keep only the rows belonging to a coin and chunk shape that Choose early, read late is showing below. Screen the pairs down there, screen the rows up here, and the two work together — which is what saves looking one table up in the other. Until you press Choose early, read late there is no reading to filter on and the tick hides nothing.',
      wf_coin: 'show only rows whose coin contains one of these, comma separated. Blank shows every coin. The line under the table says how many rows are hidden.',
      wf_shape: 'show only rows whose chunk shape contains one of these, comma separated — daily, weekly, 3-day all work. Blank shows every shape.',
      wf_back: 'show only these look-backs, comma separated, in hours — or own for the chunk shape\'s own span. Blank shows every one.',
      wf_band: 'show only these bands, comma separated. Blank shows every band.',
      wf_minTrades: 'hide rows that placed fewer trades than this in total. A row of a dozen trades is not a reading.',
      wf_minPer: 'hide rows that made less than this a trade, before the round trip. The system charges itself 0.25% a round trip, so anything under that loses money.',
      wf_minWindows: 'hide rows with fewer counted windows than this. A wide band leaves whole half-years with too few trades to count, and those windows are not in the total.',
      wf_minUp: 'hide rows where fewer than this share of their counted windows made money. Half is what a coin with nothing in it looks like.',
      wf_minPaid: 'hide rows where fewer than this share of their counted windows cleared the round trip — made MORE than the 0.25% it costs to get in and out. Made money and paid are not the same thing: windows up counts a window that made anything at all, and this counts only the ones worth having. It is the box to reach for when you want good numbers on as many windows as possible, because unlike per trade and per trade per spread it cannot be carried by one spectacular window. Set it beside least worst window, % — one asks for as many paying windows as possible, the other for no bad ones.',
      wf_maxGood: 'hide rows that more than this many scrambled copies matched. Zero keeps only the rows no copy matched at all.',
      wf_maxSlid: 'hide rows that more than this many sliding copies matched. Where this and the scrambled count disagree, trust this one.',
      sCut: 'how many of the earliest windows the choosing is allowed to see. Blank cuts each coin and shape in half. Every figure in the walk\'s table was already priced knowing only what sat behind it, so the money was never in doubt \u2014 the CHOICE was: the look-back and band that look best were picked by reading the whole table, and nobody could have made that choice at the time. A bigger number gives the choosing more to go on and leaves fewer windows to read the answer on.',
      sMin: 'a coin and shape whose row placed fewer trades than this in either half is left out of the reading. A handful of trades is not enough to choose on and not enough to judge on either, and a pair with almost no trades in one half would otherwise swing the whole answer.',
      sRun: 'cuts every coin and shape\'s windows in two, picks its best row on the early windows alone, and reports what that one row did on the late windows \u2014 which the choosing never saw. Nothing is re-walked and no window is re-priced; it reads the walk already in hand, so it answers in a moment and can be asked again with a different cut. The test is the lead column: what the pick made on the late windows, less what taking a row at random from the same coin and shape would have paid on those same windows. Above nought means the choosing carried something. The percentile says the same thing more finely \u2014 50 is where a pick with no skill behind it lands. The pass mark was written down before the numbers existed: the picks ahead on at least 60 of 90, and the pooled late money above the 0.25% round trip. AND THE READING IS NOT THE SETTING. The four columns on the right carry the look-back and band the ENTIRE history chooses for each coin and shape, which is what a unit that has passed should actually be tuned to \u2014 this reading spends half the history to answer whether the choosing is worth anything at all, and that is all it is for. The same pick column says whether the two agree; they need not, because the early half has less to go on.',
      wStop: 'stops the walk where it is. What has already been walked is thrown away rather than shown as a partial table, because a table missing the coins that had not got to yet would read as a comparison and is not one. Press Walk it forward again when you are ready.',
      wRun: 'walks every coin and shape named above, at every band, one window at a time from the start of its history to the end. At the start of each window the coin\'s usual move and which way it leans are worked out from everything behind that window and then held still while the window is priced, so no figure knew anything it could not have known at the time. Nothing is stored, nothing is traded, and no record is touched — press it again with different boxes as often as you like. It runs in the background across every worker the box is set to use, so the line beside the button counts the walks off and says how busy the box is; leaving the tab and coming back finds it still going. Every column of the table sorts: click its arrow to order by it, click again to flip it. Fewest scrambles as good is where it starts, because that is the column that says whether a row means anything at all. A row with nothing in the column being sorted goes last whichever way the arrow points.',
      cClean: 'removes exactly the files the note above names — the ones on disk this release cannot draw — and nothing else. They are found again on the box at the moment you press, never taken from the page, and a record this release can draw is never touched. It is only offered while there is something to remove. Reading a coin replaces its own older files by itself; this is for the files a read does not reach, such as a coin no longer downloaded.',
    },
  },
  greenlight: {
    title: 'Greenlight',
    how: [
      ['The picture through every period',
        'Under the chosen set, the rule\'s money on each of the four stretches of history — train, test, held and reserve — read off the sets this one is built on and the records they stand on: train off the capture on Tune, test off the stage 3 records, held off the held set, reserve off the reserve set. Each stretch is held against the four simpler things at the survivors\' own hold lengths, and the last column counts the survivors that clear all four there. Choosing a survivor above draws the same lines for it alone, with the tunings frozen on the set beside them: the survivor\'s captured trades on each stretch with no tuning and with the stop and sizing applied, in the scans\' dollars. Nothing here is priced and nothing counts as a look; a stretch with nothing to read says why.'],
      ['A survivor of a held set or a reserve set, without shopping',
        'The second panel takes one survivor of a Stage 4 record set forward, but only from a reserve set that passed on Reserve, or from a held set that passed on Held on a layout that keeps no reserve, held alone. A rule is never greenlighted: the set a press made on Held or Reserve is, so what was judged and what is frozen are one thing. Which survivor is a choice made without money: by depth, the setting nearest the middle of every range of the rule, the same idea as the widest region\'s centre; or a survivor you name, recorded as your pick. The frozen settings carry the way the members agree exactly as that survivor does, which no single number of votes expresses, and the record names the set, the verdict, the survivor and how it was chosen.'],
      ['Writing down a decision, not starting one',
        'Nothing here trades. It records that you decided to take one setting forward: who, when, why, and the exact settings frozen at that moment, together with the whole chain of runs that led to it.\n\nThe reason it exists: months later, when something is running on the Trade tab, the question is always "what was this based on, and did we check it?" — and the honest answer has to have been written at the time, not reconstructed afterwards. That is why the reason is required rather than optional.'],
    ],
    intro: 'Recording a decision to take one setting forward, with who decided, when, why, and the '
      + 'exact settings frozen at that moment. Nothing here starts trading. It writes down the decision '
      + 'so that later, when a setup is running on the Trade tab, there is a record of what it was based on.',
    controls: {
      gl4Set: {
        what: 'Which held set or reserve set to take a survivor from, from every one on this box, newest first, with the verdict it carries and, on a held set, whether its rule is held alone.',
        more: 'Choosing a set reads its footing only: whether its verdict stands, how many members its coin and shape were priced with, and every survivor with its distance from the middle of the rule. A set whose verdict is FAIL, a held set whose layout keeps a reserve, and a set that passed under another release line are each refused in words.',
      },
      gl4Pick: {
        what: 'Which survivor is taken forward. By depth is the setting nearest the middle of every range of the rule, chosen without looking at any money; naming one records it as your own pick.',
        more: 'Both ways are written on the record: which way, the survivor, and its distance. The money beside each survivor is shown so you know what you are choosing; the choice by depth never reads it.',
      },
      gl4Name: { what: 'What you want to see on screen for this configuration. Required.' },
      gl4Why: { what: 'Why this survivor is being taken forward. Required, and kept forever with the record.' },
      gl4Go: {
        what: 'Writes the record: the set, the verdict that stood, the survivor and how it was chosen, and the frozen settings with the way its members agree exactly as the survivor carries it. Does not start any trading.',
        more: 'It refuses a set cut on all units together, a coin read on its own, and a survivor whose trade shape the live executor cannot carry. What it writes appears on the Trade tab on both sides but cannot be activated until the live path speaks the stage engine\'s way of agreeing.',
      },
    },
  },
};
