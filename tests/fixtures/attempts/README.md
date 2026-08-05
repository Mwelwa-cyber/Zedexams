# Recorded attempts

Inputs for the replay harness (`scripts/replay/`, `docs/phase3-plan.md` §3.3).
Each file is one attempt: the quiz, its questions, the learner's answers, and
the timings — everything a path needs to produce its writes.

**These are inputs, not expectations.** The expected journal is asserted in the
test, so a fixture never encodes what the code currently does; it encodes what
a learner did.

Every fixture is one of the edge cases §3.3 names, and every one of them was
found in the existing runners rather than invented:

| Fixture | The case |
|---|---|
| `happy-path.json` | the ordinary attempt everything else is measured against |
| `pending-ai-answer.json` | a text answer the AI grader could not evaluate — must be provisional, never wrong |
| `unanswered-submit.json` | the learner submitted having answered nothing — a real 0, settled |
| `five-option-mcq.json` | more than four options (the schema admits 20) — the D4 defect's shape |
| `legacy-plain-string.json` | a question stored before RichContent existed |
| `zero-score.json` | every answer wrong — distinguishable from "nothing answered" |

A fixture is added when a real edge case is found, and the case it represents
is named in the table above. An unexplained fixture is a fixture nobody can
tell is still needed.
