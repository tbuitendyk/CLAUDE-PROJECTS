# Funnel build — decision record

One line per non-obvious choice, committed with the work it belongs to
(RULE SIX). The design itself is `FUNNEL-DESIGN.md`; this is only the choices
made while building it that the design did not already settle.

## Step 1 — plateau axes from the caller

1. **The axis lists DEFAULT to the library's own constants** rather than becoming
   required arguments. The old sweep calls `widestRegion(allCells, {minTrades})`
   and had to keep working byte-identically; making the axes mandatory would have
   forced a change at a call site this work has no business touching.
2. **The centre is built from the axis lists, not typed out.** With the defaults
   that produces exactly the key set it has always produced, which is what lets
   `lib/live/greenlight.js:74` go on spreading it over the row unchanged.
3. **A dial named on BOTH lists throws.** It would slice the space and be walked
   along it at the same time — nonsense that returns a plausible number.
4. **The reading carries the axes it was cut on.** A region size is meaningless
   without knowing what "next to" meant, and the whole point of this step is that
   it is no longer a constant.
5. **A bad axis list is refused, not coerced.** A string, an empty list or a list
   with a hole in it would each cut a region on axes nobody chose.

## Step 2 — the sealed window and the board-noise stamp

6. **The sealed window needed no migration and no new stored field.** The design
   said stage 3 must stamp it and a migration must backfill it. Both were wrong:
   stage 1 already writes `reserve` on every record and stage 2 copies it
   forward, and a stage 3 set's units ARE its parent's records. Verified against
   a real record on this box — `s1-mtdzekjr-9` carries
   `{"chunks":50,"fromTs":1780790400000}`. It is a read.
7. **It resolves through `stage3UnitsFor` with the set's own stored carry**,
   which is the same resolver and the same argument the launch used — so it
   cannot return a different set of units than the ones that were priced. A
   re-derivation from `unitChunks` would agree only while the price files have
   not moved.
8. **A partly sealed set is not sealed.** One unit without a reserve means the
   one-touch grade covers fewer coins than the board, so the verdict is false
   and names the count rather than reporting a seal with a footnote.
9. **The board-noise stamp's wording carries no era.** "Predates X" would tell a
   reader there are two kinds of set, which is the same defect wearing a
   sentence. One wording that is true of a set written today and one written in
   July, and a test that fails on date-flavoured words.
10. **The stamp refuses while a stage job is going** rather than writing beside a
    running writer, and says it refused rather than reporting nothing to do.
11. **The pure parts are split out** (`sealedFromUnits`, `needsBoardNullStamp`)
    so the verdicts are testable without writing anything into the owner's
    record store.

## Step 3a — every trade settles through one book

12. **One settle point, not seven.** The money was accumulated at seven separate
    sites — six in `simBracket`'s rail walk and time exit, one in `simMarket`.
    Each new number would have had to be added at all seven with nothing to
    catch the one that was missed, which is precisely how the numbers went
    missing in the first place. A test pins the count at seven and forbids any
    bare `pnl +=` outside the book.
13. **Three of those seven never counted a win.** Correct — a both-rails bar is
    priced at its worst case and that is always a loss — but correct by
    arithmetic nobody had written down. Routing them through the book makes it a
    rule instead of a coincidence, and changes no number.
14. **Drawdown is measured from zero, not from the first trade.** The book starts
    flat. A run that opens with a £7 loss is £7 down, not level.
15. **Nothing traded is not zero-everything.** `worstTrade` and `bestTrade` come
    back `null` when no trade happened, because a worst trade that never
    occurred must not read as a break-even one.
16. **The thirds are cut on the PERIOD index, not the trade index.** A window
    whose money all arrived in its first month has to read that way; cutting by
    trade would spread them evenly and destroy the one reading a single-coin
    probe depends on.
17. **The pricing returns everything on ONE path and `storedRecordOf` decides
    what reaches disk.** The alternative — a flag that makes the pass return
    more when asked — is two code paths that can drift. Both writers now project
    through it, because a spread at either would have put the analysis block on
    5.2 million records.
