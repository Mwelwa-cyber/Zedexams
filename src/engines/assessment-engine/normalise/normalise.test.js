/**
 * The assessment normaliser — plain-node tests.
 *
 * The assertions are organised around what a CONTRACT has to guarantee, not
 * around each adapter's internals: the same properties must hold whichever
 * source the data came from, because that is the only reason to have one model.
 * A per-adapter test suite that never compares the two would let the sources
 * drift while both stayed green — which is how the four runners got here.
 */
import assert from 'node:assert/strict'
import { normaliseAssessment, fromQuiz, fromGame } from './index.js'
import {
  assertAssessment,
  safeAssessment,
  toRichContent,
  ASSESSMENT_SCHEMA_VERSION,
  RICH_CONTENT_VERSION,
} from '../schemas/index.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const quizDoc = (over = {}) => ({
  id: 'quiz-1', title: 'Addition Basics', subject: 'Mathematics', grade: '4',
  duration: 30, ...over,
})

const quizQuestion = (over = {}) => ({
  id: 'q1', type: 'mcq', text: 'What is 2 + 2?',
  options: ['3', '4', '5', '6'], correctAnswer: 1, marks: 1, topic: 'Addition',
  ...over,
})

const gameDoc = (over = {}) => ({
  id: 'math_speed_g4', title: 'Times Tables', subject: 'mathematics', grade: 4,
  type: 'timed_quiz',
  questions: [
    { question: '6 × 7 = ?', options: ['42', '36', '48', '56'], answer: '42' },
    { question: '8 × 5 = ?', options: ['30', '35', '40', '45'], answer: '40' },
  ],
  ...over,
})

console.log('assessment normaliser')

// ── The model is valid, from every source ────────────────────────────────────

test('a quiz normalises to a valid assessment', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion()], source: 'quiz' })
  assertAssessment(a)
  assert.equal(a.source, 'quiz')
  assert.equal(a.schemaVersion, ASSESSMENT_SCHEMA_VERSION)
})

test('a past-paper quiz normalises through the same adapter', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion()], source: 'pastPaperQuiz' })
  assertAssessment(a)
  assert.equal(a.source, 'pastPaperQuiz')
  // It persists nothing, so there is nothing to resume from.
  assert.equal(a.settings.allowResume, false)
})

test('a game normalises to a valid assessment', () => {
  const a = fromGame({ game: gameDoc() })
  assertAssessment(a)
  assert.equal(a.source, 'game')
  assert.equal(a.questions.length, 2)
})

// ── correctIndex is a POSITION in every source ───────────────────────────────
//
// The single most load-bearing property: a quiz stores an index, a game stores
// the option's value. If these disagreed the engine would need per-source
// scoring, which is the thing being removed.

test('a quiz answer index survives as a position', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion({ correctAnswer: 2 })], source: 'quiz' })
  assert.equal(a.questions[0].correctIndex, 2)
})

test('a game answer VALUE resolves to the same kind of position', () => {
  const a = fromGame({ game: gameDoc() })
  assert.equal(a.questions[0].correctIndex, 0) // '42' is options[0]
  assert.equal(a.questions[1].correctIndex, 2) // '40' is options[2]
})

test('both sources agree on what correctIndex MEANS', () => {
  const q = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion({ correctAnswer: 1 })], source: 'quiz' })
  const g = fromGame({ game: gameDoc({ questions: [
    { question: 'x', options: ['a', 'b', 'c'], answer: 'b' },
  ] }) })
  // Both point at the second option, and in both the option at that index is
  // the right answer — asserted through the model, not through the source.
  assert.equal(q.questions[0].correctIndex, 1)
  assert.equal(g.questions[0].correctIndex, 1)
  assert.equal(q.questions[0].options[1].plainTextFallback, '4')
  assert.equal(g.questions[0].options[1].plainTextFallback, 'b')
})

test("a game's loose typing still matches — 7 against '7'", () => {
  const a = fromGame({ game: gameDoc({ questions: [
    { question: 'x', options: ['5', '7'], answer: 7 },
  ] }) })
  assert.equal(a.questions[0].correctIndex, 1, 'timedQuizCore compares as strings; so must we')
})

test('an unresolvable game answer is null, never -1', () => {
  const a = fromGame({ game: gameDoc({ questions: [
    { question: 'x', options: ['a', 'b'], answer: 'zzz' },
  ] }) })
  assert.equal(a.questions[0].correctIndex, null, '-1 would read as an index and subscript an array')
  // The answer key is EMPTY rather than carrying the raw 'zzz'. It used to
  // carry it "so the failure is inspectable", which was harmless only while
  // nothing consumed the key — `answerKey` is spread straight into
  // `computeQuizScore`, so a key holding `answer: null` for a resolvable-looking
  // question marks an UNANSWERED question correct (`undefined === undefined`
  // never fires, but `null` keys do the same job for a null response). Absent
  // is the honest key for a document that does not say what the answer is:
  // everything marks wrong, and the games cutover refuses the round outright.
  assert.deepEqual(a.questions[0].answerKey, {}, 'no key at all, rather than one the scorer misreads')
})

test('a game answer key is the POSITION, because that is what the scorer grades', () => {
  // The learner's response is an option index, so a key holding the stored
  // VALUE ('7') could never equal one — every answer would mark wrong. Caught
  // by the games replay comparison; see fromGame.js.
  const a = fromGame({ game: gameDoc({ questions: [
    { question: 'x', options: ['5', '7'], answer: 7 },
  ] }) })
  assert.equal(a.questions[0].answerKey.correctAnswer, 1)
  assert.equal(a.questions[0].answerKey.correctAnswer, a.questions[0].correctIndex,
    'the card paints from correctIndex and the score comes from this — they cannot disagree')
})

test('an OBJECT option normalises to the string "[object Object]"', () => {
  // Not an aspiration — a record of what the normaliser does today, and the
  // whole justification for `PublicQuizRunner` refusing such a paper rather
  // than serving it on the engine.
  //
  // `toRichContent` reaches `getRichPlainText`, which has no branch for an
  // option object, so `String(o)` wins. The past-paper card's shape is
  // `{ text | textJSON, imageUrl?, diagram?, isCorrect? }`, and EVERY one of
  // those — including an option carrying nothing but good text — comes out as
  // the literal characters "[object Object]". A learner would meet four
  // identical unreadable rows on a public, crawled route.
  //
  // The refusal is the fix rather than teaching the model this shape, because
  // nothing writes it: `src/editor/schema/question.js` declares
  // `options: z.array(z.string())`. If a writer ever appears, THIS is the test
  // that says what has to change first.
  const a = fromQuiz({
    quiz: quizDoc(),
    questions: [quizQuestion({
      options: [{ text: 'A triangle', imageUrl: 'a.png' }, { text: 'A square' }],
      correctAnswer: 0,
    })],
    source: 'pastPaperQuiz',
  })
  assert.equal(a.questions[0].options[0].plainTextFallback, '[object Object]')
  assert.equal(a.questions[0].options[1].plainTextFallback, '[object Object]',
    'the text-only option is no better off — the failure is the object, not the media')
  assert.equal(a.questions[0].options[0].tiptapDoc, null)
})

test('a quiz index pointing past the options is refused', () => {
  const a = fromQuiz({
    quiz: quizDoc(),
    questions: [quizQuestion({ options: ['a', 'b'], correctAnswer: 7 })],
    source: 'quiz',
  })
  assert.equal(a.questions[0].correctIndex, null)
})

// ── RichContent: wrap on read, never mutate the source ───────────────────────

test('a legacy plain-string prompt becomes RichContent with a null doc', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion()], source: 'quiz' })
  const { prompt } = a.questions[0]
  assert.equal(prompt.version, RICH_CONTENT_VERSION)
  assert.equal(prompt.tiptapDoc, null, 'null is the honest answer for a plain string')
  assert.equal(prompt.plainTextFallback, 'What is 2 + 2?')
})

test('a Tiptap doc prompt is carried through as a doc', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] }
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion({ text: doc })], source: 'quiz' })
  assert.deepEqual(a.questions[0].prompt.tiptapDoc, doc)
  assert.equal(a.questions[0].prompt.plainTextFallback, 'Hi')
})

test('the stored question object is not mutated', () => {
  const raw = quizQuestion()
  const before = JSON.stringify(raw)
  fromQuiz({ quiz: quizDoc(), questions: [raw], source: 'quiz' })
  assert.equal(JSON.stringify(raw), before, '§4.1 note 3: stored documents are never mutated in place')
})

test('RichContent records its known HTML gap rather than hiding it', () => {
  // getRichPlainText does not strip markup. No Phase 3 source stores prompts as
  // HTML, so this is latent — but recorded here so it is a decision, not a
  // surprise, if a future source does.
  const rc = toRichContent('<p>2 + 2 = <b>?</b></p>')
  assert.equal(rc.tiptapDoc, null)
  assert.equal(rc.plainTextFallback, '<p>2 + 2 = <b>?</b></p>')
})

// ── schemaVersion is read-time only ──────────────────────────────────────────

test('schemaVersion is stamped on the model', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion()], source: 'quiz' })
  assert.equal(a.schemaVersion, ASSESSMENT_SCHEMA_VERSION)
})

test('schemaVersion is NOT written back onto the source documents', () => {
  const quiz = quizDoc()
  const question = quizQuestion()
  fromQuiz({ quiz, questions: [question], source: 'quiz' })
  assert.equal('schemaVersion' in quiz, false, 'read-time only — architecture.md §4.1 phasing note')
  assert.equal('schemaVersion' in question, false)
})

// ── Marks ────────────────────────────────────────────────────────────────────

test('totalMarks is summed from the questions, not read from the header', () => {
  const a = fromQuiz({
    // A header that disagrees with its own paper must not win: the sum is what
    // a scorer divides by.
    quiz: quizDoc({ totalMarks: 999 }),
    questions: [quizQuestion({ marks: 2 }), quizQuestion({ id: 'q2', marks: 3 })],
    source: 'quiz',
  })
  assert.equal(a.totalMarks, 5)
})

test('marks are clamped by the shared policy, not a local one', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion({ marks: 999 })], source: 'quiz' })
  assert.ok(a.questions[0].marks <= 20, 'MARKS_BOUNDS.quiz caps at 20')
  assert.ok(a.questions[0].marks >= 1)
})

test('a game question is worth one mark and the total follows', () => {
  const a = fromGame({ game: gameDoc() })
  assert.equal(a.questions[0].marks, 1)
  assert.equal(a.totalMarks, 2)
})

// ── Identity fields are not normalised toward each other ─────────────────────

test("a game's Number grade and lowercased subject are not 'corrected'", () => {
  const a = fromGame({ game: gameDoc({ grade: 4, subject: 'mathematics' }) })
  // Carried as strings because the model's fields are strings — but NOT
  // title-cased or mapped onto the quiz vocabulary. gamesService.js documents
  // that divergence as deliberate and every games read query depends on it.
  assert.equal(a.grade, '4')
  assert.equal(a.subject, 'mathematics')
})

test("a quiz's string grade stays a string", () => {
  const a = fromQuiz({ quiz: quizDoc({ grade: '4' }), questions: [], source: 'quiz' })
  assert.equal(a.grade, '4')
  assert.equal(typeof a.grade, 'string')
})

// ── Types go through the shared vocabulary ───────────────────────────────────

test('an aliased type is folded to the canonical one', () => {
  const a = fromQuiz({
    quiz: quizDoc(),
    questions: [quizQuestion({ type: 'truefalse', options: ['True', 'False'], correctAnswer: 0 })],
    source: 'quiz',
  })
  assert.equal(a.questions[0].type, 'tf', "'truefalse' is an alias the shared package owns")
})

test('every game question is a choice question', () => {
  const a = fromGame({ game: gameDoc() })
  for (const q of a.questions) assert.equal(q.type, 'mcq')
})

// ── The answer key passes through untouched ──────────────────────────────────

test('type-specific answer-key fields are carried, not reshaped', () => {
  const a = fromQuiz({
    quiz: quizDoc(),
    questions: [quizQuestion({ type: 'numeric', correctAnswer: 3.14, tolerance: 0.01 })],
    source: 'quiz',
  })
  assert.equal(a.questions[0].answerKey.correctAnswer, 3.14)
  assert.equal(a.questions[0].answerKey.tolerance, 0.01)
})

// ── Timing ───────────────────────────────────────────────────────────────────

test('a quiz carries its own duration; untimed by default', () => {
  const untimed = fromQuiz({ quiz: quizDoc({ duration: 30 }), questions: [], source: 'quiz' })
  assert.equal(untimed.settings.timed, false)
  assert.equal(untimed.settings.durationMinutes, 30)
  const timed = fromQuiz({ quiz: quizDoc({ duration: 30 }), questions: [], source: 'quiz', timed: true })
  assert.equal(timed.settings.timed, true)
})

test("a game's round timer is not reported as a paper duration", () => {
  const a = fromGame({ game: gameDoc({ seconds: 60 }) })
  assert.equal(a.settings.timed, true)
  assert.equal(a.settings.durationMinutes, null,
    'seconds rounded to minutes would show a minute clock for a second-granularity game')
})

// ── Corrupt input degrades, it does not throw ────────────────────────────────

test('a non-object question is dropped rather than crashing the runner', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion(), null, 'nonsense'], source: 'quiz' })
  assert.equal(a.questions.length, 1)
  assertAssessment(a)
})

test('a missing questions list yields an empty, still-valid assessment', () => {
  for (const questions of [undefined, null, 'nope', {}]) {
    const a = fromQuiz({ quiz: quizDoc(), questions, source: 'quiz' })
    assert.equal(a.questions.length, 0)
    assert.equal(a.totalMarks, 0)
    assertAssessment(a)
  }
})

test('a game with no questions is valid and empty', () => {
  const a = fromGame({ game: gameDoc({ questions: undefined }) })
  assert.equal(a.questions.length, 0)
  assertAssessment(a)
})

// ── The single door ──────────────────────────────────────────────────────────

test('normaliseAssessment dispatches every known source', () => {
  assert.equal(normaliseAssessment({ quiz: quizDoc(), questions: [], source: 'quiz' }).source, 'quiz')
  assert.equal(normaliseAssessment({ quiz: quizDoc(), questions: [], source: 'pastPaperQuiz' }).source, 'pastPaperQuiz')
  assert.equal(normaliseAssessment({ game: gameDoc(), source: 'game' }).source, 'game')
})

test('an unknown source THROWS rather than returning an empty assessment', () => {
  // An empty assessment is indistinguishable from a real one with no questions,
  // so the engine would render a blank runner instead of reporting the problem.
  assert.throws(() => normaliseAssessment({ source: 'dailyExam' }), /unknown source/)
  assert.throws(() => normaliseAssessment({}), /unknown source/)
})

// ── The validator earns its place ────────────────────────────────────────────

test('safeAssessment rejects a malformed model instead of throwing', () => {
  const a = fromQuiz({ quiz: quizDoc(), questions: [quizQuestion()], source: 'quiz' })
  assert.equal(safeAssessment(a).ok, true)
  assert.equal(safeAssessment({ ...a, schemaVersion: 99 }).ok, false)
  assert.equal(safeAssessment({ ...a, source: 'dailyExam' }).ok, false)
})

// ── The front door works ─────────────────────────────────────────────────────
//
// This is a load-and-call check, and that is ALL it is. Importing proves the
// module loads in THIS environment, which is the one environment already known
// to work — the neutrality guarantee is a source scan and lives in
// `purity.test.js`, for the reason `functions/shared/assessment/neutrality.test.js`
// states in its own docblock. An earlier draft of this block claimed to catch a
// transitive React import; a control proved it did not, because `react`
// resolves perfectly well under node.

const engine = await import('../index.js')

test('the public API exposes the single door', () => {
  assert.equal(typeof engine.normaliseAssessment, 'function')
  assert.equal(typeof engine.assertAssessment, 'function')
  assert.equal(typeof engine.toRichContent, 'function')
})

test('the front door normalises all three sources', () => {
  assert.equal(engine.normaliseAssessment({ quiz: quizDoc(), questions: [quizQuestion()], source: 'quiz' }).questions.length, 1)
  assert.equal(engine.normaliseAssessment({ quiz: quizDoc(), questions: [], source: 'pastPaperQuiz' }).source, 'pastPaperQuiz')
  assert.equal(engine.normaliseAssessment({ game: gameDoc(), source: 'game' }).questions.length, 2)
})

console.log(`\nassessment normaliser: ${passed} passed`)
