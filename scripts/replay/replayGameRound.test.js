/**
 * The §3 comparison for the GAMES cutover: every recorded round replayed
 * through both verdicts, and the two write journals diffed.
 *
 *   OLD:    round → `timedQuizCore.correctIndexFor` → outcome → `scores`
 *   ENGINE: round → `fromGame` → `markAttempt('clientKey')` → outcome → `scores`
 *
 * ## What is being compared, and why it is narrower than the quiz's
 *
 * The quiz cutover moved the WRITER: `persist/buildResultDocument` replaced
 * `buildQuizResultPayload`, so the comparison had two independent document
 * builders to diff. Games does not move the writer, deliberately — `scores`
 * stores grade as a Number and subject lowercased (D5, the single most
 * load-bearing sentence in the games path), and `buildGameScorePayload` reads
 * those off the `games` document rather than off the canonical model, which
 * carries them as strings. One builder, both paths.
 *
 * So what the engine actually supplies at this runner is the VERDICT, and that
 * is what this harness isolates. Everything downstream of it — the streak
 * bonus, the penalty floor, the accuracy, the four writes — is shared code.
 * A divergence in a written `scores` document can therefore only have come from
 * the verdict, and the discrimination tests at the bottom prove the verdict is
 * genuinely consulted rather than the two paths merely agreeing by construction.
 *
 * ## One outcome, four writes
 *
 * A finished round writes `scores`, `badges`, `dailyStreaks` and
 * `learner_profiles`. Only the first is journalled here, because the other
 * three are each handed a SUBSET of the same outcome object
 * (`evaluateAndAwardGameBadges`, `recordDailyPlay`,
 * `updateLearnerProfileAfterGame`), and `TimedQuizGame.finish()` passes
 * `outcome.*` to each by field. An identical outcome is therefore the
 * byte-compatibility argument for all four, and the outcome itself is asserted
 * identical below rather than left implied by the document.
 *
 * ## No deviations
 *
 * Unlike the quiz comparison, this one declares NONE. The quiz's approved
 * `timeSpent: null` deviation exists because the engine chose to record an
 * unknown start honestly; games has no such choice to make — `timeSpentSeconds`
 * falls back to the full round duration on both paths, and
 * `unstarted-round.json` is the fixture that proves it. An exemption appearing
 * here later would be a decision, and it would have to be written down.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRecorder, diffJournals } from './journal.js'
import { correctIndexFor } from '../../src/features/games/lib/timedQuizCore.js'
import { buildGameRoundOutcome, GAME_ROUND_OUTCOME_KEYS } from '../../src/features/games/lib/timedQuizRound.js'
import { buildGameScorePayload, GAME_SCORE_PAYLOAD_KEYS } from '../../src/utils/gameScorePayload.js'
import { fromGame } from '../../src/engines/assessment-engine/normalise/fromGame.js'
import { markAttempt } from '../../src/engines/assessment-engine/marking/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FIXTURES = join(ROOT, 'tests/fixtures/rounds')

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

/** The OLD verdict: the loose string comparison `TimedQuizGame.pick()` made. */
const oldVerdict = (game) => ({ poolIndex, optionIndex }) =>
  optionIndex === correctIndexFor(game.questions[poolIndex])

/** The ENGINE verdict: the canonical assessment, marked one answer at a time. */
const engineVerdict = (assessment) => ({ poolIndex, optionIndex }) => {
  const question = assessment.questions[poolIndex]
  if (!question) return false
  return markAttempt({
    assessment,
    answers: { [question.id]: optionIndex },
    strategy: 'clientKey',
  }).score > 0
}

function outcomeFor(fixture, isCorrect) {
  return buildGameRoundOutcome({
    points: Number(fixture.game.points) || 10,
    duration: Number(fixture.game.timer) || 60,
    picks: fixture.picks,
    isCorrect,
    startedAtMs: fixture.startedAtMs,
    nowMs: fixture.nowMs,
  })
}

function journalFor(fixture, outcome) {
  const recorder = createRecorder()
  recorder.addDoc('scores', {
    ...buildGameScorePayload({
      game: fixture.game,
      outcome,
      userId: fixture.userId,
      displayName: fixture.displayName,
    }),
    playedAt: 'SERVER_TIMESTAMP',
  })
  return recorder.journal()
}

const replayOld = (fixture) => journalFor(fixture, outcomeFor(fixture, oldVerdict(fixture.game)))
const replayEngine = (fixture, assessment = fromGame({ game: fixture.game })) =>
  journalFor(fixture, outcomeFor(fixture, engineVerdict(assessment)))

console.log('replay — games: old verdict vs engine verdict')

// ── The comparison ───────────────────────────────────────────────────────────

test('every fixture produces an IDENTICAL journal, with no deviations declared', () => {
  for (const name of fixtureNames) {
    const fixture = load(name)
    const { identical, differences } = diffJournals(replayOld(fixture), replayEngine(fixture), {
      // The fixtures INJECT the clock, so `timeSpent` is deterministic and must
      // be compared rather than waved through as wall-clock noise.
      compareWallClock: true,
    })
    assert.equal(identical, true, `${name}:\n    ${differences.join('\n    ')}`)
  }
})

test('the five round numbers are identical too, not only the document', () => {
  // `badges`, `dailyStreaks` and `learner_profiles` are handed subsets of this
  // object rather than of the `scores` document, so comparing the document
  // alone would leave three of the four writes uncompared.
  for (const name of fixtureNames) {
    const fixture = load(name)
    const engineOutcome = outcomeFor(fixture, engineVerdict(fromGame({ game: fixture.game })))
    assert.deepEqual(engineOutcome, outcomeFor(fixture, oldVerdict(fixture.game)), name)
    assert.deepEqual(Object.keys(engineOutcome).sort(), [...GAME_ROUND_OUTCOME_KEYS].sort(), name)
  }
})

test('both paths write exactly one document, to `scores`', () => {
  // Byte-compatibility is about the writes, not only the payload: an engine
  // that also touched a streak counter would be a behaviour change however
  // identical this document looked.
  for (const name of fixtureNames) {
    for (const journal of [replayOld(load(name)), replayEngine(load(name))]) {
      assert.equal(journal.length, 1, name)
      assert.equal(journal[0].path, 'scores')
      assert.equal(journal[0].op, 'addDoc')
    }
  }
})

test('the written field set is exactly the one `scores` has always carried', () => {
  // A new field in a `scores` document is a schema change: `firestore.rules`
  // validates the create, and the leaderboard queries order on it.
  for (const name of fixtureNames) {
    const written = Object.keys(replayEngine(load(name))[0].payload).sort()
    assert.deepEqual(written, [...GAME_SCORE_PAYLOAD_KEYS].sort(), name)
  }
})

test('every fixture on disk is compared — none is silently skipped', () => {
  assert.ok(fixtureNames.length >= 7, `expected at least 7 fixtures, found ${fixtureNames.length}`)
})

// ── D5: the identity fields the leaderboard queries depend on ────────────────

test('grade stays a Number and subject stays lowercased on the ENGINE path', () => {
  // The failure this exists for: `fromGame` carries subject and grade as
  // STRINGS because the canonical model's fields are strings. An engine path
  // that built the score document from the assessment instead of from the game
  // would write `grade: "4"`, and every `where('grade','==',4)` leaderboard
  // query would return nothing — silently, with the scores still being saved.
  for (const name of fixtureNames) {
    const fixture = load(name)
    const written = replayEngine(fixture)[0].payload
    assert.equal(typeof written.grade, 'number', name)
    assert.equal(written.grade, Number(fixture.game.grade), name)
    assert.equal(written.subject, String(fixture.game.subject).toLowerCase(), name)
    // And the canonical model really does carry the other shape, so the check
    // above is discriminating rather than describing two identical things.
    const assessment = fromGame({ game: fixture.game })
    assert.equal(typeof assessment.grade, 'string', name)
  }
})

// ── The comparison is capable of failing ─────────────────────────────────────
//
// A green comparison is only evidence if it could have been red. Two layers:
// the wiring (does the differ see a changed journal at all) and the verdict
// (is the engine's answer actually load-bearing, or would any verdict pass).

test('the comparison catches a changed score', () => {
  const fixture = load('happy-path')
  const engine = replayEngine(fixture)
  engine[0].payload.score += 1
  assert.equal(diffJournals(replayOld(fixture), engine, { compareWallClock: true }).identical, false)
})

test('the comparison catches a dropped field', () => {
  const fixture = load('happy-path')
  const engine = replayEngine(fixture)
  delete engine[0].payload.bestStreak
  assert.equal(diffJournals(replayOld(fixture), engine, { compareWallClock: true }).identical, false)
})

test('the comparison catches an extra write', () => {
  const fixture = load('happy-path')
  const engine = replayEngine(fixture)
  engine.push({ op: 'setDoc', path: 'dailyStreaks/learner-1', payload: { streak: 2 } })
  assert.equal(diffJournals(replayOld(fixture), engine, { compareWallClock: true }).identical, false)
})

test('the ENGINE VERDICT is what the comparison rests on — break the canonical key and it fails', () => {
  // §5.1 criterion 3, in the form it takes at a runner where the engine
  // supplies no writer: deleting the engine's contribution must make this red.
  // Here the contribution IS the answer key `markAttempt` grades against, so
  // moving it is the equivalent of deleting the write adapter. If this passed,
  // the two paths would be agreeing for a reason that has nothing to do with
  // the engine having marked anything.
  const fixture = load('happy-path')
  const assessment = fromGame({ game: fixture.game })
  const corrupted = {
    ...assessment,
    questions: assessment.questions.map((q) => {
      // Shift the key to a different option that exists — not to null, which
      // would be the refusal case rather than a wrong answer.
      const moved = (q.correctIndex + 1) % q.options.length
      return { ...q, correctIndex: moved, answerKey: { correctAnswer: moved } }
    }),
  }
  const { identical } = diffJournals(replayOld(fixture), replayEngine(fixture, corrupted), {
    compareWallClock: true,
  })
  assert.equal(identical, false, 'a wrong canonical key produced the same document')
})

test('the key the CARD paints from and the key the SCORE comes from are the same number', () => {
  // Two representations of one fact, and they are read by different code:
  // `buildChoiceRows` paints the green ✓ from `correctIndex`, while
  // `markWithClientKey` scores from `answerKey.correctAnswer`. If they ever
  // disagreed the learner would be shown one option as the answer and credited
  // for another — no crash, no red test, and unattributable from either side.
  //
  // They cannot be collapsed into one field here: `fromQuiz` deliberately
  // carries a RAW `correctAnswer` (a stored true/false question's key is a
  // boolean, not an index) while deriving `correctIndex` only when the stored
  // key is a usable position. Games is the source where the two coincide, so it
  // is asserted rather than assumed.
  for (const name of fixtureNames) {
    const fixture = load(name)
    for (const q of fromGame({ game: fixture.game }).questions) {
      assert.equal(q.answerKey.correctAnswer, q.correctIndex, `${name}/${q.id}`)
    }
  }
})

test('and the fixtures actually discriminate — a round of all-correct is not the only shape compared', () => {
  // The corruption above only bites where a fixture has correct answers to get
  // wrong. Without this, a corpus of all-wrong rounds would make that control
  // pass vacuously.
  const scores = fixtureNames.map((n) => replayOld(load(n))[0].payload)
  assert.ok(scores.some((s) => s.correct > 0), 'no fixture answers anything correctly')
  assert.ok(scores.some((s) => s.wrong > 0), 'no fixture answers anything wrongly')
  assert.ok(scores.some((s) => s.score === 0), 'no fixture exercises the floor at zero')
  assert.ok(scores.some((s) => s.bestStreak >= 3), 'no fixture reaches the streak bonus')
})

// ── The loose comparison, preserved rather than tightened ────────────────────

test('a numeric answer against string options marks correct on BOTH paths', () => {
  // `fromGame` documents this: a stricter comparison "would silently mark
  // correct answers wrong on documents that work today". The fixture is the
  // proof, and it is asserted from the outside rather than trusted.
  const fixture = load('loose-answer-values')
  assert.equal(replayOld(fixture)[0].payload.correct, 3)
  assert.equal(replayEngine(fixture)[0].payload.correct, 3)
})

test('the round with no answers divides safely and writes zeroes, not NaN', () => {
  const written = replayEngine(load('no-answers'))[0].payload
  assert.equal(written.score, 0)
  assert.equal(written.accuracy, 0)
  assert.equal(written.correct, 0)
  assert.equal(written.wrong, 0)
})

test('an unstarted round records the full duration on both paths, with no deviation', () => {
  const fixture = load('unstarted-round')
  assert.equal(fixture.startedAtMs, null, 'this fixture must have no recorded start')
  assert.equal(replayOld(fixture)[0].payload.timeSpent, fixture.game.timer)
  assert.equal(replayEngine(fixture)[0].payload.timeSpent, fixture.game.timer)
})

console.log(`\nreplay game round comparison: ${passed} passed`)
