# The execution component

**This directory is the authoritative copy. The product owns its executor.**

## Why it moved here (owner, 2026-08-24)

This file places the account's real orders. It is the last mile of the whole
system — and until now it lived *only* on the `vps-access` branch, in a
different project, deployed to a box by a script the product could not see.

That is bad design, and the owner named it as such:

> Any and all dependencies on other non-Classifier / non-UTS code bases must be
> resolved — that's just bad design, to spread functionality all over the place
> into different projects and sessions and branches and then not tell ME, the
> PROJECT LEAD, and not have that obviously critical to successful rollout code
> NOT INCLUDED in the product we are trying to build.

The consequence was concrete, not theoretical. On 2026-08-24 a real trading
defect (a short that borrowed nothing and sold a concurrent long's coin) was
found and fixed *in the off-product copy*. The product shipped without the fix,
had no test that could see the fault, and the project lead was not told the
code lived somewhere else.

## The rule

- **This copy is the source of truth.** Changes are made here.
- **`vps-access` is a deployment mirror.** Its `executor/mx_executor.py` must be
  byte-identical to this one. It is a carrier, not an owner.
- **`EXECUTOR-SHA256` records the hash of the authoritative file.** Edit the
  executor and you must update that file in the same commit — `test-selfcontained.js`
  fails otherwise. The deploy can compare the same hash to prove the box is
  running these exact bytes and not a divergent copy.

At the time of writing, the recorded hash matches both this file and the hash
the deploy reported when it last shipped to the box, so all three agree.

## What runs where

The decision of *what* to trade — netting, dust, minimum sizes, whether a short
must borrow — belongs in `lib/live/tradeplan.js`, in the product, in JavaScript.
This executor is meant to become the thing that *carries out* a decided plan,
not the thing that invents it. The venue contract it must satisfy is declared,
enumerably, in `lib/live/venue.js`.
