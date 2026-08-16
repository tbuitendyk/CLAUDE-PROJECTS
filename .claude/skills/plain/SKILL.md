---
name: plain
description: Restate the assistant's last response in plain, jargon-free human language. Use when the user says "/plain", "plain english", "restate that simply", "cut the jargon", or otherwise asks for the previous answer in plainer terms.
---

Restate the assistant's most recent response (the one immediately before this
skill was invoked) in plain human language, without jargon.

1. **Summary first.** Open with a very short summary — 2 to 4 bullet points —
   of the most important points from that response. Nothing else above it.
2. **Then the restated response.** Rewrite the response itself in plain
   language: no unexplained jargon or technical shorthand, no acronyms
   without a plain gloss the first time they appear, short direct sentences.
   Keep the actual facts, numbers, decisions, and conclusions intact — only
   the wording and structure changes, not the substance.
3. **Length budget.** The summary plus the restated response together must
   not exceed roughly 20% of the length of the original response being
   restated. Cut ruthlessly: drop caveats, asides, and repeated framing:
   keep only what the user needs to know.

Do not re-answer the user's original question from scratch or add new
information that wasn't in the last response — this skill only restates and
compresses what was already said. If there is no prior assistant response in
the conversation to restate, say so plainly instead of inventing one.
