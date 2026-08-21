# The adversarial suite

Run it with:

```
npm run test:adversarial
```

## What it is for

The ordinary tests (`npm test`) ask *does this work*. This one asks the
opposite question:

> Given something broken, wrong, hostile or half-written — what does the system
> **show the owner**?

That question matters more than the first one, because of how this system
fails. A crash is loud and safe: nothing happened, and everyone knows it. A
number is dangerous. If a total is computed from a month of candles that is
missing three days, it does not look wrong. It looks like a total. It gets
acted on.

So the scoring here is deliberately upside down:

| what the system does with bad input | verdict |
|---|---|
| refuses it | **pass** |
| stops with an error | **pass** |
| accepts it but says so | **pass** |
| accepts it silently and produces an ordinary-looking answer | **FAIL** |

## What it attacks

Nine surfaces, each in its own file:

1. **`attack-http.js` — the front door.** Every address the system answers on,
   hit with nothing, the wrong shape, the wrong type, a name four thousand
   characters long, a path trying to climb out of the folder, a body that is
   not really JSON, and a body larger than the stated limit. The address list
   is **read out of the code on every run**, not typed into the test, so an
   address added tomorrow is attacked tomorrow.

   The sweep runs **twice** — once against a system holding nothing, once
   against one holding real candles, a real setup and a real journal, all
   written through the system's own code (`seed.js`). Every run prints how many
   plain addresses had more to say on the second pass; at the time of writing
   that is **4 of 23**, so the seeded pass reaches somewhat further than the
   empty one and not dramatically so. The number is printed rather than claimed
   because a second pass that reaches nothing new is not extra coverage.

2. **`attack-schema.js` — the shape of what is stored.** Configurations with
   impossible numbers in them, training windows frozen at an instant that does
   not exist, names that are objects, and journal files with a line cut in half
   by a crash.

3. **`attack-candles.js` — the market data.** Months that stop a third of the
   way through, months with holes, months whose candles are duplicated, out of
   order, priced at zero or priced below zero. This is the foundation every
   other number stands on.

4. **`attack-interface.js` — the screens.** The real formatting helpers are
   lifted out of the shipped pages and fed the values a broken record produces,
   to see what the owner would actually read. It also checks the two pages
   agree with each other, and counts every place the Trade page asks whether it
   is showing Paper Books or Live Trading — the one remaining way those two can
   drift apart (RULE TWO).

5. **`attack-invariants.js` — the promises.** No artificial intelligence
   anywhere in what ships (RULE SEVEN), no outbound address other than the
   public market-data service, nothing rolling dice in a path that decides a
   trade, the same inputs giving the same answer twice over, and paper money
   never folded into real money.

6. **`attack-storeddata.js` — the data that is really there.** Everything above
   spoils records on purpose. This one does the opposite: it opens the data
   that **actually exists** and asks whether any of it is already in one of
   those states — files that will not parse, candle months short against the
   hours the month has, holes, duplicated hours, prices that are not numbers or
   are at or below zero, candles whose low is above their high, stored setups
   that no longer pass the system's own configuration check, journals with torn
   lines, and files on disk that nothing in the code ever mentions (RULE FIVE).

   It is **read only** — it opens files and never writes, moves or deletes one.
   Point it at any data folder, including the one on the box:

   ```
   node tests/adversarial/run.js --only=attack-storeddata --data=/opt/ultimate-trading-system/data
   ```

7. **`attack-controls.js` — the controls.** Every address a page calls is
   matched against the addresses the server really answers, **including the ones
   the pages build by joining pieces together** — which is exactly the set the
   ordinary endpoint check skips, and so the set most likely to have gone stale.
   It also looks for dropdowns whose choices are written into the page rather
   than coming from the system (RULE FIVE), and says so more sharply when the
   system already publishes that list and the page is keeping a second copy.

8. **`attack-scoring.js` — the measuring stick.** Everything above attacks the
   code; this attacks the **score**. Could this number be got with no skill at
   all — by always answering the commonest outcome, or by flipping a coin sixty
   times over? Can it see an effect that is definitely there, or is it blind?
   Does it report a headline rate off a handful of cases? And what does it do
   when the two things being compared are not comparable — fewer answers than
   questions, answers in the wrong form, a period in which nothing happened?

9. **`attack-engine.js` — the money arithmetic.** The last few functions
   between a stored record and a figure on screen: which way a trade is facing,
   what a committee decided, the middle of a list, and whether the cost the
   threshold-tuner assumes matches the cost the live path declares. Every case
   here came from an independent attacking session and was reproduced by hand
   before being pinned.

## Safety

Nothing here touches the owner's data or the running services.

- Every attack that needs a server or a data folder gets its **own throwaway
  copy of the code with an empty data folder**, made fresh and deleted after.
- The suite works on port **8731**. Ports 8088, 8091, 8092, 8093 and 8094 are
  refused outright in `harness.js` — 8093 is the previous generation's live
  trading service and 8094 is this one.
- Two addresses reach the public internet to fetch market data. They are left
  out on purpose, and the run says so out loud every time rather than quietly
  counting them as covered.
- Many addresses still answer "nothing here" even on the seeded pass, because
  the sweep deliberately asks for records that do not exist. Their deeper
  workings are covered by attacks 2, 3, 5 and 6 instead, which call the code
  directly rather than through an address.

## Where the findings came from

Two sources, and the difference matters.

Most of `baseline.json` was found by the attacks in this directory. A separate
attacking session — 73 agents, no access to this harness — went at the same
system independently and reproduced 67 findings under challenge, including 7 it
rated as blockers. It reached places these attacks did not, because it attacked
the arithmetic with knowledge of what the numbers are supposed to mean rather
than only feeding them rubbish from outside.

Its full record is kept beside this one at
`independent-attack-2026-08-21.json`. The two most serious of its findings were
reproduced by hand and are now pinned here as permanent tests — the Origin
sweep in `attack-http.js`, and the whole of `attack-engine.js`. The rest are
written up for the owner in `DEFECTS.md` section 6.

## Known findings

Real findings that have been read and are **not being fixed today** live in
`baseline.json`, each with the reason written down in plain language. The suite
passes while only those come back, and fails the moment something **new**
appears.

That list is not a pass. It is a list of known faults with a decision still
outstanding on each one. The same list is written up for the owner in
`DEFECTS.md`.

To add today's findings to that list after reading them:

```
npm run test:adversarial -- --accept
```

Every new entry is written with `NOT YET REVIEWED` in place of a reason, and
the run says how many are in that state — so accepting a finding without
reading it leaves a mark rather than disappearing.

To run one attack on its own:

```
npm run test:adversarial -- --only=attack-candles
```

## When a test here breaks

**A test that could not run is reported separately and is never a pass.** Five
of the attacks in this directory reported "nothing found" on their first
version because the test itself was wrong — a field name invented rather than
read, a control case that was never checked, a complaint-detector that counted
an ordinary reply as a complaint. Each of those read as a clean bill of health.

That is why several attacks now run a **control case first** — an honest month
of candles, one ordinary trade opened and closed — and stop with a loud
complaint about themselves if the control does not come out right, rather than
reporting a wall of findings built on a broken fixture.
