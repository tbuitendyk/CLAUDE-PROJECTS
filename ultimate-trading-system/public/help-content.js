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
// One notes box per section, so each record set on screen can be written on
// where it is shown.
const RUN_NOTES_CONTROLS = (() => {
  const out = {};
  for (const n of [1, 2, 3]) {
    out[`bNotes${n}`] = { what: `Your own notes on the stage ${n} record set — what you were trying, what it showed, what it cost.` };
    out[`bNotesSave${n}`] = {
      what: `Saves the notes onto the stage ${n} record set.`,
      more: 'Only works once that record set has finished; nothing can be written to one while it is still computing.',
    };
  }
  return out;
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
      swUni: { what: 'Which coins stage 1 scores. Leave it blank to use all of the ones held; write them separated by commas to narrow it down.' },
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
      swNull1: {
        what: 'How many shuffled companions make up each unit\'s null set. Each one is the same kept votes with their dates shuffled away, given the same forecast score — no training, ever.',
        more: 'The ordering IS the against-null-set result: beat its own null set, ties broken by lead over null set. The null set always feeds the pick. '
          + 'The same null set is dealt again at stage 2, for every member, and both stages read their tuning-slice $ against it too.',
      },
      swFee1: {
        what: 'The cost of one side of a trade, as a share of the position — the same box stage 3 has. Here it prices only the tuning-slice $ on Boards: each unit\'s own votes on the last quarter of its training window, one buy or sell per chunk in the direction they lean.',
        more: 'Nothing else at stage 1 costs anything; no trade shape and no decision exist here. Stage 2 inherits this fee, reads the stage 1 members\' tuning-slice $ again and refuses a unit whose figure differs from the parent\'s by a cent.',
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
      swDesc3: { what: 'Why this stage 3 exists. Kept on the record set.' },
      swGo3: { what: 'Starts stage 3 — pricing only, no training. The tables land on Boards.' },
      swStop: { what: 'Stops the stage run that is going. Everything already written stays; the set reports itself cancelled.' },
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
        + 'and prev holds the page showing, and a number past the end goes to the last page.\n\n'
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
      bPin3b: {
        what: 'Shows, in Table 3.B below, only the coins this setting was priced on — and picks this exact setting out of them.',
        more: 'It takes every other filter on Table 3.B off first, so none of the setting\'s coins can be hidden by '
          + 'something set earlier, and it brings that table onto the screen.\n\n'
          + 'The button you pressed stays bold until you press another one or press revert filters.\n\n'
          + 'Each of those coins opens its records straight away, and one record in each is highlighted: the eight '
          + 'records under a coin are the decision, band and 24/5 variants of the setting, and the highlighted one is '
          + 'the row of Table 3.A you actually pressed. So the averages above and the one setting you asked about are '
          + 'both in front of you.\n\n'
          + 'Every coin opens its own records separately, so a setting priced on many coins takes a moment.',
      },
      bRename: {
        what: 'Brings this record set\'s setting names up to date. Names only — nothing is priced again and no result moves.',
        more: 'A setting that weighs by voices is named with the share that decides whether two forecasts count as one '
          + 'voice, like "voices 75% +voice98". Some of this set\'s names do not carry that share.\n\n'
          + 'Nothing underneath differs. A record with no share stored on it reads as 98, so every result on this '
          + 'screen is the result it has always been.\n\n'
          + 'But the name is what a set is matched against when working out which of its own block\'s settings it does '
          + 'not hold. While the names disagree, those settings read as ones the set does not have — and pricing them '
          + 'would price every one of them a second time under its new name. So this comes first, and filling in the '
          + 'missing settings is not offered until it is done.\n\n'
          + 'The new records are written BESIDE the old ones and counted before anything is replaced, so an '
          + 'interruption leaves the set exactly as it was. The tables are worked out again afterwards.',
      },
      bDropUndeclared: {
        what: 'Deletes the settings this record set holds that its own block does not declare, and renumbers what is left.',
        more: 'A setting entered at market opens at the candle\'s open with no price levels, so the band cannot change one '
          + 'cent of what it does. Four settings that differ only by their band are therefore four copies of one trade, '
          + 'and the enumerator keeps one of them.\n\n'
          + 'A set priced before the enumerator worked that out holds all four. This deletes the copies.\n\n'
          + 'IT DELETES PRICED RECORDS AND CANNOT BE UNDONE without running the whole set again. Every way it could delete '
          + 'the wrong thing is a refusal instead: it will not run while any setting name is behind, because a name that '
          + 'is merely behind also reads as one the block does not declare; and a record is filed under its setting\'s '
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
      bMoneyGoS1: {
        what: 'Fills in the tuning-slice $ on a stage 1 set written before it existed: every unit\'s own votes priced on the tuning slice at the fee typed beside it, against the same null set. Written beside and swapped in after its checks, once, in the background.',
        more: 'Until it is filled in, the table cannot sort or carry by the tuning-slice $ and a stage 2 launch from this set refuses.',
      },
      bMoneyFeeS1: { what: 'The fee % each way the fill prices at. This set never declared one, so it is yours to type; it is stamped on the set.' },
      bMoneyGoS2: {
        what: 'Fills in the tuning-slice $ on a stage 2 set written before it existed, and reads every member on the row against the parent\'s null set in place of the stage 1 numbers copied onto it. Written beside and swapped in after its checks, once, in the background.',
      },
      bMoneyFeeS2: { what: 'The fee % each way the fill prices at. Use the parent\'s fee if it has one, or the stage 1 members\' figure will not match the parent\'s.' },
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
        what: 'Which coin-and-shape unit this walk is on. One rule per unit - ten units, ten rules.',
        more: 'A unit\'s board is its own records: one row per setting, every dial on it, its own test money and its own scrambled copies. The units are listed in the order of the parent\'s stage 2 table on Boards - its saved sort - and the walk opens on the first of them. Each unit keeps its own walk, so you can leave one half-done and come back. "all units together" is the blended table, one row per setting averaged over every unit; it hides what any one coin does and is kept only so the choice is yours.',
      },
      fAcross: {
        what: 'Applies the rule you have built on this unit to each of the other units\' records, one at a time, and reports how many come out positive.',
        more: 'This is the honest form of "does it hold elsewhere": the same rule on other coins and shapes, judged against each of their own scrambled copies. It is pressed rather than automatic because it reads every other unit\'s board, one at a time. The result is kept for this exact rule; change the rule and it asks again.',
      },
      fBar: {
        what: 'How many of the scrambled copies a value has to beat to count as real - to go bold, to be recommended, to be a square in a block. Eight of ten unless you change it.',
        more: 'With no forecast at all the real figure is one more draw among the copies, so it beats at least N of K about (K + 1 - N) in (K + 1) of the time: 9% at all ten, 27% at eight, 36% at seven, 55% at five. That rate is printed beside the box so you see what a bar buys, and the line at the top of step 1 says how many values clear the bar against how many would by chance. The bar is saved with this walk and written on the set it cuts, because a bold row means one thing under eight of ten and another under five.',
      },
      fTarget: {
        what: 'Roughly how many settings you are hoping to end up with. It is a guide, not a knife - nothing is ever trimmed to reach it.',
        more: 'It shows you the distance to the target at every step, so you can see whether you are narrowing too fast or too slowly while there is still time to change course. If your rule overshoots at the end, you are offered three ways to close the gap and told what each one costs.',
      },
      fDial: {
        what: 'Which setting to look at the shape of.',
        more: 'The list is every dial a sweep can vary, read from the engine rather than typed into this page, so it cannot quietly disagree with what your records actually hold.',
      },
      fMin: {
        what: 'The lowest value of this dial to keep.',
        more: 'Leave it blank for no lower limit. Keep a RANGE rather than a single value: one value far clear of its neighbours is what a shuffle produces, and taking it is the shopping this whole screen exists to avoid.',
      },
      fMax: {
        what: 'The highest value of this dial to keep. Blank means no upper limit.',
        more: 'Together with the lowest value this becomes one clause of the rule, and you can come back and change it at any point.',
      },
      fAddRange: {
        what: 'Adds the range you have chosen for this dial to the rule.',
        more: 'The survivor count at the top updates straight away. Nothing is written to disk until the last step.',
      },
      fA: {
        what: 'The first of two dials to lay against each other on a grid. The list is every dial the engine knows; it starts on the leading dial from step 1.',
        more: 'This is where you see things like a short distance only working when the holding time is long - which no ranked list can show you.',
      },
      fB: {
        what: 'The second dial for the grid. It starts on the second dial from step 1.',
        more: 'Each square shows the average for the settings that carry both values, and the second grid underneath shows the same square on the check - so a square that only looks good is told apart from one that beats the check.',
      },
      fKeepValues: {
        what: 'Keeps the ticked values of this dial and drops the rest. For dials whose values are words rather than numbers.',
        more: 'A word-valued dial cannot be kept as a range - there is no order to "active" and "directional". The ticked values become part of the rule, so a scrambled copy handed the same rule keeps the same values. The recommended values are ticked when you arrive; untick or tick as you see fit. Ticking none removes this dial from the rule.',
      },
      fKeepBlock: {
        what: 'Writes a range on BOTH dials at once from a block of squares on the grid, replacing whatever the rule held for those two dials.',
        more: 'Your own block if you pressed two corners; otherwise the recommended one - the largest rectangle of squares that beat the check and are not thin. Use it when the good part of one dial sits at particular values of the other; two ranges set one at a time cannot say that. The step records whether the two dials interact.',
      },
      fAccept4: {
        what: 'Records that you accepted the rule across these slices, and opens the next step.',
        more: 'What you accepted is written on the set in words - "accepted 4 of 6; the check managed 3 of 6" - as a mark, so anyone reading the set later can see how much of the board the rule held on and how much of that the check managed anyway. It is disabled when there is nothing to compare.',
      },
      fKeepRegion: {
        what: 'Replaces every range and value in the rule with the edges of the widest region.',
        more: 'The region is the widest run of neighbouring settings that all made money. Its edges on each dial ARE a rule - the most defensible narrowing this screen can make, because it was chosen by how many neighbours a setting has and never by its score. The count beside it says what keeping it would leave against your target.',
      },
      fFloor: {
        what: 'How many settings must sit behind a square before you trust it.',
        more: 'Squares below this are greyed and show their count instead of being hidden. A square built from two settings looks exactly like one built from two thousand, and it will often be the best-looking square on the grid precisely because small groups swing further. The line above the grid tells you how many squares each choice of floor would keep, so you are not picking the number blind.',
      },
      fGrid: {
        what: 'Reads the grid for the two dials and the floor you have set.',
        more: 'Nothing here changes the rule - this step is for looking.',
      },
      fRebuild: {
        what: 'Works out the numbers a sweep does not keep - the worst losing streak, the biggest single loss, how many trades won, and how much of the result rests on guessing what happened inside a single bar.',
        more: 'These are calculated during the sweep and thrown away, because keeping them for every one of half a million settings is not worth the disk. Here they are re-calculated for the handful you have narrowed to, which takes seconds. It also re-checks the money and the trade count against what the sweep stored: if they disagree, something underneath has changed and it says so rather than mixing numbers from two different runs.',
      },
      fDD: {
        what: 'The worst losing streak you are willing to accept, in dollars.',
        more: 'A total says nothing about the ride. A setting that made money by sitting through a loss deep enough to end you is not a setting you want, and the total looks identical either way.',
      },
      fTrades: {
        what: 'The fewest trades a setting must have made to stay in.',
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
