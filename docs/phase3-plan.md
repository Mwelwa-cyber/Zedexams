# Phase 3 — Assessment Engine implementation plan

> Snapshot as of 2026-08-05 — verify before acting.
>
> **All eight decisions in §10 are settled** (2026-08-05). The scope and order
> below reflect them, and the binding changes they implied are in
> [`architecture.md`](architecture.md) §4, §4.1, §10, §13 and §14.5. §10 of this
> document now records what was decided and why, not what is open.

The plan for [`docs/architecture.md`](architecture.md) §4 and its Phase 3 entry in
§13: extract one Assessment Engine and retire the parallel runners. Written after
reading the four surfaces §4 named and their service layers, not from the
architecture doc's description of them — where the two disagreed, this document
said so, and every disagreement is now settled in §10 and reflected back into the
binding doc.

Every line number below is evidence for a claim, verified at `main` = `6edaf22f`.

The rule Phase 2 established and this phase inherits: **a migration is a move,
not a rewrite** ([`MIGRATION_TEMPLATE.md`](MIGRATION_TEMPLATE.md)). Phase 3
strains it harder than Phase 2 did, because one engine replacing several runners
*cannot* be a pure move — they disagree, and unifying them means picking a
behaviour. The discipline that survives is: **pick the behaviour in a PR that
changes nothing else**, and prove the writes did not move.

---

## 0. The finding that shapes everything else

§4 described "four parallel runners … each with its own results rendering",
implying four implementations of one thing. That was not what was there. Reading
them (the corrections this produced are now in §4 itself):

| | Reads | Grades | Writes | Timer | Resume |
|---|---|---|---|---|---|
| **QuizRunnerV2** | `quizzes` + `questions` subcollection | **client** | `results` | client clock | localStorage |
| **DailyExamRunner** | `quizzes` + questions via callable | **server** | `exam_attempts` + `daily_exam_locks` + (later) `learnerStats` | client start, **server-recomputed** deadline | localStorage + Firestore attempt |
| **PublicQuizRunner** | `pastPapers` + `quizzes` + `questions` | client, **discarded** | **nothing** | none | none |
| **PastPaperPractice** | `pastPapers` (a PDF) | n/a — **no questions** | `paperAttempts` | client stopwatch | none |
| **games (`timed_quiz`)** | `games` doc, questions **inline** | client | `scores` + `dailyStreaks` + `badges` + `learner_profiles` | round countdown | none |

Three consequences run through the rest of this plan:

1. **`PastPaperPractice` is not a runner and must leave Phase 3's scope.** It is
   a PDF reader with a stopwatch (`src/components/papers/PastPaperPractice.jsx`,
   482 lines) that writes an attempt carrying `elapsedSeconds` and a free-text
   `reflection` and *no answers*
   (`src/utils/pastPapers.js:518,539`). It has no questions to render, no marks
   to award and no answer key. Putting it behind a question engine would mean
   inventing a product, not migrating one. §4 pairs it with `PublicQuizRunner`
   under "past-paper quizzes"; that pairing is wrong and this plan drops it.

2. **`PublicQuizRunner` persists nothing.** Verified: no Firestore write of any
   kind. Progress is a localStorage tally
   (`src/utils/pastPaperQuiz.js:82`) against a 30-question free limit, keyed by
   uid *or an anonymous id* because the route is public. So for this runner
   "byte-compatible writes" is a vacuous requirement — and the real risk is the
   opposite one: **the engine must not start writing.** An engine that saves a
   result for every visitor turns an anonymous marketing surface into a
   personal-data collector, needing a rules change, a consent path and an
   account-deletion purge entry that do not exist today.

3. **Only one game is a question loop.** `PlayGame` dispatches eight engines by
   `game.type` (`src/components/games/PlayGame.jsx:229-236`); seven are
   mechanics (memory match, word builder, province shapes, sorting, scramble,
   number target, market). Only `timed_quiz` asks a question and takes an
   option — and its questions live **inline in the `games` document** as
   `{question, options, answer}`, a third vocabulary that is neither the
   editor's nor the assessment's.

So Phase 3's real scope is **two question runners** — `QuizRunnerV2` and
`PublicQuizRunner` — plus **one game engine**, `TimedQuizGame`.

`DailyExamRunner` was in this list until the scope decision (§6): it stays on
its own path untouched, and the Daily Quiz rework becomes a **new consumer** of
the engine rather than a migration of the old runner. Its inventory in §1.2
stays in this document, because that rework needs it.

---

## 1. Inventory

### 1.1 QuizRunnerV2 — `/quiz/:quizId`

`src/components/quiz/QuizRunnerV2.jsx`, 1,985 lines. Route at
`src/App.jsx:587`, behind `ProtectedRoute` + `LearnerOnlyRoute`.

- **Reads** `quizzes/{quizId}` and its `questions` subcollection through
  `useFirestore` — **the client holds the answer key**, which is what makes
  practice mode's live reveal possible.
- **Modes** `practice` (reveal on answer, Pako tips) and `exam` (timed, no
  reveal); exam is premium-gated.
- **Marking** is client-side (`src/utils/quizScoring.js`), re-derived from each
  question's persisted key rather than any stored `correct` flag — except text
  answers, which carry an AI verdict from `checkAnswerWithAI`.
- **A text answer the AI could not mark is `pending`, never wrong**
  (`QuizRunnerV2.jsx:565-598`). At submit that makes the whole attempt
  provisional: `buildResultGrading` writes `finalScore: null` +
  `gradingStatus: 'pending'` (`:623`). This is a correctness guarantee with a
  comment explaining it — the engine must carry it across intact.
- **Writes** one document: `addDoc(collection(db,'results'), {…, completedAt:
  serverTimestamp()})` (`src/hooks/useFirestore.js:400`), which also fires the
  PostHog `quiz_completed` event.
- **Autosave** is localStorage, key
  `examprep:quiz:session:{quizId}:{userId}` (`src/hooks/useQuizPersistence.js:20`).
  Exam sessions are keyed by `endTime` and discarded once it passes; practice
  sessions expire after 7 days. A lapsed exam can be reconstructed and
  auto-submitted via `includeExpired` rather than losing its answers.
- **Timer** exam-only, `endTime` from the device clock.
- **Existing coverage**: `QuizRunnerV2.spec.jsx`, 559 lines, 20 cases including
  the submit payload and the two answer-loss recoveries.

### 1.2 DailyExamRunner — `/exam/:examId` — **out of Phase 3's scope**

`src/components/exams/DailyExamRunner.jsx`, 856 lines. Route at `src/App.jsx:580`.

**Not migrated by this phase** (§6). It keeps running unchanged, and none of the
writes below enter §3's byte-compatibility surface. This inventory stays because
the Daily Quiz rework is built on the engine as a new consumer, and everything
recorded here — the privacy split, the server-derived deadline, the lock, the
downstream `learnerStats` write — is a requirement that rework inherits whether
or not it reuses a line of this runner's code.

This is the one runner with a **server-authoritative submit**, and it is the
most divergent of the four.

- **Start** — `startExam` (`src/utils/examService.js:221`) checks
  `daily_exam_locks/{uid}_{subject}_{date}`, then validates the new attempt
  through the zod `attemptStartSchema` before `addDoc` into `exam_attempts`
  (`:244,263`) and `setDoc` of the lock (`:265`).
- **Questions** come from the `getExamQuestions` callable, *without* the answer
  key — the client cannot mark, by design.
- **Submit** — `submitDailyExam` (`functions/dailyExamGradingFns.js:144`):
  ownership check, quiz-access check, then a transaction that grades and writes.
  Three details the engine must not lose:
  - **Privacy split** (`:227-248`). The attempt doc is readable by any signed-in
    user because it powers the leaderboard, so it carries only
    score/percentage/timeTaken; the learner's `answers` and analytics go to the
    owner-only `exam_attempts/{id}/private/detail`. *A top scorer's answers are
    the day's answer key.*
  - **The deadline is re-derived server-side** from `startedAt` (a
    `serverTimestamp`) + the quiz's `durationMinutes`, explicitly **not** the
    client's `endTime`, so a skewed device clock cannot distort the recorded
    time (`:194-207`).
  - **The lock flip is best-effort and after the transaction** (`:265-271`), with
    a comment saying a failure leaves the learner able to re-sit and that the
    `console.error` is load-bearing for a Cloud Logging alert.
- **Autosave** is localStorage only (`examService.js:374`) — Firestore is
  written on submit. A learner who answered offline and never submitted has
  their answers recovered from localStorage at restore (`:314-339`).
- **Streaks and XP are not written by the runner.** `recordExamCompletion`
  (`src/utils/gamificationService.js:89`) runs a transaction on
  `learnerStats/{uid}` with `processedAttempts` dedup — and it is called from
  **`ExamResultsPage`** (`src/components/exams/ExamResultsPage.jsx:14`), a
  screen the cutover does not touch. Anything that changes the attempt's shape
  changes that function's input from a page outside the flag.
- **Leaderboard** is a query over `exam_attempts`
  (`gamificationService.js:264`), not a materialised collection. Nothing writes
  a leaderboard document; "leaderboard writes must stay byte-compatible" is in
  practice a statement about the public fields of the attempt doc.
- **Existing coverage**: `DailyExamRunner.spec.jsx`, 250 lines, 12 cases.

### 1.3 PublicQuizRunner — `/papers/:paperId/quiz`

`src/components/papers/PublicQuizRunner.jsx`, 712 lines. Route at
`src/App.jsx:515` — **public, anonymous allowed**.

- Loads the paper, then the linked quiz + questions through
  `loadPublicQuiz` (`src/utils/pastPaperQuiz.js:113`), which resolves to
  `{outcome, quiz, questions, denied, error}` and never rejects. The Firestore
  read rule is the security boundary (`publicAccess && isPublished`, or
  admin/creator preview).
- Scores in React state, shows it, **persists nothing**.
- The free limit is a localStorage counter against uid-or-anon-id
  (`pastPaperQuiz.js:73-95`); hitting 30 fires the paywall bus.
- Subject integrity is validated against the paper before rendering
  (`validateQuizSubjectIntegrity`) — a guard the other runners lack.

### 1.4 PastPaperPractice — out of scope, see §0.

### 1.5 Games — `/games/play/:gameId`

- `TimedQuizGame.jsx` (458 lines) is the question loop; pure logic already split
  into `timedQuizCore.js` (option match is string-compared because "game docs
  store answers loosely").
- **Writes** `scores` (`src/utils/gamesService.js:152`) with a payload carrying a
  documented, deliberate divergence (`:132-139`):

  > INTENTIONAL DIVERGENCE: game scores store grade as a Number and subject
  > lowercased. … Do NOT cross-join scores with quizzes/lessons on
  > `grade`/`subject`, and do NOT "normalize" them here — that would silently
  > break the working leaderboard/score queries.

  An engine that normalises identity fields on its way to `scores` breaks every
  leaderboard query in the games area. This comment is the single most
  load-bearing sentence in the games path.
- Also writes `dailyStreaks/{uid}` (`src/utils/dailyChallengeService.js:145`),
  badges (`gameBadgesService`), and a fire-and-forget learner-intelligence
  profile.
- **The shared end-of-round hook is already forked.** Six games use
  `useGameFinish`; `TimedQuizGame` and `ProvinceShapesGame` call `saveScore`,
  `evaluateAndAwardGameBadges` and `recordDailyPlay` directly. The one game
  Phase 3 targets is on the forked side, so migrating it does not automatically
  align the other seven.

### 1.6 The divergences, as a decision list

Every row is a place the engine has to choose. "Preserve" = the engine
parameterises it. "Resolve" = the engine picks one and something changes.

| # | Divergence | Evidence | Disposition |
|---|---|---|---|
| D1 | Marking is client-side (quiz, public, game) vs server-side (daily) | `quizScoring.js` vs `dailyExamGradingFns.js:144` | **Out of scope.** With daily deferred, every Phase 3 consumer marks client-side. The engine ships `clientKey` + `none` behind an isolated verdict seam; no `serverCallable` interface until a real consumer defines its shape (§2.4) |
| D2 | The client holds the answer key (quiz, public, game) or does not (daily) | `getExamQuestions` withholds it | **Out of scope** for the same reason — but it is a security posture, not a style, and the rework re-decides it rather than inheriting the engine's default |
| D3 | MCQ options: `.opt-grid` is `grid-template-columns: 1fr` (`src/index.css:5030`) — single column ✅; DailyExamRunner is `sm:grid-cols-2` (`:574`) — two columns ❌ | | **Resolve** to vertical, per §4. Visible UI change on one runner |
| D4 | Option letters: `['A','B','C','D'][i]` (quiz `:1716`, daily `:578`) vs `String.fromCharCode(65+i)` (public `:167`) | | **Resolve.** The array form yields `undefined` past D — a latent bug in two runners, not a preference |
| D5 | Identity fields: `scores` stores grade as Number + subject lowercased; everything else uses string grade + display-label subject | `gamesService.js:132-139` | **Preserve, loudly.** Encode it as a per-target write adapter with the comment attached |
| D6 | Resume: Firestore attempt + localStorage (daily) vs localStorage (quiz) vs none (public, games) | | **Preserve** |
| D7 | Pending-AI answers make an attempt provisional (quiz only) | `QuizRunnerV2.jsx:616-623` | **Preserve** as engine-level, since only the quiz path has AI marking today |
| D8 | Question source: `questions` subcollection vs inline array on the `games` doc | `gamesService.js` | **Preserve** via the normaliser — §4.1 note 1 freezes the subcollection shape for *assessments*, not for `games` |

---

## 2. The canonical engine contract

### 2.1 Seeded, not invented

Per §4.1 note 5 and §14.10, the contract extends what exists:

- **`functions/shared/assessment/`** — 13 core modules already shared with the
  client. The ones Phase 3 draws on directly: `questionTypeCore` (type
  vocabulary + marks normalisation), `answerChoicesCore`, `richTextContentCore`,
  `fillBlanksCore`, `comprehensionGroupingCore`, `questionNumberingCore`.
- **`src/schemas/{quiz,attempt,result}.js`** — today these are **read-side
  coercers**, not write schemas. `result.js` says so, and names the condition
  that ends it:

  > Why no write schema (yet)? … A strict write schema here would risk rejecting
  > legitimate writes for marginal benefit. … **When a second writer appears,
  > lift a write schema out of the reader-fields list below.**

  **The engine is that second writer.** Adding a `results` write schema is
  therefore work this phase inherits, on the file's own terms.
- `attemptStartSchema` already validates `exam_attempts` creation
  (`examService.js:244`) — the precedent for validating a write before it lands.

**`questionTypeCore` documents two live vocabularies** — the editor's (`mcq`,
`tf`, `short_answer`, …) and the assessment paper's (`multiple_choice`,
`true_false`, `structured`, …) — kept separate on purpose, bridged by one tested
pair of functions. The engine consumes the **editor vocabulary** (every
runner is on it) and reaches the assessment side only through that bridge. It
must not introduce a third.

### 2.2 RichContent

`RichContent` (Tiptap JSON + KaTeX school notation) is already rendered by three
of the runners via `src/editor/RichContent.jsx`, with
`getRichPlainText` as the fallback. Two constraints from §4.1:

- **Legacy plain strings stay byte-compatible** — the normaliser wraps at read
  time, stored documents are never mutated in place (note 3). `QuizRunnerV2`
  already branches `typeof option === 'string' ? option : getRichPlainText(option)`
  (`:1729`); the engine centralises that branch rather than repeating it.
- Games are the exception: `timedQuizCore` compares options as strings because
  game docs store answers loosely. Normalise game questions **into** RichContent
  at read time; never write RichContent back to a `games` doc.

### 2.3 `schemaVersion` — a conflict to resolve before coding

§4.1 note 4 says **`schemaVersion` is required**. Verified by grep: it exists on
lessons, drafts and teacher-tool outputs, and **on none of
`quizzes` / `questions` / `results` / `exam_attempts` / `scores`**.

That collides with Phase 3's own byte-compatibility rule:

- Read-time only (the normaliser derives it, nothing new is written) → writes
  stay byte-identical, and `schemaVersion` is a property of the in-memory model.
- Written onto new documents → every new `results` doc differs from an old one
  by a field, and the comparison harness in §3 must be told to expect it.

This plan proposes **read-time only for Phase 3**, with a stamped
`schemaVersion` deferred to whichever phase changes those documents for another
reason. Decided read-time only — see §10, decision 1.

### 2.4 What the engine owns, and what it does not

```
src/engines/assessment-engine/
├── index.js                     ← public API                        ✅ landed
├── schemas/                     ← the canonical model + zod          ✅ landed
├── normalise/                   ← quiz | pastPaperQuiz | game        ✅ landed
├── purity.test.js               ← the node-tested layers, enforced   ✅ landed
├── session/                     ← navigation, timing, answer capture, autosave
├── marking/                     ← clientKey | none, behind one verdict seam
├── render/                      ← question renderers (MCQ vertical, short, …)
└── persist/                     ← per-target write adapters (§3)
```

Three corrections to what this section originally said, all made by building it:

- **The directory is `assessment-engine/`, not `assessment/`.** Phase 1 scaffolded
  that name and the layering rules in `eslint.config.js` cover it; the plan was
  wrong, so the plan moved rather than the directory.
- **`contract/` is `schemas/`** — again the scaffold's name, and the one its own
  docblock already described as "client-side zod schemas for the assessment
  contract".
- **`normalise/` has three adapters, not four.** `dailyExam` left with the scope
  decision (§6), and `quiz`/`pastPaperQuiz` share one adapter because they read
  the same two collections and differ only in what the consumer does with the
  result.

`src/engines/` exists and is empty (Phase 1). It sits **below** features in the
layering, so it may not import `src/features/**` and may not touch the Firebase
SDK — the write adapters describe *what* to write and a caller in
`services/` performs it (§14.2, and the Phase 1 lint rules enforce it).

**Not in the engine**: the paywall bus, subject-integrity validation, premium
gating, mascots/streak chrome, `recordExamCompletion`, badges. These wrap it.

**Marking ships as two strategies, not three.** Every Phase 3 consumer marks
client-side from the answer key, so `serverCallable` would be an interface with
no caller — designed from the shape of the runner being retired rather than from
the consumer that will actually need it. What the engine builds instead is the
**seam**: the session asks one function for a verdict and never scores inline, so
adding a strategy later is an addition rather than a refactor of the session.
This is deliberately not the same as building the abstraction. If the Daily Quiz
rework wants per-question server marking mid-session, a synchronous verdict
function is the wrong seam and gets replaced — and that is the cheaper mistake,
because it is discovered by a consumer that exists rather than baked in by one
that does not.

---

## 3. Byte-compatibility, and how it is proved

### 3.1 What must be indistinguishable

| Write | Path | Producer today |
|---|---|---|
| `results/{auto}` | quizzes | `useFirestore.saveResult` |
| PostHog `quiz_completed` | quizzes | `saveResult` |
| *(none)* | past-paper | — the surface is that this stays empty |
| `scores/{auto}` | games | `gamesService.saveScore` |
| `dailyStreaks/{uid}` | games | `recordDailyPlay` |
| `badges/{uid}` | games | `gameBadgesService.js:84` |
| `learner_profiles/{uid}` | games | `gamesIntelligence.js:109`, fire-and-forget |

Deferring daily removes four rows — `exam_attempts` (create and submit),
`exam_attempts/{id}/private/detail`, `daily_exam_locks`, and the downstream
`learnerStats` write from `ExamResultsPage`. That is the single largest
simplification the scope decision buys: **the whole server-side half of the
comparison problem leaves Phase 3**, including the one comparison that could not
run in the replay harness at all (§3.3).

What it leaves is one write for quizzes, none for past-paper, and **four for
games** — which makes games the write-heaviest consumer in the phase, not the
lightest, and is why it stays last on every reading of the order.

### 3.2 The definition

A write is byte-compatible when, for the same recorded attempt:

1. the **field set** is identical — no additions (a new field is a schema change
   with rules and index consequences), no removals;
2. every value is `===`, with three declared exceptions: server timestamps,
   auto-ids, and `timeSpent`/`elapsedSeconds` (wall-clock). The harness
   substitutes fixed values for all three, and **the substitution list is part of
   the assertion** — a fourth exception must be added deliberately, in a diff, not
   discovered by a loosened matcher;
3. **types match** — `4` and `'4'` are not equal (this is exactly what D5 is
   about);
4. the **number of writes** and their target paths match, so a "harmless" extra
   `setDoc` cannot hide inside an equal payload.

### 3.3 The harness — replay, not double-write

Live double-writing is explicitly rejected: it doubles quota on the busiest
learner path, needs rules that permit a shadow collection, and can only compare
attempts that already happened in production. Instead:

**Fixtures.** `tests/fixtures/attempts/*.json` — recorded attempts as
`{quiz, questions, answers[], timings, mode, user}`. Sourced by capturing what
the existing spec suites already construct, plus hand-written cases for the
edges the specs name: a lapsed exam recovered from localStorage, an attempt with
a pending AI answer, an unanswered submit, a 5-option MCQ (D4), a legacy
plain-string question, an attempt scoring 0.

**Replay.** A plain-node harness (`*.test.js`, so `test:all` discovers it) that
runs each fixture through both paths against **one fake Firestore recorder** —
an object implementing `addDoc`/`setDoc`/`updateDoc`/`runTransaction` that
appends `{op, path, payload}` — and diffs the two journals under §3.2's rules.
This requires the old path's write to be reachable without React, which for
`saveResult`, `startExam` and `saveScore` it already is. **`QuizRunnerV2`'s
`handleSubmit` is not** — it is a closure inside a 1,985-line component. Getting
a journal out of it means either driving the component under Vitest (possible —
its spec already asserts the `saveResult` payload) or extracting `handleSubmit`'s
body to a pure function *before* the engine exists. **The extraction is the
better first PR**: it is a move, it is independently reviewable, and it makes the
old path measurable while it is still the only path.

**The server path is no longer in scope, and that is why.** `submitDailyExam`
grades inside a Firestore transaction with the admin SDK, so it can never be
replayed through this harness — its comparison would have needed the rules
emulator, a different runtime asserting a different thing, and a green result
there would not have meant the replay harness had covered it. Deferring daily
removes that split entirely: **every write Phase 3 must prove is reachable from
one harness.** Kept here as the reason, because if daily is ever pulled back into
a migration this constraint returns with it.

**A recorded journal is a snapshot of today's behaviour, not a specification of
correct behaviour.** If a fixture encodes a bug, the harness will faithfully
require the bug. Two of these are known already (D4's `undefined` letter past
option D; the best-effort lock flip). Both are fixed in their own PRs, before or
after the cutover, never inside it — and the fixture is updated in that PR, where
a reviewer can see the write change on purpose.

### 3.4 Tests this phase adds

| Test | Kind | Asserts |
|---|---|---|
| `test:engine-replay-results` | node | `results` journal identical, quiz fixtures |
| `test:engine-replay-scores` | node | `scores` journal identical — **including `grade` as Number and lowercased `subject`** (D5) |
| `test:engine-replay-game-side-writes` | node | `badges` + `dailyStreaks` + `learner_profiles` journals identical — the three writes that are easiest to forget because two are fire-and-forget |
| `test:engine-contract` | node | normaliser output for all three in-scope sources against the canonical model; legacy plain-string in, RichContent out, stored doc untouched |
| `test:engine-no-write-public` | node | the public path's journal is **empty** (§0.2) |
| `assessmentEngine.spec.jsx` | Vitest | vertical single-column MCQ, letters past D, keyboard nav, the pending-answer path |
| `test:engine-flag-resolution` | node | flag table (§4), fail-closed default, one runner's flag cannot move another's |

Each `test:*` key is added in the same commit as its file
(`MIGRATION_TEMPLATE.md` §5), and the discovered-script count is reported in
every PR — an absolute target stated once here would be stale by the second
merge, which is what happened to the figure this paragraph used to carry.
**Baseline: 637 at the contract merge (#2120)**, from 633 when this plan was
written; the four already landed are `test:quiz-result-payload`,
`test:option-letters`, `test:assessment-normalise` and
`test:assessment-engine-purity`. The Vitest spec is deliberately *not*
discovered by `run-all-tests.mjs` (it only runs `test:*` scripts whose command
starts with `node`), so it can never be counted as evidence that the node suite
grew.

---

## 4. Feature flags

### 4.1 Mechanism — already present, no deploy needed

`settings/global` is subscribed with `onSnapshot`
(`src/contexts/PlatformSettingsContext.jsx:32`), so an admin toggle reaches every
open client within seconds **with no build and no deploy** — the instant-rollback
requirement, satisfied by the mechanism the passkey rollout already uses
(`featureFlags.passkeyAuthenticationEnabled` + `passkeyRolloutRoles` /
`passkeyRolloutUids` + the three-state `passkeyFunctionsRegion`).

### 4.2 The flags

| Flag | Gates | Default |
|---|---|---|
| `featureFlags.assessmentEngine.pastPaperQuiz` | `/papers/:paperId/quiz` | `off` |
| `featureFlags.assessmentEngine.quiz` | `/quiz/:quizId` | `off` |
| `featureFlags.assessmentEngine.game` | `timed_quiz` | `off` |
| `featureFlags.assessmentEngine.rolloutPercent` | narrows all three | `0` |
| `featureFlags.assessmentEngine.rolloutUids` | narrows all three | `[]` |

No `dailyQuiz` flag: `/exam/:examId` is not migrated (§6), and a flag that
nothing reads is a promise the code does not keep.

`rolloutPercent` exists because past-paper flips first and is public — the one
route where a bad render is visible to anyone, including search crawlers. It
buckets on the stable visitor id the free-limit counter already mints
(`pastPaperQuiz.js:60-72`), so a given visitor gets a consistent answer rather
than flapping between runners on reload.

Five rules:

1. **Per-runner, never one master switch.** A cutover that cannot be reverted
   independently is not three cutovers.
2. **Fail closed.** Anything but `=== true` is off, so an unreadable
   `settings/global` serves the old runner. This inverts the usual availability
   default deliberately: the old runner is the known-good path.
3. **Resolved in exactly one module** — `src/engines/assessment-engine/flags.js`, with
   its own node test. `passkeyRegionCore.js` is the precedent, and the reason is
   that a flag read in four components drifts into four subtly different
   conditions.
4. **The flag chooses a runner; it never branches inside one.** Both components
   stay whole and mounted lazily, so a stale client either runs the old path
   completely or the new one completely — never a half-migrated hybrid whose
   state nothing has ever tested.
5. **No flag on a server write.** No in-scope consumer has one, and the rule is
   kept because the Daily Quiz rework will: when it needs a server shape that
   `submitDailyExam` does not have, that is a **new callable**, not a branch
   inside the existing one, which must keep behaving identically for the
   un-migrated runner still calling it (§14.3 freezes export names; adding one is
   fine, changing one silently is not).

### 4.3 What the flags cannot do

A flag rolls back **code**. It does not roll back a document already written by
the new path. That is the whole reason §3 must pass before a flag is flipped:
by the time a flip is reversible-in-practice, the writes have to be identical
anyway.

---

## 5. Order and entry criteria

**Build order and cutover order are two decisions, and they differ.** The plan
originally treated "quizzes first" as one; separating them takes the better half
of each argument instead of trading one for the other.

### 5.0 Build against quizzes; flip past-paper first

**Build order: quizzes sets the contract.** The engine is designed and built to
`QuizRunnerV2`'s full spec — every question type, both modes, AI marking, resume,
provisional grading — before any flag exists. The hardest consumer sets the
shape, and generalising from a lesser one is how a wrong abstraction gets baked
in: an engine designed around past-paper would be designed around a runner that
renders a strict subset and persists nothing, and the missing joints would surface
later, when it is already live. Quizzes is also validated in the replay harness
first, because its single `results` write is the phase's only non-trivial
comparison until games.

**Cutover order: past-paper → quizzes → games.**

1. **Past-paper is the canary**, and it is the only cutover that persists
   nothing. If the engine is wrong here there is no corrupted document, no
   cleanup, and no comparison to trust — the failure mode is a bad render, which
   is visible immediately and reverts in seconds. It is also the
   highest-traffic route, so it produces the most evidence fastest. Its one
   risk — the route is public and SEO-visible — is what `rolloutPercent` is for
   (§4.2), which is why gradual rollout is a requirement of this order rather
   than a nicety.
2. **Quizzes second**, now against an engine that has rendered real questions to
   real visitors. Its write is the first one the harness has to prove in
   production conditions.
3. **Games last** — four write targets, a documented "do NOT normalize"
   divergence, inline questions, and its own chrome. It is the write-heaviest
   consumer in the phase and the one where the unification payoff is smallest.

The one thing this order costs: the engine is *built* against a consumer whose
flag flips second. Nothing goes to production unproven — quizzes' replay
comparison is an entry criterion for the past-paper flip too (§5.1), because the
engine serving past-paper is the same engine.

### 5.1 A flag does not flip until all of these hold

1. `npm run lint`, `build`, `test:all`, `test:unit`, `test:import-boundaries`
   green; `test:all` discovered-count reported and not lower.
2. That runner's §3 comparison test exists, is registered, and passes on every
   fixture — **including the edge fixtures**, not only the happy path.
3. Deleting the engine's write adapter makes the comparison test **fail** (the
   Phase 2 control-case rule: a passing test that would pass with the code
   removed proves nothing).
4. Rules + emulator coverage per §14.12 for every collection the runner touches,
   in the same PR. For games that is four, of which `badges` and
   `learner_profiles` have **no emulator coverage today** and `learner_profiles`
   was not in the binding doc's inventory until this phase found it.
5. The old runner is still mounted, reachable by flipping one boolean, and
   **deleted in Phase 6, not here** (§14.11).
6. A Vitest spec renders the engine's version of that runner and asserts the
   §2 layout requirements (vertical MCQ, letters past D).
7. Rollback rehearsed once on staging or via the admin toggle: flip on, flip
   off, confirm the old runner serves.
8. The observability in §7 is emitting **before** the flip, not added after.

---

## 6. The Daily Quiz — deferred out of Phase 3 (decided)

The product intent (Daily Exams retired in favour of a Zed-hosted Daily Quiz —
one per day, leaderboard) collided with the cutover at exactly one runner. Three
options were live: migrate-then-rework, rework-riding-the-cutover, or defer.

**Decided: `DailyExamRunner` is out of Phase 3 entirely.** It stays on its own
path, untouched, and the Daily Quiz rework is built directly on the engine as a
**new consumer**. The old runner retires at that product switch.

Why not migrate-then-rework, which this plan originally recommended: the rework
replaces the product rather than adjusting it, so most of the migration would be
discarded weeks later — the same waste the plan warned about, just paid in a
different order.

Why not ride the cutover: byte-compatibility is a comparison against a recorded
baseline, and a product change removes the baseline. The writes are *supposed* to
differ, so the only remaining check is human review of a diff that also contains
an engine swap — the strongest guarantee in this plan evaporating exactly where
the stakes are highest, since a learner cannot re-sit today's exam. Rollback
degrades the same way: reverting a flag would return learners to a *different
product*, with documents already written in the new shape.

**What deferring buys**, beyond avoiding both of those:

- The **entire server-side half of the comparison problem leaves Phase 3** — and
  with it the one write that could never have gone through the replay harness
  (§3.3). Every write the phase must prove is now reachable from one harness.
- The engine ships **two marking strategies instead of three** (§2.4), with no
  interface guessed from a runner that is being retired.
- The privacy split, the daily lock, `learnerStats` and the leaderboard read all
  leave the byte-compatibility surface.

**What it costs, stated plainly**: `/exam/:examId` keeps running an unmigrated
runner past the end of Phase 3, so §14.5's "no parallel runners" holds with one
scoped exception rather than absolutely. That exception is written into
[`architecture.md`](architecture.md) §14.5 with an end date attached — the runner
retires at the product switch — and narrowed to that one file, so "the daily path
is exempt" cannot be read as a licence to build anything new outside the engine.
`DailyExamRunner`'s inventory stays in §1.2 because the rework inherits its
requirements whether or not it reuses its code.

---

## 7. Observability

Constrained by §14.16 — PostHog and Sentry only, no new providers.

### 7.1 During shadow comparison (pre-flip, CI)

The comparison harness is a CI test, so its "observability" is the test output:
per-fixture pass/fail, the diff of any mismatched journal, and the fixture count.
A drop in fixture count fails, for the same reason `test:all`'s discovered count
does.

### 7.2 After each flip (production)

Add **one** PostHog event, `assessment_engine_path`, on every runner entry:
`{runner, engine: true|false, flagSource}` — aggregate only, no answers, no
question text (matching the existing `quiz_completed` discipline). Everything
else needed is already emitted or queryable:

| Signal | Source | Watch for |
|---|---|---|
| Completion rate per runner | existing `quiz_completed` / attempt docs | a drop after the flip |
| Submit failure rate | Sentry, `reportClientError` | any new error signature |
| Provisional-grading rate | `results.gradingStatus === 'pending'` | a rise = AI marking path regressed |
| Score distribution per quiz | `results.percentage` | a shifted mean = a marking change |
| `scores` write rate + shape | games leaderboard queries | a query returning nothing = D5 regression |
| **Past-paper: no writes appear** | `results` / any collection, filtered to the paper-quiz route | a single document is a P1 — the canary's whole premise is that it persists nothing |
| Paywall trigger rate | existing paywall bus events | the free-limit counter is localStorage, easy to break silently in a rewrite |

The score-distribution one deserves emphasis: **a marking regression does not
throw.** It produces plausible numbers that are wrong. Error rates will not catch
it; a shifted distribution against the pre-flip baseline will.

### 7.3 Rollback triggers

Flip the flag off, without discussion, on any of:

- any write mismatch observed in production that the harness did not predict;
- submit failure rate above its pre-flip baseline on a meaningful sample;
- any learner-reported lost attempt or lost marks, unreproduced (one report is
  enough);
- **any Firestore write at all from the past-paper route** (§0.2);
- completion rate down materially against the same weekday;
- a mean-score shift not explained by a content change;
- for games: a leaderboard query returning fewer rows than before the flip (the
  D5 identity-field regression is invisible in the write itself and only shows
  up in the read).

Rollback is a toggle in `/admin`, so the cost of being wrong about a trigger is
minutes. Bias toward flipping off and re-diagnosing.

---

## 8. Phase 2's lessons, mapped to where they bite here

| Lesson | Where it applies in Phase 3 |
|---|---|
| **Consumer discovery beyond grep** | `vi.mock('…/QuizRunnerV2')`-style paths in specs; `lazy(() => import(…))` in `App.jsx` for each runner; `scripts/aiGenerators/inventory.js`; and the case that bit Phase 2 — a module loaded through a **variable**, found by `test:all`, not by grep. Run the full node suite before trusting the surface map |
| **Exact-path CI gates** | `scripts/visual/printAffectingPaths.js` lists `src/utils/quizRichText.js` by exact path. Phase 3 does not move it — but if the engine absorbs any of `assessmentToDocx.js` / `assessmentPaperLayout.js` / `paperContentModel.js`, the list is updated **in the same commit**, per that file's own note: *"a pattern for a moved file protects nothing and reads exactly like one that works"* |
| **Rules coverage moves with the collection** | §14.12. `quizzes`, `results` and `scores` are covered; `badges`, `dailyStreaks` and `learner_profiles` are **not**, and all three are written by the games cutover. Each cutover adds its collections' emulator cases in its own PR — with the control case that succeeds when only the tested field changes |
| **Fail-loud verification** | §3.3's substitution list is asserted rather than being a loose matcher; §5.1's criterion 3 requires the comparison test to fail when the adapter is deleted; the flag test lints a synthetic wrong-flag case |
| **Measure the bundle, don't assume** | The engine is imported by three routes that are lazy today. Chunk counts and sizes before/after each cutover, as in Phase 2 (565 chunks, +95 bytes) — an engine barrel pulling KaTeX or the marking path into a public route is exactly the failure that measurement catches |
| **Debt lists shrink, never grow** | `test:import-boundaries`. `src/engines/` may not import `src/features/**`, and the Firebase prohibition on the lower layers is why the write adapters describe writes instead of performing them |

### 8.1 One gap this plan found, worth closing regardless

`scripts/test-rules-collection-coverage.mjs` classifies collections through two
**hand-maintained constants** (`COVERED`, `UNCOVERED`, lines 56-96). It checks
that a covered collection stays covered, that an uncovered one gets promoted, and
that the two lists do not overlap — but **nothing enumerates the collections
that exist**, from §10 or from `firestore.rules`. A collection in neither list is
invisible to it.

Three such collections were found: **`paperAttempts`** (`firestore.rules:2761`),
**`daily_exam_locks`** (`:694`) and **`learner_profiles`** (`:1887`, written by
the games path this phase migrates). All three have rules, all three were absent
from §10's data model *and* from both lists, so the ratchet could not fail on
them and never has.

This is the Phase 2 lesson exactly — a guard that is wrong quietly. The fix is
small (derive the universe from `firestore.rules`' match blocks and fail on any
collection classified as neither) and belongs in its own PR, not smuggled into a
cutover. Green-lit as its own PR — see §10, decision 5.

---

## 9. Risks

| Risk | Why it is real here | Mitigation |
|---|---|---|
| A marking regression that looks like a normal result | Marking rules are spread across `quizScoring.js` and four grading modules | §3 replay over recorded attempts + §7.2 score-distribution watch |
| The engine starts writing on the public route | An anonymous surface gaining a personal-data write — and it flips **first** | `test:engine-no-write-public` asserts an empty journal; a single production write is a rollback trigger |
| A bad render is public and crawlable | Past-paper is the canary and is SEO-visible | `rolloutPercent` bucketed on the existing stable visitor id; rollback is a toggle |
| Games leaderboards silently return nothing | An engine "normalising" `grade`/`subject` (D5) | Comparison test asserts types, not just values; the divergence comment travels with the adapter |
| Two of games' four writes are fire-and-forget | `badges` and `learner_profiles` fail silently by design, so a regression is invisible | `test:engine-replay-game-side-writes` compares all four journals; emulator coverage added in the same PR |
| The 1,985-line component resists extraction | `handleSubmit` is a closure over 15 state values | Extract to a pure function **first**, in its own PR, before the engine exists |
| Phase 3 becomes a rewrite | The runners disagreeing forces choices | Every "resolve" row in §1.6 ships as its own PR, before or after the cutover it touches — never inside it |
| The engine is built against a consumer that flips second | §5.0 splits build order from cutover order | Quizzes' replay comparison is an entry criterion for the past-paper flip too — the engine serving both is the same engine |

---

## 10. Decisions taken

All eight were settled on 2026-08-05. Recorded with the reasoning, because a
decision without its reason is re-litigated the first time it becomes
inconvenient.

1. **`schemaVersion` — read-time only for all of Phase 3** (§2.3). Stamping it
   onto writes becomes a separate post-cutover change once no old runner still
   writes those collections; until then two writers would disagree about whether
   the field exists. Recorded as a phasing note in `architecture.md` §4.1.
2. **The Daily Quiz — deferred out of Phase 3 entirely** (§6). `DailyExamRunner`
   stays on its own path untouched; the rework is built on the engine as a new
   consumer and the old runner retires at that switch. Neither
   migrate-then-rework (discards the migration weeks later) nor
   rework-riding-the-cutover (destroys the comparison baseline where a lost
   attempt is unrecoverable). §14.5 carries the scoped exception this creates.
3. **`PastPaperPractice` — out of scope** (§0.1), and `architecture.md` §4 is
   corrected to stop describing it as a runner. It renders no questions, holds no
   answer key and awards no marks.
4. **Build order and cutover order are separate** (§5.0). Build against quizzes,
   the hardest consumer, so the contract is not generalised from a subset. Flip
   past-paper first, the only cutover that persists nothing, on the
   highest-traffic route, with gradual rollout covering the public-render risk.
   Then quizzes, then games.
5. **The coverage-ratchet gap — fixed in its own PR, before the engine work**
   (§8.1), covering `paperAttempts`, `daily_exam_locks` and `learner_profiles`,
   with the universe derived from `firestore.rules` rather than hand-maintained.
   All three are also added to `architecture.md` §10.
6. **D3/D4 — fixed in the current runners before any cutover**, one PR each, with
   production soak time (§1.6). The comparison fixtures then encode corrected
   behaviour, and each cutover stays a pure move.
7. **Games — `timed_quiz` only, migrated as it stands** (§1.5). The resulting
   third end-of-round path is counted debt on a shrink-only list, unified by the
   Phase 4/6 games tidy-up. Folding it onto `useGameFinish` first would mean
   preparatory surgery on the path with four write targets and a documented
   "do NOT normalize" divergence, in the area sequenced last for being
   lowest-stakes — and that area has its own product rework coming.
8. **Marking ships as `clientKey` + `none` behind an isolated verdict seam**
   (§2.4). No `serverCallable` interface until a real consumer defines its shape:
   committed is not the same as shaped, and an interface designed from the
   retiring runner would be refactored by the rework anyway. Build the seam, not
   the abstraction.

### 10.1 Work order

Steps 1–4 are done. Ticked here rather than deleted, because the order was a
decision and a plan that erases what it decided cannot be checked against what
happened.

1. ✅ `handleSubmit` extracted to `buildQuizResultPayload` (#2114) — no engine,
   no flag. The seam the replay harness will compare through.
2. ✅ The coverage-ratchet fix (#2115), which turned out to be 69 collections
   rather than the 3 that prompted it.
3. ✅ D4 (#2116) and D3 (#2117), one PR each, now soaking.
4. ✅ The engine contract + normaliser (#2120), built against quizzes. **The
   replay harness and fixtures did NOT ship with it** — the contract was sent
   for review before it grew consumers, and a harness with no consumer to
   compare against would have been fixtures checked against themselves.
5. ✅ **The replay harness and fixtures** (#2122), against the extracted payload
   builder from step 1 — the first thing the engine can actually be measured
   with. The differ's rules and the old path's baseline; the old-vs-new
   comparison lands with `persist/`.
6. Session, marking (`clientKey` + `none` behind the verdict seam) and the
   renderers, built against quizzes as §5.0 sets out. The session went first
   and by a different discipline — **characterise-then-conform**, since there
   is no seam to extract from 1,985 lines of React state. The contract suite is
   `src/engines/assessment-engine/session/characterisation/sessionContract.jsx`
   and the old runner passes it, which is what makes it a description of
   reality rather than of an intention. ✅ session (#2124), ✅ marking +
   `persist/` (#2125 — the first engine writes, and the point at which §3.3's
   comparison became real: every recorded attempt now replays through BOTH
   paths and the journals are diffed). Renderers remain.
7. Cutovers: past-paper → quizzes → games, each gated on §5.1.
