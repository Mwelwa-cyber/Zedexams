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
| `typed-answer-keys.json` | the four types whose answer key is not `correctAnswer` — fill_blanks, matching, sequence, diagram_label |
| `objective-types.json` | tf, numeric, hotspot, and the legacy `fill` spelling |
| `text-answer-types.json` | the AI-marked family (essay, diagram) and the legacy `short` spelling, which is NOT in it |

A fixture is added when a real edge case is found, and the case it represents
is named in the table above. An unexplained fixture is a fixture nobody can
tell is still needed.

**Coverage is now a build failure, not a discipline.** `scripts/replay/fixtureCoverage.test.js`
derives the universe from `QUESTION_TYPES` — the shared package's registry — and fails if any
canonical type has no fixture. A fourteenth type fails it the moment it is declared, before
anything can be built on the assumption that it is covered. There is no exemption list, because
every type in the registry is reachable: `coerceQuestion` accepts each one, so a stored quiz can
hold one, so a learner can meet one.

`typed-answer-keys.json` is the one that earned its place after the fact. Every
other fixture is MCQ, so all of them passed whether or not the normaliser
carried `statements`, `diagramLabels`, `matchingLeft` and `sequenceItems` — and
it did not. Four question types would have marked as a silent zero through the
engine behind a green comparison. A fixture set that agrees with itself about
which shapes matter is the one blind spot a comparison harness cannot report.
