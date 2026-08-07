/**
 * The comparison §3.3 asks for: every recorded attempt replayed through BOTH
 * paths, and the two write journals diffed.
 *
 * This is what `scripts/replay/journal.js` was built for and could not do
 * until now — there was one path, so a "comparison" was one path checked
 * against itself. `persist/` is the second, so the differ finally has a second
 * journal.
 *
 *   OLD: fixture → `buildQuizResultPayload` → addDoc('results', …)
 *   NEW: fixture → `fromQuiz` → `markAttempt('clientKey')`
 *                → `buildResultDocument` → addDoc('results', …)
 *
 * The two are independent in the way that matters: the engine reaches its
 * numbers through the canonical model, which is a lossy-looking projection of
 * the raw documents the old path reads. If anything is lost in `normalise` —
 * an answer key, a topic, a mark — the score changes and this fails.
 *
 * ## Nothing here is exempted quietly
 *
 * Two options are passed to the differ and both are decisions, not conveniences:
 *
 *   • `compareWallClock: true` — the fixtures INJECT the clock, so `timeSpent`
 *     is deterministic and must be compared. The baseline run established this:
 *     with it exempt, swapping `Math.round` for `Math.ceil` was the one mutation
 *     nothing caught.
 *   • `deviations` — the single approved deviation, stated as both sides, per
 *     fixture. A fixture with a known start declares none, so if the engine ever
 *     wrote null for a MEASURED attempt this fails.
 *
 * That is the whole point of agreeing the rules before the cutover: the only
 * difference these journals are allowed to have is one somebody decided on,
 * in writing, for a reason that is printed when it fails.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRecorder, diffJournals } from './journal.js'
import { buildQuizResultPayload } from '../../src/utils/quizResultPayload.js'
import { fromQuiz } from '../../src/engines/assessment-engine/normalise/fromQuiz.js'
import { markAttempt } from '../../src/engines/assessment-engine/marking/index.js'
import { buildResultDocument } from '../../src/engines/assessment-engine/persist/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURES = join(ROOT, 'tests/fixtures/attempts')

const load = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))
const fixtureNames = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/** The OLD path: `QuizRunnerV2.handleSubmit` → `saveResult`, one addDoc. */
function replayOld(fixture) {
  const recorder = createRecorder()
  const payload = buildQuizResultPayload({
    quiz: fixture.quiz,
    quizId: fixture.quiz.id,
    questions: fixture.questions,
    answers: fixture.answers,
    mode: fixture.mode,
    userId: fixture.userId,
    startTime: fixture.startTime,
    nowMs: fixture.nowMs,
  })
  recorder.addDoc('results', { ...payload, completedAt: 'SERVER_TIMESTAMP' })
  return recorder.journal()
}

/** The ENGINE path: normalise → mark → build → one addDoc. */
function replayEngine(fixture) {
  const recorder = createRecorder()
  const assessment = fromQuiz({
    quiz: fixture.quiz,
    questions: fixture.questions,
    source: 'quiz',
    timed: fixture.mode === 'exam',
  })
  const verdict = markAttempt({ assessment, answers: fixture.answers, strategy: 'clientKey' })
  const document = buildResultDocument({
    assessment,
    attempt: {
      userId: fixture.userId,
      answers: fixture.answers,
      mode: fixture.mode,
      startedAtMs: fixture.startTime,
    },
    verdict,
    nowMs: fixture.nowMs,
  })
  recorder.addDoc('results', { ...document, completedAt: 'SERVER_TIMESTAMP' })
  return recorder.journal()
}

/**
 * The approved deviations for one fixture — see
 * `persist/resultDocument.js` and the session contract.
 *
 * Derived from the fixture rather than listed per name, because a per-name list
 * would need editing every time a fixture is added and the usual way that goes
 * is the new fixture quietly getting no deviation and no comparison.
 */
function deviationsFor(fixture) {
  if (fixture.startTime) return []
  return [{
    write: 0,
    field: 'timeSpent',
    from: 0,
    to: null,
    reason: 'approved deviation: the old path records an unmeasured attempt as 0 seconds; '
      + 'the engine records that the start is unknown',
  }]
}

console.log('replay — old path vs engine')

// ── The comparison ───────────────────────────────────────────────────────────

test('every fixture produces an IDENTICAL journal, deviations aside', () => {
  for (const name of fixtureNames) {
    const fixture = load(name)
    const { identical, differences } = diffJournals(replayOld(fixture), replayEngine(fixture), {
      deviations: deviationsFor(fixture),
      compareWallClock: true,
    })
    assert.equal(identical, true, `${name}:\n    ${differences.join('\n    ')}`)
  }
})

test('every fixture on disk is compared — none is silently skipped', () => {
  assert.ok(fixtureNames.length >= 7, `expected at least 7 fixtures, found ${fixtureNames.length}`)
})

test('both paths write exactly one document, to `results`', () => {
  // Byte-compatibility is about the writes, not only the payload: an engine
  // that also touched a streak counter would be a behaviour change however
  // identical this document looked.
  for (const name of fixtureNames) {
    for (const journal of [replayOld(load(name)), replayEngine(load(name))]) {
      assert.equal(journal.length, 1, name)
      assert.equal(journal[0].path, 'results')
      assert.equal(journal[0].op, 'addDoc')
    }
  }
})

// ── The comparison is capable of failing ─────────────────────────────────────
//
// A green comparison is only evidence if it could have been red. These build
// a journal that SHOULD differ and check that it does — the same discipline as
// the differ's own controls, applied to this harness's wiring rather than to
// the rules.

test('the comparison catches a changed score', () => {
  const fixture = load('happy-path')
  const engine = replayEngine(fixture)
  engine[0].payload.score += 1
  assert.equal(diffJournals(replayOld(fixture), engine, { compareWallClock: true }).identical, false)
})

test('the comparison catches a dropped field', () => {
  const fixture = load('happy-path')
  const engine = replayEngine(fixture)
  delete engine[0].payload.topicScores
  assert.equal(diffJournals(replayOld(fixture), engine, { compareWallClock: true }).identical, false)
})

test('the comparison catches an extra write', () => {
  const fixture = load('happy-path')
  const engine = replayEngine(fixture)
  engine.push({ op: 'setDoc', path: 'dailyStreaks/learner-1', payload: { streak: 2 } })
  assert.equal(diffJournals(replayOld(fixture), engine, { compareWallClock: true }).identical, false)
})

// ── The deviation, in both directions ────────────────────────────────────────

test('legacy-plain-string is the fixture that exercises the deviation', () => {
  // Named explicitly so the deviation cannot become untested by a fixture
  // being edited to have a start time.
  const fixture = load('legacy-plain-string')
  assert.ok(!fixture.startTime, 'this fixture must have no recorded start')
  assert.equal(replayOld(fixture)[0].payload.timeSpent, 0)
  assert.equal(replayEngine(fixture)[0].payload.timeSpent, null)
})

test('the deviation is NOT taken where the attempt has a measured start', () => {
  // The failure this guards against is an engine that writes null generally
  // rather than only when the start is unknown — which would look like a
  // passing comparison if the deviation were declared for every fixture.
  for (const name of fixtureNames) {
    const fixture = load(name)
    if (!fixture.startTime) continue
    const expected = Math.round((fixture.nowMs - fixture.startTime) / 1000)
    assert.equal(replayEngine(fixture)[0].payload.timeSpent, expected, name)
    assert.equal(replayOld(fixture)[0].payload.timeSpent, expected, name)
  }
})

test('at least one fixture measures the clock and at least one does not', () => {
  // Without both, one of the two assertions above passes vacuously.
  assert.ok(fixtureNames.some((n) => load(n).startTime), 'no fixture exercises a measured duration')
  assert.ok(fixtureNames.some((n) => !load(n).startTime), 'no fixture exercises the deviation')
})

// ── The types the MCQ fixtures cannot see ────────────────────────────────────

test('the four non-`correctAnswer` answer keys survive the round trip', () => {
  // The defect this exists for: `ANSWER_KEY_FIELDS` shipped without
  // `statements`, `diagramLabels`, `matchingLeft` or `sequenceItems`, so these
  // four types would have marked as a silent zero through the engine while
  // every MCQ fixture stayed green.
  const fixture = load('typed-answer-keys')
  const engine = replayEngine(fixture)[0].payload
  assert.equal(engine.score, 9, 'all four types answered correctly')
  assert.equal(engine.percentage, 100)
  assert.deepEqual(Object.keys(engine.topicScores).sort(),
    ['DiagramLabel', 'FillBlanks', 'Matching', 'Sequence'])
})

test('and those keys are actually consulted — a wrong answer scores less', () => {
  // All-correct proves nothing on its own: a grader that returned true
  // unconditionally would also score 9. This is the discrimination check.
  const fixture = load('typed-answer-keys')
  const wrong = { ...fixture, answers: { ...fixture.answers, q3: [2, 1, 0] } }
  assert.equal(replayEngine(wrong)[0].payload.score, 6)
  assert.equal(replayOld(wrong)[0].payload.score, 6, 'and both paths agree about it')
})

console.log(`\nreplay engine comparison: ${passed} passed`)
