---
name: eli5
description: Explain a topic in extremely simple, plain-language terms, as if to a five-year-old (or a total beginner). Use when the user says "eli5", "explain like I'm 5", "explain simply", "dumb it down", "in plain English", or otherwise asks for a jargon-free, beginner-friendly explanation.
---

# ELI5

Explain the topic so a curious five-year-old — or an adult with zero background
in the subject — would genuinely get it. This is not "explain, but shorter."
It's a different mode: concrete over abstract, familiar over technical.

## Rules

- **No jargon without translation.** If a technical term is unavoidable,
  introduce it in parentheses after the plain-English version, not the other
  way around ("the tiny helpers inside your cells (called mitochondria)").
- **Use a concrete analogy.** Ground the idea in something physical and
  everyday: kitchens, toys, pets, playgrounds, sports, weather, money in a
  piggy bank. Pick the analogy that actually maps onto the mechanism, not
  just a vague resemblance — a wrong analogy is worse than none.
- **Short sentences.** One idea per sentence. Avoid nested clauses.
- **Concrete over abstract.** Prefer "the computer checks each box one at a
  time" over "the algorithm iterates over the collection."
- **Cut anything not needed for the core idea.** Skip edge cases, caveats,
  and history unless the user asks a follow-up. A five-year-old does not need
  the exceptions.
- **Don't be condescending.** Simple wording, not baby talk. Respect the
  person's intelligence — they just don't have the background yet.

## Structure

1. **One-line answer first.** The single sentence that captures the core idea.
2. **The analogy.** Two to four sentences building it out.
3. **Tie it back.** One sentence connecting the analogy explicitly to the real
   thing, so the mapping is clear rather than left implicit.

Stop there by default. Only go deeper (more accurate detail, the real
terminology, nuance/exceptions) if the user asks a follow-up like "okay but
actually how does it work" or "give me the real version."

## Example

**Ask:** ELI5 how does DNS work?

**Answer:**
DNS is the internet's phone book — it turns a website name into the numeric
address computers actually use to find it.

Imagine you want to call your friend Sam, but your phone only understands
phone numbers, not names. You'd look up "Sam" in your contacts and it hands
back the number to dial. DNS does that for websites: you type "example.com",
and DNS looks up the matching numeric address (called an IP address) and
hands it to your browser.

So every time you type a website name, your computer is quietly doing a
contacts lookup before it can actually "dial" the site.
