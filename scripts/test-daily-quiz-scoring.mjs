/**
 * test:daily-quiz-scoring — a forged score field changes nothing.
 *
 * This is a SOURCE test, not a behaviour test, and that is deliberate. The
 * property it defends is an ABSENCE: `answerDailyQuizQuestion` must never
 * read a score, a points total or a correctness flag off the client payload.
 * A behaviour test cannot see the difference between "the field was ignored"
 * and "the field happened not to be set in this fixture" — and absence is
 * exactly what a later refactor reintroduces by accident, by adding one
 * convenience field to a request object.
 *
 * The acceptance criterion it encodes: *"Calling the score endpoint with a
 * forged score field changes nothing."*
 *
 * It also pins the two other places the answer key could leak, for the same
 * reason: they are all claims about what the code does NOT do.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const fns = read('functions/dailyQuiz/dailyQuizFns.js')
const service = read('functions/dailyQuiz/dailyQuizService.js')
const core = read('functions/dailyQuiz/dailyQuizCore.js')

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('daily-quiz scoring integrity')

/** Every `request.data?.X` / `request.data.X` the answer handler reads. */
function requestFieldsRead(source) {
  const body = source.slice(
    source.indexOf('exports.answerDailyQuizQuestionHandler'),
    source.indexOf('// ── §3  the nightly cron'),
  )
  assert.ok(body.length > 200, 'could not isolate the answer handler')
  return new Set([...body.matchAll(/request\.data\??\.(\w+)/g)].map((m) => m[1]))
}

test('the answer handler reads ONLY questionId, chosen and elapsedMs', () => {
  const fields = requestFieldsRead(fns)
  assert.deepEqual(
    [...fields].sort(),
    ['chosen', 'elapsedMs', 'questionId'],
    'a new client-supplied field reached the scorer',
  )
})

test('no score-shaped field is read from the client payload', () => {
  const fields = requestFieldsRead(fns)
  // The forged-score acceptance case, stated as the list it must never grow.
  for (const forged of [
    'score', 'points', 'correct', 'credited', 'allCorrect', 'marks',
    'ranked', 'grade', 'result', 'answers',
  ]) {
    assert.ok(!fields.has(forged), `answerDailyQuizQuestion reads request.data.${forged}`)
  }
})

test('the grade is resolved from the profile, never from the request', () => {
  // A client-supplied grade is how a learner ends up on another grade's quiz.
  assert.match(fns, /resolveLearnerGrade\(db, uid\)/)
  assert.match(
    fns,
    /db\.collection\("users"\)\.doc\(uid\)\.get\(\)/,
    'resolveLearnerGrade must read the profile',
  )
  const resolver = fns.slice(
    fns.indexOf('async function resolveLearnerGrade'),
    fns.indexOf('async function mayRank'),
  )
  assert.ok(!/request/.test(resolver), 'resolveLearnerGrade must not touch the request')
})

test('the points arithmetic lives in the pure core, not in the handler', () => {
  // Scoring that drifts into the handler is scoring that stops being tested.
  assert.match(fns, /scoreAttempt\(\{/)
  assert.match(core, /function scoreAttempt/)
  assert.match(core, /POINTS_PER_CORRECT = 10/)
  assert.match(core, /ALL_CORRECT_BONUS = 10/)
  const body = fns.slice(
    fns.indexOf('exports.answerDailyQuizQuestionHandler'),
    fns.indexOf('// ── §3  the nightly cron'),
  )
  assert.ok(!/\* 10\b/.test(body), 'points arithmetic leaked into the handler')
})

test('the learner payload strips every answer-key field', () => {
  assert.match(
    service,
    /const ANSWER_KEY_FIELDS = \["correctAnswer", "tolerance", "correctRegion", "explanation"\]/,
  )
  const loader = service.slice(
    service.indexOf('async function loadLearnerQuestions'),
    service.indexOf('async function loadAnswerKey'),
  )
  assert.match(loader, /for \(const f of ANSWER_KEY_FIELDS\) delete clean\[f\]/)
  // The stripped object is what is spread into the response — a later edit
  // that returns `question` instead of `clean` would leak the key.
  assert.ok(!/text: question\./.test(loader), 'the loader returned the unstripped question')
})

test('getTodaysQuiz never returns the answer key', () => {
  const handler = fns.slice(
    fns.indexOf('exports.getTodaysQuizHandler'),
    fns.indexOf('/** The parts of a stored attempt a client may see. */'),
  )
  assert.ok(handler.length > 200, 'could not isolate getTodaysQuiz')
  assert.ok(!/loadAnswerKey/.test(handler), 'getTodaysQuiz reached for the answer key')
  assert.match(handler, /loadLearnerQuestions/)
})

test('the once-a-day lock is a transactional create, not a read-then-write', () => {
  // A read-then-write races: two taps land two attempts and the board is
  // credited twice.
  const body = fns.slice(
    fns.indexOf('exports.answerDailyQuizQuestionHandler'),
    fns.indexOf('// ── §3  the nightly cron'),
  )
  assert.match(body, /db\.runTransaction/)
  assert.match(body, /await tx\.get\(attemptRef\)/)
  // An answer already recorded is returned, never re-marked.
  assert.match(body, /if \(already\) return/)
})

test('the leaderboard is only written for a finalised, consented attempt', () => {
  const body = fns.slice(
    fns.indexOf('exports.answerDailyQuizQuestionHandler'),
    fns.indexOf('// ── §3  the nightly cron'),
  )
  assert.match(body, /if \(outcome\.finalised\)/)
  assert.match(body, /ranked = await mayRank\(db, uid\)/)
  assert.match(body, /if \(ranked && outcome\.score\.points > 0\)/)
  // mayRank fails CLOSED — an unreadable consent state must not rank a child.
  const gate = fns.slice(fns.indexOf('async function mayRank'), fns.indexOf('// ── §1'))
  assert.match(gate, /return false/)
})

test('a practice set is refused by the scorer rather than scored as zero', () => {
  // `ranked: false` has to be true rather than decorative.
  const body = fns.slice(
    fns.indexOf('exports.answerDailyQuizQuestionHandler'),
    fns.indexOf('// ── §3  the nightly cron'),
  )
  assert.match(body, /quiz\.status === "thin"/)
  assert.match(body, /not scored/)
})

if (failures) {
  console.error(`daily-quiz scoring integrity — ${failures} failed`)
  process.exit(1)
}
console.log('daily-quiz scoring integrity — all passed')
