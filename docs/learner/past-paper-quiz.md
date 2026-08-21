# The past-paper quiz

> Snapshot as of 2026-08-21 — verify before acting.

The learner-facing past-paper quiz: a cover, two modes, and one results
screen. Route: `/papers/:paperId/quiz`.

This document records the decisions that are not obvious from the code and the
places where the shipped thing differs from the design spec. The spec itself
(`ZedExams_PastPaperQuiz_Spec.md`, design locked 20 Aug 2026) is the source for
intent; where this file and the code disagree, the code is right and this file
is a bug.

---

## Where things live

```
src/features/papers/quiz/
  lib/          the decisions — modes, clock, marking, review grid, coaching,
                exam access, practice resume, the §7 event names. All pure,
                all node-tested (test:paper-quiz-core).
  components/   cover · runner · question card · coaching · sheets · results
  hooks/        usePaperQuizAttempt — the attempt's state, clock anchor, writes
  services/     the callable wrappers + the learner's own attempt history
  pages/        PaperQuizPage — three screens behind one route
  paperQuiz.css the `.pq` token block and every rule

functions/paperQuiz/
  paperQuizCore.js       identity, expiry, what a resumed attempt may be
  paperQuizFns.js        startAttempt / patchAttempt / submitAttempt /
                         abandonAttempt / savePracticeProgress
  explanationCore.js     §6's draft validation + the review state machine
  explanationPrompt.js   the drafter's prompt and tool schema
  explanationFns.js      draft / review / bulk-approve / the studio queue

functions/shared/paperQuiz/   ⚠️ SHARED WITH THE FRONTEND
  answerKey.js           the ONE resolver for which option is right
  explanationGate.js     §4.1's hard rule, enforced on both sides
  marking.js             stripForExam, markSubmission, the rollups
functions/shared/text/        richPlainText + textJunk (moved here so the
                              server can project a rich answer key identically)
```

---

## Three screens, one route

The cover, the runner and the results are `screen` state inside
`PaperQuizPage`, not three paths. A route change is a back button away from
ending an attempt, and the back button is exactly the accident §1 refuses to
punish.

## The clock is never counted down

`examClock.remainingSeconds` subtracts the current time from the attempt's
`expiresAtMs` on every tick and on every `visibilitychange`. There is no
decrementing counter anywhere, because a decrementing counter is what a reload
resets and a backgrounded tab stops.

`startAttempt` returns the server's `now` beside `expiresAt`; the offset
between it and the device's clock is measured once per attempt and applied to
every later reading. A Zambian phone minutes out of true would otherwise be
shown minutes of an exam it does not have.

## Only one thing ends an exam early

The exit sheet's **"Leave — don't count this"**. A refresh, a reload, a crash,
a battery death, a phone call, a rotate, a low-memory webview restart and an
accidental pull-to-refresh all arrive at the server as `startAttempt` on a
paper that already has a live attempt, and `core.decideStart` turns every one
of them into a resume.

An attempt whose window passed with no submission is **expired**, not deleted
and not left running: deleting loses real answers, and `in_progress` forever
blocks the paper.

## What the client is trusted with

The chosen option index, a flag list, and which paper. Nothing else is read
from any payload — not the score, not the correctness, not the elapsed time,
not the status. `paperQuizCore.test.js` pins that as a list of fields the
handlers must never grow.

### The residual, stated plainly

A published past-paper quiz's questions are **publicly readable** by
`firestore.rules` (the `publicAccess && isPublished` arm), because the
anonymous free preview and the SEO archive depend on it. So stripping the
answer key in `startAttempt` stops the **app** showing an answer early; it does
not stop a determined learner reading the collection directly.

That is the same threat model the rules already accept for every practice quiz.
What the strip does buy is real: the **clock**, the **record** and the **score**
are the server's, which is what a result has to be trustworthy about. Closing
the gap properly means closing the public read arm, which costs the anonymous
preview — a product decision, not a patch.

## §4.1's hard rule

If `explanationStatus !== 'approved'`, the coaching panel renders the correct
answer and nothing else. Enforced in `functions/shared/paperQuiz/
explanationGate.js` and applied on the **server**, before a question travels —
so an unapproved draft is not sitting in a network response on a child's device
waiting for a future component to render it.

It fails closed twice over: an unrecognised status reads as `missing`, and a
question with no field at all reads as `missing` rather than approved.

## Where the shipped thing differs from the spec

Three deliberate deviations, each with a reason:

1. **The data contract's collection names.** §4.1 describes the coaching fields
   on `papers/{paperId}/questions/{questionId}`. In this repo a paper links to
   a quiz (`pastPapers/{id}.quizId`) and the questions live at
   `quizzes/{quizId}/questions/{qid}`. The fields went there. §4.2's `attempts`
   is `paperQuizAttempts`, because `paperAttempts` already exists and is the
   timed **PDF-reading** practice — a different thing that records only elapsed
   seconds. §4.3's `learners/{uid}/topicStats/{topicId}` is the flat
   `learnerTopicStats/{uid}_{topicId}`, so a batch write is one path each.

2. **The free set bounds practice, not exam.** The spec does not say. An exam a
   learner may only sit a third of rehearses nothing — the clock would be
   wrong and the section breakdown would describe a fragment — so exam mode
   requires the whole paper (`lib/examAccess.js`) and a learner without it is
   offered practice rather than a truncated exam. Practice keeps today's free
   set and its inline offer exactly.

3. **Coaching field validation lives in the Zod schema, not in
   `firestore.rules`.** The rules' `validQuestionFields` carries a hard
   expression budget: a previous version validated ~35 fields and every scanned
   past-paper import began failing to save with an opaque permissions error
   once a real question crossed Firestore's 1000-expression cap. There is a
   clause-count guard for it. So the bounds are in
   `src/editor/schema/question.js` (which is `.strict()` and therefore had to
   learn these fields anyway), and the status enum is additionally pinned by
   the shared gate, which reads anything unrecognised as `missing`.

## The button reset outranked the design (fixed 2026-08-21)

`paperQuiz.css` opened with `.pq button { background: none; border: 0 }`. That
selector scores one class + one type, which outranks every single-class
component rule in the file — and almost every surface on these screens is a
`<button>`. So `.pq-cta`, `.pq-mode`, `.pq-opt`, `.pq-icon-btn`,
`.pq-flag-btn`, `.pq-nav-btn` and `.pq-cell` never painted the backgrounds and
borders they declare, and nothing reported it, because a declaration losing the
cascade is not an error.

On the ECZ Grade 7 English paper that meant: **"Start the exam" rendered
transparent with dark text**, under a coral glow cast by a fill that was never
painted; **the four answer options rendered as bare text rows** with no card
and no outline, so choosing one changed a background sitting behind a border of
zero width; "Flag" lost its pill; and the Strict-order row rendered flat beside
"Safe from reloads", which is the identical markup on a `<div>` and therefore
kept its card. Only the two-class rules survived, which is why the result read
as an inconsistent design rather than as breakage — `.pq-nav-btn.is-primary`
was indigo while `.pq-nav-btn` beside it was transparent, and the start button
was indigo in practice mode (`.pq-cta.is-secondary`) and transparent in exam
mode.

The reset is now `:where(.pq) :where(button)`, which is the form
`shared/styles/learnerTheme.css` has always used for `.lhx` — the design system
this file's header says it deliberately matches. A zero-specificity author rule
still beats the user-agent stylesheet, so the reset loses nothing.
`npm run test:css-reset-specificity` pins both systems.

Two smaller things went with it: `.pq-mode-h` and `.pq-mode-p` are `<span>`s
that never declared `display: block`, so the mode card read
"**Exam**Just like the real thing."; and the Paper cell printed
`paper.source` raw, so an ECZ paper was labelled **`ecz`** — it goes through
`paperSourceLabel` now, the registry the hub badge and the viewer already read.

## The cover is two columns on a desktop, and the runner is a sheet

Both screens were drawn for a phone and stayed phone-shaped at every width.

**The cover** ran one narrow column down the middle of the window, so a learner
on a laptop scrolled past a screenful of empty page to reach the button that
starts the exam, and the two mode cards — the one decision this screen exists
to ask for — sat below the fold. At `min-width: 1040px` it is a two-track grid
(`.pq-cover-grid`): left is what the paper **is** (title, the notepad's facts,
the best score so far), right is what the learner has to **decide** (mode,
settings, start). The DOM order is unchanged, so the reading order, the tab
order and the phone layout are exactly what they were, and the loading and
error states — which reuse `.pq-cover-inner` — do not carry the grid class and
are untouched.

Two mechanics worth keeping: the illustration moved inside `.pq-cover-inner`,
so its `right` offset is a plain distance from a column edge instead of a
`calc(50% - 380px)` tied by hand to a max-width it cannot see; and the column
is centred vertically by `margin: auto`, never by `justify-content: center`,
because an auto margin resolves to zero when there is no free space and
`.pq-cover` is `overflow: hidden` — centring a cover taller than the window
would clip its head with no way to scroll back to it.

**The runner** is `position: fixed; inset: 0`, so its chrome is nailed to the
viewport's own corners: on a tall window four options sat at the top and the
Next button sat hundreds of pixels below the last of them, with nothing in
between. `.pq-runner` is now the backdrop and `.pq-runner-sheet` is the page of
the paper inside it — on a phone the sheet simply fills the backdrop, so
nothing there changed. At `min-width: 1000px` **and `min-height: 1000px`** the
backdrop takes the cover's lavender and the sheet is bounded
(`min(100%, 880px) × min(100%, 980px)`), rounded and shadowed. The height
condition is why a short laptop is untouched: it has no void to fix, and
framing it would only take 48px of reading room away.

The sheet keeps a **fixed** height rather than hugging its content. A sheet
that hugged would move the header and the Next button on every question, and
across sixty questions of wildly different lengths a learner's thumb has to
find the same button in the same place.

## What this replaced, and what that cost

`PublicQuizRunner` was the Assessment Engine's Phase-3 **canary**: a route that
persisted nothing, so a defect could not corrupt data and a rollback was one
toggle. `test:paper-quiz-zero-write` pinned it as unable to import Firebase at
all, and its header said lifting that would be "a plan change, not a diff".

The plan change was made deliberately: an exam needs a server-anchored attempt.
The engine's ramp now needs a **new first flip** — its flags are still at 0, so
nothing had ramped and nothing was lost, but the note in
`src/engines/assessment-engine/index.js` no longer describes a live route.

The guard was rewritten rather than deleted. It now pins the property that
survives and is arguably stronger: **no Firestore write API is reachable from
the route**, every write goes through a callable, and the rules deny client
writes to all three collections outright — admins included.

## §6 — authoring the explanations

`/admin/papers/:paperId/explanations`. The drafter reads the paper's **marking
scheme** and the syllabus material for that grade, never general knowledge, and
lands drafts as `ai_draft`. It refuses itself (`confident: false`) when the
material does not support an explanation or when working the question through
makes it doubt the key; a refused question stays unexplained and shows its
answer, which is correct rather than a defect.

`explanationCore.validateDraft` refuses to store anything a reviewer would have
to reject — the 40/30 word limits, a distractor for every wrong option and none
for the right one, and a denylist of phrases that read as filled-in but say
nothing ("this is incorrect"). A reviewer skimming sixty rows approves those,
so they are caught by machine instead.

Bulk-approve touches only the ids the reviewer **was shown** and only ones
still in `ai_draft`.

## Tests

| What | Command |
|---|---|
| the pure decisions (54) | `npm run test:paper-quiz-core` |
| the server's decisions + shared marking (29) | `npm run test:paper-quiz-server` |
| §6's validator + review machine (16) | `npm run test:paper-explanations` |
| the shared packages run in both runtimes | `npm run test:shared-paper-quiz-neutral` |
| no Firestore write is reachable from the route | `npm run test:paper-quiz-zero-write` |
| the rules, behaviourally | `npm run test:rules-emulator` |
| the screens | `npx vitest run src/features/papers/quiz` |
| the reset cannot outrank the design again | `npm run test:css-reset-specificity` |
