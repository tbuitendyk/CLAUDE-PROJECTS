# Long loop, 2026-09-25 — the new trading engine: Paper Books first, live-ready

Granted with `LOOP NOW!` (2026-09-25, owner shutting down for the night):
"everything is good as proposed. i'm shutting down for the night -- you need to
loop this until complete, including access to the trading account as per the
general classifier stuff that's on this same server for checking the platform
and test orders, etc. you need to continue working without my supervision as far
as possible."

## What the owner asked for (the read-back, approved item by item)

Goal: paper trade the greenlight "Manual pick: Better performance: S4-LTC w/
DOGE & LINK - daily-4d - cs 0.55-1.45" (gl-mugm5ktw-6781fc) on Paper Books, on
a path that is identical to Live Trading and ready to go live.

1. The engine carries out whatever the greenlighted configuration says (entry,
   gate, d, t, trail, arm, the field's sizes, the conviction multipliers) --
   nothing written for one pick. For the manual pick: LTCUSDT, one decision a
   day; when the committee speaks two levels 3.75% either side of the entry
   price (d 0.75 x band 5%), either may open it (gate active); the other level
   is the stop; after 2.5% in its favour (arm 0.5) the stop follows the best
   price 7.5% behind (trail 1.5); closed at 65 hours. Size = clip x the field's
   size x the conviction multiplier by agreeing members. Owner: "i expect we
   will want to bracket the current price with two limit orders" -- orders that
   wait for a level are stop-type orders (or the engine watches and sends);
   the probe settles which.
2. Paper Books and Live Trading are one path: same decision, same engine, same
   price following, stop moves, closes, live figures. Every exchange call
   carries its mode (simulated / live) as a parameter; a call without one is
   refused and never falls through to live.
3. Two boxes: the web box decides and draws the Trade tab; the trading box (AWS,
   Mexico City) runs the engine non-stop with a live price feed and sends every
   event back as it happens. Not fitted to the old 5- and 10-minute timings.
4. One exchange interface; one module per venue stating what it does natively;
   what a venue cannot do, the engine does. Binance first.
5. The simulated exchange, most accurate possible: every printed trade and the
   order book as live feeds; a waiting order wakes when a printed trade reaches
   its level; a market fill walks the live book for its size; a limit fills only
   if the market trades at or better; the measured delay from the probe applied;
   the account's own fee and the live hourly borrowing rate for shorts; the
   venue's own steps and minimums; a simulated wallet with the margin arithmetic;
   every fill records what it filled against. No practice platform, ever.
6. Setup: Account ("Where this account trades") holds the exchange side --
   accounts, keys (present / missing only), fee, pairs. Compute ("Where each
   part runs") holds the engine side -- where it is, how it is reached, whether
   it answers, which engine it runs, whether real orders are on, the live link,
   and the presses to send it the engine and run the probe. Nothing about the
   link stays written into code.
7. Keys, built to sell: entered once on Setup > Account, stored encrypted on the
   trading box, never kept by the web box, never shown, logged or recorded;
   trade-only, withdrawals off, locked to the trading box's address; one trading
   account per setup; each customer's keys theirs alone; replace or remove by a
   press; every use recorded.
8. A probe on the live platform first (orders far from the price, placed and
   cancelled) to learn what isolated margin really accepts and how fast.
9. `Activate paper` takes the breakout shape once the checks pass; `Activate
   real` keeps refusing it until the live side is built, probed and the owner
   switches it on.
10. Checks: fed the lab's hourly prices, the engine reproduces the lab's trades
    for the pick to the cent; on live prices the gap to the lab is measured and
    shown, never hidden.

And (c): a NEW engine beside the old one. The existing order program on the
trading box -- trading real money for a live LTCUSDT setup (4 positions open at
07:35 UTC) -- is not touched: not its file, timers, record of fills, env file or
master switch.

Stages, each deployed as soon as it is ready: A the engine on the trading box,
the simulated exchange, its entry on Setup > Compute, the live link back; B the
rules driven by the configuration, Paper Books figures, `Activate paper`; C the
Binance module, the key store, keys on Setup > Account, the probe; D live orders
from what the probe shows, and `Activate real` (built, never switched on here).

## What stops everything, loop or not

- Real money: nothing here switches real orders on for the new engine, and
  nothing touches the old engine or the live setup's wallet in a way that could
  change what it does. The owner presses `Activate paper` and `Activate real`.
- Anything that cannot be undone: no deleting live data, no rewriting pushed
  history, no creating or changing exchange keys.
- The probe's orders (the owner's explicit grant: "access to the trading account
  ... for checking the platform and test orders"): only orders that cannot fill
  (triggers and limits at least 30% from the price), the smallest size the
  exchange accepts, buying side only (they lock USDT, never the LTC the live
  setup's positions stand on), cancelled within seconds, placed only when the old
  engine is not due to run, and only after reading that the old engine's checks
  ignore an order it did not place. If any of that cannot be made true, the order
  tests are PARKED with the reason and only reads run.

## Success rules, written before any number exists

- S1. The old engine is untouched: its program file keeps sha256 65d077efe8ec00c3,
  and nothing this loop ships writes its timers, env file, master switch or record
  of fills. Checked before and after every deploy to the trading box.
- S2. One path: the engine's order logic has no branch on mode; the mode chooses
  only the exchange module. The same plan on the same scripted prices through the
  simulated module and through a recording stand-in for the live module gives the
  same sequence of order calls and the same states.
- S3. To the cent: fed the lab's hourly candles for LTCUSDT, touching each hour's
  prices in the lab's worst-case order and filling exactly at the level with the
  lab's fee, the engine's breakout logic gives the lab simulator's trades for the
  manual pick's configuration on the same calls: same entries, stops, exits and
  money to the cent.
- S4. Sizing: a plan's size is clip x field size x multiplier(agreeing members)
  with the frozen ladder, exactly as Held prices the same trade.
- S5. Mode: a call without a mode is refused; a live call is refused unless the
  setup is on Live Trading and real orders are switched on for the engine; this
  loop never switches them on.
- S6. Simulated fills: every fill records what it filled against; a level fill is
  at the first printed trade at or past the level; a market fill walks the
  recorded book for its size; fees are the account's; a short accrues borrowing
  by the hour at the rate read live.
- S7. The engine's record (where it is, how it is reached, which engine it runs)
  is created and edited on Setup > Compute; none of it lives only in code.
- S8. No key appears in any record, log, answer or page; the key store on the
  trading box is encrypted at rest and readable only by the engine.
- S9. Events reach the web box within seconds of happening (measured and written
  down), and Paper Books' figures move without a reload.
- S10. The probe reports, per order kind: accepted or refused with the exchange's
  words; for accepted ones, time to place and time to cancel; and the wallet
  before and after, equal. A fill is never expected; one would stop the probe and
  be reported first.
- S11. The manual pick can be activated on Paper Books and the engine holds its
  plan; `Activate real` refuses it.
- S12. Setups on the old engine behave exactly as before; only a setup that names
  the new engine is sent to it.

Predictions, before the probe: stop-limit and stop-market orders on isolated
margin are accepted; Binance's own trailing stop is refused on isolated margin
(the documentation lists it only for spot); linked orders where one cancels the
other are accepted; placing and cancelling take well under a second each from
Mexico City.

## Decisions

- D1. The engine watches the price and sends a market order the moment a
  printed trade reaches a level, on every venue; a venue module may later hold
  such an order natively behind the same action, chosen from what the probe
  shows (owner's "two limit orders": an order that waits for a level is a
  stop-type order; a plain limit on the wrong side fills at once).
- D2. The trail moves once an hour, exactly as the lab bars it: the stop is
  checked against every printed price, and at the end of each whole hour after
  the entry hour that hour's best price is taken and the stop ratcheted. What
  trades is what was measured; S3 holds it to the cent for five kinds of trade,
  including a trail armed at once (arm 0), which a per-print trail would not match.
- D3. The engine is Node with no packages at all (its own websocket client and
  HTTPS request on Node's TLS): nothing reaches the trading box that was not
  written here.
- D4. A plan whose entry hour began before it reached the engine is armed on
  that hour's opening price (asked of the exchange) unless the price has
  already reached a level since, in which case it is skipped and the gap
  written down; a market entry more than five minutes late is skipped. Never
  entered late as though it were the same trade.
- D5. Live figures of open positions (price now, money open, stop, best price)
  are sent to followers as they change and are not written to the record; the
  record holds every event that changes something.
- D6. S6 is read as the owner's item 5 words (D17 of the read-back): an order
  wakes when a printed trade reaches its level, and the market fill then walks
  the live book for its size. A book that cannot fill the whole size in its top
  20 levels refuses the order rather than inventing a price.
- D7. Borrowing on a paper short is charged by the hour at the rate the venue
  quotes; until the venue module has read it (it needs the account's key), each
  hour is recorded as unpriced, and the screen says so. Never a guessed rate.
- D8. The engine starts with real orders OFF and this release refuses a
  config asking for them at start: there is no live module in it yet.

## Parked

- P1 (08:10 UTC). Installing the engine on the trading box -- node from
  Debian's packages, a system user of its own, its code in /opt/uts-engine, a
  systemd service, and the before/after fingerprints of the old order program
  (S1) -- was refused by the session's permission layer ("Blocked by
  classifier"). Everything that does not need it continues: the web box side,
  Setup, the producer, the tests. The owner decides: run the deploy, or allow it.
