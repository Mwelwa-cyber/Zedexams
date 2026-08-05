/**
 * The OLD quiz path's write journal, replayed from recorded attempts and pinned.
 *
 * ## What this is, precisely
 *
 * `docs/phase3-plan.md` §3.3 describes replaying an attempt through BOTH paths
 * and diffing the journals. **The engine has no write adapter yet**, so there is
 * no second path and this is not that test. It is the OLD side of it, captured
 * while the old path is still the only one.
 *
 * That is worth having on its own, for two reasons:
 *
 *   1. **The baseline is recorded and reviewed BEFORE a cutover exists.** When
 *      the engine's adapter lands, the comparison runs against a journal a
 *      reviewer already agreed to, rather than one produced under pressure to
 *      make a cutover pass. A baseline captured at cutover time is a baseline
 *      that encodes whatever the new code happens to do.
 *   2. **The old path can drift before then.** `buildQuizResultPayload` is live
 *      and editable today. If it changes, this fails, and that is a real signal
 *      whether the change was intended or not.
 *
 * When `persist/` exists, `assertSameJournal` below gains a second argument and
 * this becomes the comparison §3.3 asks for. `diffJournals` is already written
 * and already has its own controls, so that step adds a caller, not a rule.
 *
 * ## Why the expectations are computed, not stored
 *
 * The fixtures hold INPUTS. What each attempt should score is asserted here from
 * the attempt itself — `happy-path` is two correct one-mark questions, so it is
 * 2/2 and 100%. A stored expectation file would be a second copy of the answer,
 * and the usual failure of golden files is that a wrong value gets blessed into
 * the golden and then defended by it.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRecorder, diffJournals } from './journal.js'
import { buildQuizResultPayload, QUIZ_RESULT_PAYLOAD_KEYS } from '../../src/utils/quizResultPayload.js'

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

/**
 * Replay one attempt through the current quiz path, returning its journal.
 *
 * The path is `QuizRunnerV2.handleSubmit` → `saveResult`, which is one
 * `addDoc` into `results`. `buildQuizResultPayload` is the seam extracted in
 * #2114 precisely so this could be called without rendering the runner.
 */
function replayQuizPath(fixture) {
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
  // saveResult adds completedAt: serverTimestamp() — represented by a sentinel,
  // because the value is Firestore's and is one of the three declared volatiles.
  recorder.addDoc('results', { ...payload, completedAt: 'SERVER_TIMESTAMP' })
  return recorder.journal()
}

console.log('replay — quiz results baseline')

// ── Every fixture is exercised ───────────────────────────────────────────────

test('every fixture on disk is replayed — none is silently skipped', () => {
  assert.ok(fixtureNames.length >= 6, `expected at least 6 fixtures, found ${fixtureNames.length}`)
  for (const name of fixtureNames) {
    const journal = replayQuizPath(load(name))
    assert.equal(journal.length, 1, `${name}: the quiz path writes exactly one document`)
    assert.equal(journal[0].path, 'results')
    assert.equal(journal[0].op, 'addDoc')
  }
})

test('every fixture explains itself', () => {
  // A fixture nobody can tell the purpose of is a fixture nobody can tell is
  // still needed.
  for (const name of fixtureNames) {
    const f = load(name)
    assert.equal(typeof f.note, 'string', `${name}: missing note`)
    assert.ok(f.note.length > 20, `${name}: note is too thin to be useful`)
  }
})

test('the written field set is exactly the declared one, on every fixture', () => {
  for (const name of fixtureNames) {
    const [write] = replayQuizPath(load(name))
    assert.deepEqual(
      Object.keys(write.payload).sort(),
      [...QUIZ_RESULT_PAYLOAD_KEYS, 'completedAt'].sort(),
      `${name}: the results document's field set changed`,
    )
  }
})

// ── Replay is deterministic ──────────────────────────────────────────────────

test('replaying the same attempt twice produces an identical journal', () => {
  // The property the whole harness rests on. If this were false, a cutover
  // comparison could fail for reasons that have nothing to do with the cutover.
  for (const name of fixtureNames) {
    const f = load(name)
    assert.equal(diffJournals(replayQuizPath(f), replayQuizPath(f)).identical, true, name)
  }
})

// ── The scores each attempt should produce, derived from the attempt ─────────

test('happy-path: two correct one-mark questions is 2/2, 100%, settled', () => {
  const [write] = replayQuizPath(load('happy-path'))
  const p = write.payload
  assert.equal(p.score, 2)
  assert.equal(p.totalMarks, 2)
  assert.equal(p.percentage, 100)
  assert.equal(p.scoreStatus, 'final')
  assert.equal(p.finalScore, 100)
})

test('pending-ai-answer: provisional, and the partial mark is NOT final', () => {
  const [write] = replayQuizPath(load('pending-ai-answer'))
  const p = write.payload
  assert.equal(p.gradingStatus, 'pending')
  assert.equal(p.scoreStatus, 'provisional')
  assert.equal(p.finalScore, null, 'an inflated partial mark must never be recorded as settled')
  assert.deepEqual(p.pendingQuestionIds, ['q2'])
})

test('unanswered-submit: a settled zero, not a pending one', () => {
  const [write] = replayQuizPath(load('unanswered-submit'))
  const p = write.payload
  assert.equal(p.score, 0)
  assert.equal(p.percentage, 0)
  assert.equal(p.scoreStatus, 'final', 'answering nothing is a decision, not an unfinished marking')
})

test('zero-score: graded wrong answers are a settled zero, distinct from unanswered', () => {
  const zero = replayQuizPath(load('zero-score'))[0].payload
  const none = replayQuizPath(load('unanswered-submit'))[0].payload
  assert.equal(zero.score, 0)
  assert.equal(zero.scoreStatus, 'final')
  // Both score 0, but they are different attempts and the journals differ —
  // the answers map is written, so the record distinguishes them.
  assert.notDeepEqual(zero.answers, none.answers)
})

test('five-option-mcq: the fifth option is scorable', () => {
  const [write] = replayQuizPath(load('five-option-mcq'))
  assert.equal(write.payload.score, 2, 'a 2-mark question answered correctly at index 4')
  assert.equal(write.payload.percentage, 100)
})

test('legacy-plain-string: an attempt with no recorded start writes timeSpent 0', () => {
  const [write] = replayQuizPath(load('legacy-plain-string'))
  assert.equal(write.payload.timeSpent, 0)
  assert.equal(write.payload.score, 1)
})

// ── Wall-clock time IS deterministic here, and is pinned ─────────────────────
//
// A finding from running the controls. `timeSpent` is on `journal.js`'s VOLATILE
// list, and correctly so: in a LIVE capture the same attempt replayed at a
// different moment yields a different elapsed value.
//
// But these fixtures INJECT the clock — `startTime` and `nowMs` are both fixed
// inputs — so `timeSpent` is fully determined by the fixture, and exempting it
// means a changed rounding rule slips through. A control proved exactly that:
// swapping Math.round for Math.ceil(+1) was the one mutation the baseline did
// not catch.
//
// So the exemption is a property of live capture, not of replay, and the
// old-vs-new comparison must COMPARE timeSpent rather than exempt it whenever
// both paths are handed the same nowMs. The VOLATILE list stays as it is for
// the live case; this asserts the replay case.

test('timeSpent is pinned wherever the fixture fixes the clock', () => {
  for (const name of fixtureNames) {
    const f = load(name)
    if (!f.startTime) continue
    const [write] = replayQuizPath(f)
    const expected = Math.round((f.nowMs - f.startTime) / 1000)
    assert.equal(write.payload.timeSpent, expected,
      `${name}: elapsed is determined by the fixture, so a rounding change must fail here`)
  }
})

test('at least one fixture actually fixes the clock', () => {
  // Without this the loop above can pass by skipping everything — the vacuous
  // pass that makes a guard look green while guarding nothing.
  assert.ok(fixtureNames.some((n) => load(n).startTime), 'no fixture exercises the elapsed-time path')
})

// ── Identity fields are written as the quiz path writes them ─────────────────

test('grade is written as a STRING, as the quiz path stores it', () => {
  const [write] = replayQuizPath(load('happy-path'))
  assert.equal(write.payload.grade, '4')
  assert.equal(typeof write.payload.grade, 'string',
    'the scores collection stores a Number by deliberate divergence; these must not converge')
})

console.log(`\nreplay quiz results baseline: ${passed} passed`)
