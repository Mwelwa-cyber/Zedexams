/**
 * test:fraction-progress — mastery, review spacing, stars, stages, and the
 * mid-stage snapshot.
 *
 * Every rule here is one that fails SILENTLY on screen, which is why it is a
 * module with a test rather than a few lines inside a component:
 *
 *   a stage that pays its stars twice looks like a generous stage
 *   a skill marked mastered after one lucky retry looks like a learner who
 *     has learnt something
 *   a snapshot that outlives its stage looks like a stage that reopened
 *   a review draw that reshuffles on reload looks like a different stage
 */
import assert from 'node:assert/strict'

import { GAMES_SEED } from '../src/data/gamesSeed.js'
import { FRACTION_LEVELS } from '../src/features/games/lib/fractionLadderCore.js'
import {
  MASTERY_SESSIONS,
  clearResume,
  composeStage,
  dueSkills,
  emptyProgress,
  globalStageOrdinal,
  levelPassed,
  levelStars,
  masteryState,
  nextStageNumber,
  passedLevels,
  readProgress,
  recordCorrect,
  recordMiss,
  recordRecovery,
  recordStage,
  resumable,
  reviewList,
  skillEntry,
  snapshotStage,
  stageDone,
  stagesForLevel,
  starsFor,
  starsForStage,
  totalStages,
  totalStars,
} from '../src/features/games/lib/fractionProgressCore.js'

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

console.log('fraction-progress')

const game = GAMES_SEED.find((g) => g.type === 'fraction_ladder')

/* ── mastery ───────────────────────────────────────────────────────── */

test('three rights in ONE sitting is not mastery', () => {
  let pool = {}
  for (let i = 0; i < 5; i += 1) {
    pool = recordCorrect(pool, 'add-same-denominator', { session: 'one-sitting', stage: i })
  }
  assert.equal(skillEntry(pool, 'add-same-denominator').correct, 1,
    'a second right answer in the same session must not count — the learner can still see the last one')
  assert.notEqual(masteryState(skillEntry(pool, 'add-same-denominator')), 'mastered')
})

test('three rights in three separate sittings IS mastery', () => {
  let pool = {}
  for (const session of ['a', 'b', 'c']) {
    pool = recordCorrect(pool, 'simplify', { session, stage: 0 })
  }
  assert.equal(skillEntry(pool, 'simplify').correct, MASTERY_SESSIONS)
  assert.equal(masteryState(skillEntry(pool, 'simplify')), 'mastered')
})

test('SEEING the solution and repeating it is recovery, not mastery', () => {
  // The rule the whole retry exists for. A learner who was wrong, read the
  // working and then wrote the answer they had just read has recovered. They
  // have not recalled anything.
  let pool = recordMiss({}, 'divide-fractions', { stage: 1, code: 'multiplied_instead_of_divided' })
  pool = recordRecovery(pool, 'divide-fractions', { stage: 1 })
  const entry = skillEntry(pool, 'divide-fractions')
  assert.equal(entry.correct, 0, 'a recovery must not move the mastery count')
  assert.equal(entry.recoveries, 1)
  assert.equal(masteryState(entry), 'recovering')
  // Three recoveries still is not mastery.
  pool = recordRecovery(pool, 'divide-fractions', { stage: 2 })
  pool = recordRecovery(pool, 'divide-fractions', { stage: 3 })
  assert.notEqual(masteryState(skillEntry(pool, 'divide-fractions')), 'mastered')
})

test('a miss resets the count, not the history', () => {
  let pool = recordCorrect({}, 'compare-unlike', { session: 'a', stage: 0 })
  pool = recordCorrect(pool, 'compare-unlike', { session: 'b', stage: 1 })
  assert.equal(skillEntry(pool, 'compare-unlike').correct, 2)
  pool = recordMiss(pool, 'compare-unlike', { stage: 2 })
  const entry = skillEntry(pool, 'compare-unlike')
  assert.equal(entry.correct, 0, 'a skill just got wrong is not two thirds learnt')
  assert.deepEqual(entry.sessions, [])
  assert.equal(entry.misses, 1, 'the miss history is what makes it tricky, and it keeps climbing')
})

test('every state is reachable, and they are distinct', () => {
  assert.equal(masteryState({}), 'new')
  assert.equal(masteryState(recordMiss({}, 's', {}).s), 'needs_review')
  let pool = recordMiss({}, 's', {})
  pool = recordRecovery(pool, 's', {})
  assert.equal(masteryState(pool.s), 'recovering')
  pool = recordCorrect(pool, 's', { session: 'x' })
  assert.equal(masteryState(pool.s), 'learning')
})

test('a misconception is counted per skill, so the review can name the pattern', () => {
  let pool = recordMiss({}, 'add-one-fits', { stage: 0, code: 'added_denominators' })
  pool = recordMiss(pool, 'add-one-fits', { stage: 1, code: 'added_denominators' })
  pool = recordMiss(pool, 'add-one-fits', { stage: 2, code: 'not_simplified' })
  const [item] = reviewList(pool)
  assert.equal(item.skill, 'add-one-fits')
  assert.equal(item.code, 'added_denominators', 'the review names the mistake that keeps coming back')
  assert.equal(item.misses, 3)
})

test('a mastered skill leaves the review list', () => {
  let pool = recordMiss({}, 'simplify', { stage: 0 })
  assert.equal(reviewList(pool).length, 1)
  for (const session of ['a', 'b', 'c']) pool = recordCorrect(pool, 'simplify', { session, stage: 0 })
  assert.equal(reviewList(pool).length, 0)
})

/* ── spacing ───────────────────────────────────────────────────────── */

test('a missed skill comes back on its schedule and not before', () => {
  const pool = recordMiss({}, 'compare-unlike', { stage: 4 })
  assert.deepEqual(dueSkills(pool, 5), [], 'the very next stage is too soon')
  assert.deepEqual(dueSkills(pool, 6), ['compare-unlike'], 'two stages later')
})

test('the interval widens as the skill is got right', () => {
  let pool = recordMiss({}, 's', { stage: 0 })
  assert.equal(skillEntry(pool, 's').dueAt, 2)
  pool = recordCorrect(pool, 's', { session: 'a', stage: 2 })
  assert.equal(skillEntry(pool, 's').dueAt, 7, 'five stages after the first right answer')
  pool = recordCorrect(pool, 's', { session: 'b', stage: 7 })
  assert.equal(skillEntry(pool, 's').dueAt, 18, 'eleven after the second')
})

test('a mastered skill is never due again', () => {
  let pool = {}
  for (const session of ['a', 'b', 'c']) pool = recordCorrect(pool, 's', { session, stage: 0 })
  assert.deepEqual(dueSkills(pool, 9999), [])
})

/* ── stages ────────────────────────────────────────────────────────── */

test('stages come from the content, not from slicing a list', () => {
  const stages = stagesForLevel(game, 'basics')
  assert.ok(stages.length >= 4, 'level 1 is built in short stages')
  assert.deepEqual(stages.map((s) => s.number), stages.map((_, i) => i + 1))
  for (const stage of stages) assert.ok(stage.questions.every((q) => Number(q.stage) === stage.number))
})

test('a pack with no stage numbers still plays as one stage per level', () => {
  const legacy = { questions: [{ level: 'basics', id: 'a' }, { level: 'basics', id: 'b' }] }
  const stages = stagesForLevel(legacy, 'basics')
  assert.equal(stages.length, 1)
  assert.equal(stages[0].questions.length, 2)
})

test('a stage ordinal counts across the WHOLE ladder, not within a level', () => {
  // Counting within a level would make a skill missed in the last stage of one
  // level come due in the first stage of the next — "two stages later" by the
  // number, one stage later in the learner's day.
  const first = globalStageOrdinal(game, 'basics', 1)
  const lastOfBasics = globalStageOrdinal(game, 'basics', stagesForLevel(game, 'basics').length)
  const firstOfEqual = globalStageOrdinal(game, 'equal', 1)
  assert.equal(first, 0)
  assert.equal(firstOfEqual, lastOfBasics + 1)
  assert.ok(totalStages(game) > 20)
})

test('a stage brings back what the learner missed, and only from EARLIER', () => {
  // A review question from later in the ladder would be teaching a skill the
  // learner has not reached, which is a different failure from the one review
  // is for.
  let pool = recordMiss({}, 'name-unit-fraction', { stage: 0 })
  pool = recordMiss(pool, 'divide-fractions', { stage: 0 })
  const composed = composeStage({ game, levelId: 'equal', stageNumber: 2, pool, salt: 'x' })
  const reviewed = composed.questions.filter((q) => composed.review.includes(q.id))
  assert.ok(reviewed.length >= 1, 'a due skill from level 1 must come back')
  for (const question of reviewed) {
    assert.notEqual(question.skill, 'divide-fractions', 'level 7 must not leak into level 2')
  }
})

test('the review draw is deterministic — a reload is not a reshuffle', () => {
  let pool = {}
  for (const skill of ['name-unit-fraction', 'shade-a-fraction', 'equal-parts', 'read-a-fraction']) {
    pool = recordMiss(pool, skill, { stage: 0 })
  }
  const a = composeStage({ game, levelId: 'equal', stageNumber: 2, pool, salt: 'seed' })
  const b = composeStage({ game, levelId: 'equal', stageNumber: 2, pool, salt: 'seed' })
  assert.deepEqual(a.review, b.review)
  assert.deepEqual(a.questions.map((q) => q.id), b.questions.map((q) => q.id))
})

test('review questions come FIRST, while the learner is freshest', () => {
  const pool = recordMiss({}, 'name-unit-fraction', { stage: 0 })
  const composed = composeStage({ game, levelId: 'equal', stageNumber: 2, pool, salt: 'x' })
  assert.ok(composed.review.length >= 1)
  assert.equal(composed.questions[0].id, composed.review[0])
})

test('a stage with nothing due plays exactly its own questions', () => {
  const composed = composeStage({ game, levelId: 'basics', stageNumber: 1, pool: {}, salt: 'x' })
  assert.deepEqual(composed.review, [])
  assert.deepEqual(
    composed.questions.map((q) => q.id),
    stagesForLevel(game, 'basics')[0].questions.map((q) => q.id),
  )
})

/* ── stars ─────────────────────────────────────────────────────────── */

test('stars are FIRST-TRY accuracy, never speed', () => {
  assert.equal(starsForStage(5, 5), 3)
  assert.equal(starsForStage(4, 5), 2)
  assert.equal(starsForStage(2, 5), 1)
  assert.equal(starsForStage(1, 5), 0)
  assert.equal(starsForStage(0, 0), 0, 'a stage with nothing in it earns nothing rather than dividing by zero')
})

test('a replay can RAISE a star count and can never add a second reward', () => {
  let progress = emptyProgress()
  progress = recordStage(progress, 'basics', 1, 1)
  assert.equal(starsFor(progress, 'basics', 1), 1)
  progress = recordStage(progress, 'basics', 1, 3)
  assert.equal(starsFor(progress, 'basics', 1), 3, 'a better replay counts')
  progress = recordStage(progress, 'basics', 1, 1)
  assert.equal(starsFor(progress, 'basics', 1), 3, 'a worse replay must not take stars away')
  assert.equal(Object.keys(progress.stars).length, 1, 'one stage, one entry — never two')
})

test('a level is passed when every stage is played, whatever the stars', () => {
  let progress = emptyProgress()
  const stages = stagesForLevel(game, 'basics')
  for (const stage of stages.slice(0, -1)) progress = recordStage(progress, 'basics', stage.number, 3)
  assert.equal(levelPassed(progress, game, 'basics'), false, 'one stage short is not passed')
  progress = recordStage(progress, 'basics', stages[stages.length - 1].number, 0)
  assert.equal(levelPassed(progress, game, 'basics'), true,
    'zero stars on the last stage still passes — a learner who scrapes it moves on')
  assert.deepEqual(passedLevels(progress, game), ['basics'])
})

test('the star totals add up across a level and the ladder', () => {
  let progress = emptyProgress()
  const stages = stagesForLevel(game, 'basics')
  for (const stage of stages) progress = recordStage(progress, 'basics', stage.number, 2)
  const level = levelStars(progress, game, 'basics')
  assert.equal(level.earned, stages.length * 2)
  assert.equal(level.possible, stages.length * 3)
  assert.equal(totalStars(progress, game).possible, totalStages(game) * 3)
})

test('the next stage is the first unplayed one, and wraps once they are all done', () => {
  let progress = emptyProgress()
  assert.equal(nextStageNumber(progress, game, 'basics'), 1)
  progress = recordStage(progress, 'basics', 1, 3)
  assert.equal(nextStageNumber(progress, game, 'basics'), 2)
  for (const stage of stagesForLevel(game, 'basics')) progress = recordStage(progress, 'basics', stage.number, 3)
  assert.equal(nextStageNumber(progress, game, 'basics'), 1, 'a finished level offers a replay from the start')
})

/* ── stored progress ───────────────────────────────────────────────── */

test('a learner who climbed four levels on the OLD shape keeps them', () => {
  // The first version stored a bare array of passed level ids. Reading that as
  // "nothing" would empty a real child's ladder on a deploy.
  const progress = readProgress(['basics', 'equal', 'compare', 'add'])
  assert.deepEqual(passedLevels(progress, game), ['basics', 'equal', 'compare', 'add'])
  assert.equal(levelPassed(progress, game, 'sub'), false)
})

test('a missing, broken or hostile stored value reads as a fresh start', () => {
  for (const raw of [null, undefined, 'nonsense', 42, { stars: 'not an object' }]) {
    const progress = readProgress(raw)
    assert.equal(typeof progress.stars, 'object')
    assert.equal(typeof progress.pool, 'object')
    assert.deepEqual(passedLevels(progress, game), [])
  }
})

/* ── refresh recovery ──────────────────────────────────────────────── */

test('a stage abandoned part way is resumable, with its answers and its score', () => {
  const progress = {
    ...emptyProgress(),
    resume: snapshotStage({
      levelId: 'basics',
      stageNumber: 1,
      index: 2,
      answered: [{ id: 'fr-b1-1', correct: true, firstTry: true }, { id: 'fr-b1-2', correct: false, firstTry: false }],
      score: 20,
      session: 's1',
    }),
  }
  const resume = resumable(progress, game)
  assert.ok(resume)
  assert.equal(resume.answered.length, 2)
  assert.equal(resume.score, 20, 'the score comes back, so the questions are not paid for twice')
})

test('a snapshot for a FINISHED stage is refused — that is how a stage reopens itself', () => {
  let progress = {
    ...emptyProgress(),
    resume: snapshotStage({ levelId: 'basics', stageNumber: 1, index: 1, answered: [{ id: 'x', correct: true, firstTry: true }], score: 20 }),
  }
  progress = recordStage(progress, 'basics', 1, 3)
  assert.equal(resumable(progress, game), null)
})

test('a snapshot for a stage that no longer exists is refused, not resumed onto another', () => {
  const progress = {
    ...emptyProgress(),
    resume: snapshotStage({ levelId: 'basics', stageNumber: 99, index: 1, answered: [{ id: 'x', correct: true, firstTry: true }], score: 20 }),
  }
  assert.equal(resumable(progress, game), null)
})

test('an empty snapshot is not a resume', () => {
  const progress = { ...emptyProgress(), resume: snapshotStage({ levelId: 'basics', stageNumber: 1, index: 0, answered: [], score: 0 }) }
  assert.equal(resumable(progress, game), null)
})

test('clearing the resume leaves everything else alone', () => {
  const progress = recordStage({ ...emptyProgress(), resume: { levelId: 'basics' } }, 'basics', 1, 2)
  const cleared = clearResume(progress)
  assert.equal(cleared.resume, null)
  assert.equal(starsFor(cleared, 'basics', 1), 2)
})

test('the snapshot keeps only what it needs, and nothing that could be forged into a reward', () => {
  const snap = snapshotStage({
    levelId: 'basics', stageNumber: 1, index: 1, score: 40, session: 's',
    answered: [{ id: 'q', correct: true, firstTry: true, stars: 3, extra: 'nope' }],
  })
  assert.deepEqual(Object.keys(snap.answered[0]).sort(), ['correct', 'firstTry', 'id'])
})

/* ── the whole ladder still holds ──────────────────────────────────── */

test('every level of the shipped pack has stages, and every stage has questions', () => {
  for (const level of FRACTION_LEVELS) {
    const stages = stagesForLevel(game, level.id)
    assert.ok(stages.length > 0, `${level.id} has no stages`)
    for (const stage of stages) assert.ok(stage.questions.length > 0)
  }
})

test('stageDone is false for a stage nobody has played', () => {
  assert.equal(stageDone(emptyProgress(), 'basics', 1), false)
  assert.equal(stageDone(recordStage(emptyProgress(), 'basics', 1, 0), 'basics', 1), true,
    'zero stars still counts as played — the stage happened')
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
