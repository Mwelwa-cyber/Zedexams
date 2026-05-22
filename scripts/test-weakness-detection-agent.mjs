#!/usr/bin/env node
/**
 * Weakness Detection Agent — unit tests.
 *
 * Covers:
 *   - Parameter normalisation (learnerId required, clamps, defaults)
 *   - analyseAttempts pure helper:
 *       • weak topic detection at the < 70% threshold
 *       • weak subtopic derivation from exam_attempts.topicBreakdown
 *       • repeated-mistake detection (≥N low-score hits)
 *       • dominant subject + grade picking
 *       • improvement-over-time trend
 *       • low-score count
 *       • difficult question types from questionResults[]
 *       • avg seconds per question from timeTakenMs
 *       • PRIVACY INVARIANT: cross-learner rows in the input are
 *         filtered out — defensive guard against upstream bugs
 *   - Supervisor planner: weakness_analysis is a single-step chain
 *   - Schema validation: profileFields conform to
 *     learnerWeaknessProfileWriteSchema
 *
 * Run: npm run test:weakness  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/weakness.js')
const SUPERVISOR = join(ROOT, 'functions/agents/learnerAi/runners/supervisor.js')

const fakeAdmin = {firestore: () => ({})}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === '../logger') {
    return {
      writeAgentLog: async () => {}, writeSupervisorLog: async () => {},
      updateLiveAgentState: async () => {}, writeTaskStep: async () => {},
    }
  }
  return origLoad.call(this, request, parent, ...rest)
}

const w = await import(RUNNER)
const supervisor = await import(SUPERVISOR)
const { learnerWeaknessProfileWriteSchema } =
  await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nParameter normalisation')

test('learnerId defaults to null', () => {
  const p = w.normaliseParameters({})
  assert(p.learnerId === null)
})
test('accepts learnerId on params', () => {
  const p = w.normaliseParameters({parameters: {learnerId: 'L1'}})
  assert(p.learnerId === 'L1')
})
test('accepts weakLearnerId alias for learnerId', () => {
  const p = w.normaliseParameters({parameters: {weakLearnerId: 'L2'}})
  assert(p.learnerId === 'L2')
})
test('clamps attemptsLimit to [1, 200]', () => {
  assert(w.normaliseParameters({parameters: {learnerId: 'x', attemptsLimit: 999}}).attemptsLimit === 200)
  assert(w.normaliseParameters({parameters: {learnerId: 'x', attemptsLimit: 0}}).attemptsLimit === 1)
})
test('triggerStudyTips defaults true; false override respected', () => {
  assert(w.normaliseParameters({parameters: {learnerId: 'x'}}).triggerStudyTips === true)
  assert(w.normaliseParameters({parameters: {learnerId: 'x', triggerStudyTips: false}}).triggerStudyTips === false)
})

console.log('\nanalyseAttempts — weak-topic detection')

const baseParams = w.normaliseParameters({parameters: {learnerId: 'L1'}})

test('weak topics surface when average < 70%', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', subject: 'Mathematics', grade: '7', percentage: 45,
        topicScores: {Fractions: 40, Decimals: 30}, completedAt: 1},
      {userId: 'L1', subject: 'Mathematics', grade: '7', percentage: 55,
        topicScores: {Fractions: 50, Decimals: 60, Geometry: 90}, completedAt: 2},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(out.weakTopics.includes('Fractions'), 'Fractions weak')
  assert(out.weakTopics.includes('Decimals'), 'Decimals weak')
  assert(!out.weakTopics.includes('Geometry'), 'Geometry must NOT be weak (90%)')
})

test('weak topics order from lowest-scoring first', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', subject: 'M', grade: '7', percentage: 50,
        topicScores: {Hard: 20, Medium: 60}, completedAt: 1},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(out.weakTopics[0] === 'Hard', 'lowest weak first')
})

test('weak subtopics derived from exam_attempts.topicBreakdown', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [{userId: 'L1', subject: 'M', grade: '7', percentage: 50, topicScores: {}, completedAt: 1}],
    examAttempts: [{
      userId: 'L1', subject: 'M', grade: '7',
      topicBreakdown: {
        'Fractions / Adding': {percentage: 40},
        'Fractions / Subtracting': {percentage: 30},
        'Geometry / Triangles': 85,
      },
      completedAt: 1,
    }],
    parameters: baseParams,
  })
  assert(out.weakSubtopics.includes('Fractions / Adding'))
  assert(out.weakSubtopics.includes('Fractions / Subtracting'))
  assert(!out.weakSubtopics.includes('Geometry / Triangles'))
})

console.log('\nanalyseAttempts — repeated mistakes')

test('repeated mistakes when topic scores < threshold across ≥2 attempts', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', subject: 'M', grade: '7', percentage: 40, topicScores: {Fractions: 30}, completedAt: 1},
      {userId: 'L1', subject: 'M', grade: '7', percentage: 50, topicScores: {Fractions: 45}, completedAt: 2},
      {userId: 'L1', subject: 'M', grade: '7', percentage: 60, topicScores: {Fractions: 60}, completedAt: 3},
    ],
    examAttempts: [], parameters: baseParams,
  })
  const fr = out.repeatedMistakes.find(m => m.topic === 'Fractions')
  assert(fr, 'Fractions must appear in repeatedMistakes')
  assert(fr.timesMissed >= 2, 'must be missed at least 2 times')
})

test('one-off low score does NOT trigger repeated mistake', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', subject: 'M', grade: '7', percentage: 40, topicScores: {Fractions: 30}, completedAt: 1},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(!out.repeatedMistakes.some(m => m.topic === 'Fractions'),
    'single low hit must not be a repeated mistake')
})

console.log('\nanalyseAttempts — privacy invariant')

test('cross-learner rows in input are filtered out', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', subject: 'Mathematics', grade: '7', percentage: 80, topicScores: {Fractions: 80}, completedAt: 1},
      // Injected from another learner — must be ignored.
      {userId: 'OTHER', subject: 'Biology', grade: '12', percentage: 10, topicScores: {Algebra: 5}, completedAt: 2},
    ],
    examAttempts: [
      {userId: 'OTHER', subject: 'Biology', grade: '12', topicBreakdown: {Algebra: 5}, completedAt: 2},
    ],
    parameters: baseParams,
  })
  assert(!out.weakTopics.includes('Algebra'),
    `must NOT mix in another learner's weak topics, got ${out.weakTopics.join(',')}`)
  assert(!out.weakSubtopics.includes('Algebra'),
    `must NOT mix in another learner's weak subtopics`)
  assert(out.subject === 'Mathematics',
    `subject must reflect L1's attempts only, got "${out.subject}"`)
  assert(out.grade === '7',
    `grade must reflect L1's attempts only, got "${out.grade}"`)
})

console.log('\nanalyseAttempts — improvement trend')

test('trend=improving when last attempts outperform first', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', percentage: 30, topicScores: {}, completedAt: 1},
      {userId: 'L1', percentage: 35, topicScores: {}, completedAt: 2},
      {userId: 'L1', percentage: 40, topicScores: {}, completedAt: 3},
      {userId: 'L1', percentage: 80, topicScores: {}, completedAt: 4},
      {userId: 'L1', percentage: 85, topicScores: {}, completedAt: 5},
      {userId: 'L1', percentage: 90, topicScores: {}, completedAt: 6},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(out._analytics.trend === 'improving',
    `expected improving, got ${out._analytics.trend} (improvement=${out._analytics.improvement})`)
})

test('trend=declining when last attempts underperform first', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', percentage: 90, topicScores: {}, completedAt: 1},
      {userId: 'L1', percentage: 85, topicScores: {}, completedAt: 2},
      {userId: 'L1', percentage: 80, topicScores: {}, completedAt: 3},
      {userId: 'L1', percentage: 40, topicScores: {}, completedAt: 4},
      {userId: 'L1', percentage: 35, topicScores: {}, completedAt: 5},
      {userId: 'L1', percentage: 30, topicScores: {}, completedAt: 6},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(out._analytics.trend === 'declining',
    `expected declining, got ${out._analytics.trend}`)
})

test('trend=no_data when zero attempts', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1', results: [], examAttempts: [], parameters: baseParams,
  })
  assert(out._analytics.trend === 'no_data')
})

console.log('\nanalyseAttempts — difficult question types + time signals')

test('difficult question types flagged when pass rate < 60% with ≥3 attempts', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1', results: [],
    examAttempts: [{
      userId: 'L1',
      questionResults: [
        {questionType: 'short_answer', correct: false},
        {questionType: 'short_answer', correct: false},
        {questionType: 'short_answer', correct: true},
        {questionType: 'mcq', correct: true},
        {questionType: 'mcq', correct: true},
        {questionType: 'mcq', correct: true},
      ],
      completedAt: 1,
    }],
    parameters: baseParams,
  })
  const types = out._analytics.difficultQuestionTypes.map(d => d.questionType)
  assert(types.includes('short_answer'),
    `short_answer must be flagged (1/3 = 33%), got ${types.join(',')}`)
  assert(!types.includes('mcq'), 'mcq passed every time — must not be flagged')
})

test('avgSecondsPerQuestion computed from timeTakenMs', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1', results: [],
    examAttempts: [
      {userId: 'L1', timeTakenMs: 120_000, questionCount: 10, completedAt: 1},
      {userId: 'L1', timeTakenMs: 60_000, questionCount: 10, completedAt: 2},
    ],
    parameters: baseParams,
  })
  // (120/10 + 60/10) / 2 = (12 + 6) / 2 = 9 seconds
  assert(out._analytics.avgSecondsPerQuestion === 9,
    `expected 9 sec/q, got ${out._analytics.avgSecondsPerQuestion}`)
})

console.log('\nRecommendations + low-score counter')

test('recommendedNotes mirror the top weak topics', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', percentage: 40, topicScores: {Fractions: 40, Decimals: 35, Geometry: 90}, completedAt: 1},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(out.recommendedNotes.some(n => n.includes('Fractions')))
  assert(out.recommendedNotes.some(n => n.includes('Decimals')))
  assert(out.recommendedQuizzes.length === out.recommendedNotes.length,
    'one quiz per note recommendation')
})

test('lowScoreCount tracks attempts under threshold', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', percentage: 30, topicScores: {}, completedAt: 1},
      {userId: 'L1', percentage: 80, topicScores: {}, completedAt: 2},
      {userId: 'L1', percentage: 40, topicScores: {}, completedAt: 3},
    ],
    examAttempts: [], parameters: baseParams,
  })
  assert(out._analytics.lowScoreCount === 2, 'two attempts under 50%')
})

console.log('\nSupervisor planner')

test('planStepsFor(weakness_analysis) = ["weakness"]', () => {
  const steps = supervisor.planStepsFor('weakness_analysis')
  assert(Array.isArray(steps), 'must return array')
  assert(steps.length === 1 && steps[0] === 'weakness',
    `expected ['weakness'], got ${steps.join(',')}`)
})

test('weakness_analysis does NOT include qualityCheck / curriculumReader / standardsCheck', () => {
  const steps = supervisor.planStepsFor('weakness_analysis')
  for (const banned of ['curriculumReader', 'qualityCheck', 'standardsCheck', 'standards']) {
    assert(!steps.includes(banned),
      `weakness_analysis must not include ${banned} (rollup data, not content artifact)`)
  }
})

console.log('\nSchema validation')

test('analyseAttempts output passes learnerWeaknessProfileWriteSchema', () => {
  const out = w.analyseAttempts({
    learnerId: 'L1',
    results: [
      {userId: 'L1', subject: 'Mathematics', grade: '7', percentage: 45,
        topicScores: {Fractions: 40, Decimals: 30}, completedAt: 1},
      {userId: 'L1', subject: 'Mathematics', grade: '7', percentage: 55,
        topicScores: {Fractions: 50, Decimals: 60}, completedAt: 2},
    ],
    examAttempts: [], parameters: baseParams,
  })
  const {_analytics, ...profileFields} = out
  void _analytics
  // Add lastUpdated (runner stamps this in production).
  const parsed = learnerWeaknessProfileWriteSchema.parse({
    ...profileFields, lastUpdated: new Date(),
  })
  assert(parsed.learnerId === 'L1', 'learnerId echoed')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
