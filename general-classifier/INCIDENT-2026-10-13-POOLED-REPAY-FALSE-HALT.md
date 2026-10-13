# False halt on the final short close — occurrence, cause, fix

**Written to be handed to another instance of this system.** It assumes no
knowledge of the conversation it came out of. Everything below is read from the
live journal and the running code, not reconstructed from memory.

---

## 1. The occurrence

`2026-10-13T18:20:05Z`, isolated-margin LTCUSDT, live book
`setup-mszpzts4-3577f3`:

```
HALT_SET  source=executor
  reason: short close for 2026-10-04T00:00:00.000Z repaid only 0.140679 of
          leg 0.151000 — borrow 0.000000 still outstanding and accruing interest
```

The message contradicts itself. It reports a shortfall and `borrow 0.000000` in
the same sentence.

**The account was clean.** Immediately after, and on every cycle since:

| Reading | Value |
|---|---|
| `borrowed` | 0.0 |
| `short_nominal` | 0 |
| `RECONCILE_OK` | every cycle, before and after |
| `margin_level` | 999.0 (the no-debt value) |
| Final-leg assertion | passed (`resid < QTY_STEP`) |

The close itself was correct and booked `pnl +0.697`.

**Cost.** Entries blocked from 18:20:05 until the owner cleared it at
`19:40:59Z` (`HALT_CLEAR`, source owner, authenticated). Exits are never
halted, so no position was stranded. One entry opportunity was at risk; none
was actually missed, because the next call was not due until 01:00.

---

## 2. The setting that makes it possible

One isolated-margin wallet holds **one pooled loan** backing **every open
short**. This book opens one clip per day and holds 137 hours, so four or five
shorts overlap routinely.

Each partial close buys back its own leg plus a fee buffer, **rounded UP to the
lot step** (`QTY_STEP = 0.001`). Rounding up means each close repays a little
more than its own share. The surplus stays in the pool.

So the pooled debt drifts **below** the journal's nominal, monotonically, about
one lot step per partial close. Measured on the live book, `borrowed` minus
`short_nominal`:

| Date | Gap |
|---|---|
| 27 Sep | −0.0007 |
| 28 Sep | −0.0022 |
| 2 Oct | −0.0039 |
| 3 Oct | −0.0048 |
| 4 Oct | −0.0056 |
| 6 Oct | −0.0062 |
| 8 Oct | −0.0071 |
| 13 Oct | −0.0103 |

Nothing resets it. It only moves on a partial close (confirmed: on 5 Oct, a day
with no close, it did not move).

---

## 3. The defect

In `executor/mx_executor.py`, in the short branch of the exit loop, a residual
assertion runs after every short close. It read:

```python
resid = pbx.borrowed_base()
if debt is not None and resid is not None:
    repaid = debt - resid
    if repaid < p["qty"] * (1 - RESIDUAL_REPAY_TOL_FRAC):
        set_halt(...)
```

`RESIDUAL_REPAY_TOL_FRAC = 0.05`.

It compares the repayment against **the leg's nominal**. But what *can* be
repaid is **the pooled debt outstanding**. On a pooled wallet those are
different numbers, and the difference is exactly the accumulated surplus above.

The final close clears the whole pool and still looks short against its own
nominal:

```
repaid    debt − resid = 0.140679 − 0.000000 = 0.140679
required  leg × (1 − 0.05) = 0.151 × 0.95   = 0.143450
shortfall                                      0.002771
```

**This is arithmetic, not bad luck.** Once the accumulated surplus exceeds
`RESIDUAL_REPAY_TOL_FRAC × leg` (here 0.00755) the final close *cannot* pass.
At roughly one lot step per close that takes about ten closes. The gap was
already −0.0071 on 8 October.

Note it is specifically the **final** close that trips. Earlier closes are
sized from their own leg and repay their own share plus the rounding, so
`repaid ≈ leg` and they pass. Only the last leg is sized from the pool, and only
the last leg has the whole accumulated surplus sitting against it.

---

## 4. The fix

Measure against what was **owed**, not against the nominal:

```python
resid = pbx.borrowed_base()
if debt is not None and resid is not None:
    repaid = debt - resid
    owed = min(p["qty"], debt)
    if repaid < owed * (1 - RESIDUAL_REPAY_TOL_FRAC):
        set_halt("executor", f"short close for {p['chunk_start']} repaid "
                 f"only {repaid:.6f} of the {owed:.6f} owed (leg "
                 f"{p['qty']:.6f}) — borrow {resid:.6f} still "
                 "outstanding and accruing interest")
```

One line of logic: `owed = min(p["qty"], debt)`. You cannot repay more than is
owed.

**The faults the check exists for still fire.**

- A repay that silently fails leaves `resid` unchanged, so `repaid ≈ 0`, which
  is far below `owed`. Halts.
- An outsized fee eating the received quantity leaves `repaid` materially below
  `owed`. Halts.

---

## 5. Coverage this moves, and where it now lives

Clamping to `debt` means this assertion can no longer notice that **there was no
debt to begin with** — the 2026-08-24 fault where a short borrowed nothing and
sold a concurrent long's inventory.

That case stays covered, deliberately, in two other places:

1. A short now takes out its **own explicit loan** for its full quantity before
   selling (`borrow_base`, `side_effect=NO_SIDE_EFFECT` on the sell), so debt
   equals nominal at open by construction.
2. The **reconcile** independently compares exchange borrow against the
   journal's shorts every cycle and halts when borrow sits below nominal beyond
   a dust-sized tolerance.

Keep that division explicit. Do not re-add a nominal comparison here to
"restore" coverage that lives elsewhere.

---

## 6. Tests

Three, in `executor/test_mx_executor.py`. The first was watched failing against
the unclamped check and reproduces the production numbers exactly.

| Test | Asserts |
|---|---|
| `test_final_close_clearing_a_pool_below_nominal_does_not_halt` | leg 0.151, pooled debt 0.140679, close clears it: `EXIT_FILL` present, no `HALT_SET`, pool below one lot step |
| `test_a_repay_that_does_not_move_the_debt_still_halts` | `repay_disabled`: buy fills, loan untouched → `HALT_SET` |
| `test_a_partial_repay_well_under_what_was_owed_still_halts` | `repay_fraction=0.5` → `HALT_SET` |

The mock gained two fault knobs, `repay_disabled` and `repay_fraction`, which
model a repay that fills at the venue but does not reduce the loan as it should.

---

## 7. How to confirm the same defect in another deployment

All read-only.

1. Does the venue pool the loan across shorts? If each short has its own loan,
   this defect does not apply.
2. Do partial closes round the buy quantity **up** to a lot step? If so the
   drift exists.
3. In the journal, compare `borrowed` against `short_nominal` on `RECONCILE_OK`
   lines over several weeks. A monotonic negative gap growing about one lot step
   per short close is the signature.
4. Compare that gap against `RESIDUAL_REPAY_TOL_FRAC × (smallest open leg)`. If
   the gap is larger, the next final-short close will false-halt.
5. The halt itself is unmistakable: it names a shortfall and a zero (or
   near-zero) outstanding borrow in one sentence.

---

## 8. A process note worth carrying across

This drift was found and tracked correctly from 2 October. Every close was
measured and recorded, and it was stated in writing that nothing resets it.

It was then watched against the **reconcile** tolerance — about 0.088, some
eighty closes away — and reported as having ample headroom. The check it
actually tripped needed 5% of a single leg, about 0.0076, which it had already
passed on 8 October while being called comfortable.

Right number, wrong threshold, confident report. When a quantity is drifting,
enumerate **every** check that reads it and quote headroom against the nearest
limit, or do not quote headroom at all.

Recorded as QC-REGISTER items 192 (the defect) and 193 (the process failure) on
the `vps-access` branch.

---

## 9. Provenance

| | |
|---|---|
| Fix commit | `928d335` on `general-classifier` |
| Carrier mirror | `b417a65` on `vps-access` |
| Executor sha256 | `271735c06267a1e2d6705d21590c181392acf1e58ebcf438953e3cf7b67c1805` |
| Executor sha256 before the fix | `65d077efe8ec00c3286e390c5f4448f5101731a1677819291a11dbb7799c9d80` |
| Suite | 140/140 |
