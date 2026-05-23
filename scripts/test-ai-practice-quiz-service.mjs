#!/usr/bin/env node
/**
 * AI practice quiz scoring + payload builders — unit tests.
 *
 * Tests `src/utils/aiPracticeQuizScoring.js` (the pure module). The
 * Firestore-orchestration side (`aiPracticeQuizService.js` —
 * listPublishedPracticeQuizzesForLearner / loadPracticeQuiz /
 * submitAiPracticeQuizAttempt) is exercised via manual smoke
 * against the live Firestore + the existing `aiAgentTasksOnCreate`
 * trigger; we don't unit-mock firebase/firestore in this repo.
 *
 * Covers:
 *   - markQuestion per question type (mcq / true_false / short_answer / matching)
 *   - scoreAttempt aggregation: totals, percentage, perQuestion, topicScores
 *   - buildResultDocBase carries the fields existing results-collection
 *     consumers (WeaknessDetection / MyResults / teacher analytics) expect
 *   - buildWeaknessTaskPayload + buildFeedbackTaskPayload carry the
 *     parameters the runners require (weakLearnerId, attemptId, etc.)
 *   - estimatedMinutesForQuiz fallback when artifact lacks the field
 *   - describeDifficulty derivation from per-question difficulties
 *
 * Run: node scripts/test-ai-practice-quiz-service.mjs
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SCORING_PATH = join(ROOT, 'src/utils/aiPracticeQuizScoring.js')

const svc = await import(SCORING_PATH)

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(() => { pass++; console.log(`  ok  ${name}`) })
              .catch(err => { fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`) })
    }
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── markQuestion ──────────────────────────────────────────────────

console.log('\nmarkQuestion — per-type scoring')

test('mcq correct → full marks', () => {
  const r = svc.markQuestion(
    { questionType: 'mcq', options: ['a', 'b', 'c'], correctAnswer: 'b', marks: 2 },
    'b',
  )
  assert(r.correct === true && r.awardedMarks === 2)
})
test('mcq wrong → 0', () => {
  const r = svc.markQuestion(
    { questionType: 'mcq', options: ['a', 'b', 'c'], correctAnswer: 'b', marks: 2 },
    'a',
  )
  assert(r.correct === false && r.awardedMarks === 0)
})
test('mcq case-insensitive', () => {
  const r = svc.markQuestion(
    { questionType: 'mcq', correctAnswer: 'Numerator', marks: 1 },
    'numerator',
  )
  assert(r.correct === true)
})

test('true_false correct', () => {
  const r = svc.markQuestion(
    { questionType: 'true_false', correctAnswer: 'True', marks: 1 },
    'True',
  )
  assert(r.correct === true && r.awardedMarks === 1)
})

test('short_answer correct (case-insensitive)', () => {
  const r = svc.markQuestion(
    { questionType: 'short_answer', correctAnswer: 'Photosynthesis', marks: 2 },
    'photosynthesis',
  )
  assert(r.correct === true && r.awardedMarks === 2)
})
test('short_answer blank → 0', () => {
  const r = svc.markQuestion(
    { questionType: 'short_answer', correctAnswer: 'x', marks: 1 },
    '',
  )
  assert(r.awardedMarks === 0)
})

test('matching correct via JSON', () => {
  const r = svc.markQuestion(
    {
      questionType: 'matching', marks: 3,
      matchingPairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }],
    },
    JSON.stringify([{ left: 'A', right: '1' }, { left: 'B', right: '2' }]),
  )
  assert(r.correct === true && r.awardedMarks === 3)
})
test('matching wrong pair → 0', () => {
  const r = svc.markQuestion(
    {
      questionType: 'matching', marks: 3,
      matchingPairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }],
    },
    JSON.stringify([{ left: 'A', right: '2' }, { left: 'B', right: '1' }]),
  )
  assert(r.correct === false)
})

test('unknown question type → 0', () => {
  const r = svc.markQuestion({ questionType: 'voice', correctAnswer: 'x' }, 'x')
  assert(r.awardedMarks === 0)
})

// ── scoreAttempt ──────────────────────────────────────────────────

console.log('\nscoreAttempt aggregation')

const TWO_TOPIC_CONTENT = {
  questions: [
    { questionType: 'mcq', options: ['a', 'b'], correctAnswer: 'a', marks: 2, topic: 'Fractions' },
    { questionType: 'mcq', options: ['a', 'b'], correctAnswer: 'b', marks: 2, topic: 'Fractions' },
    { questionType: 'true_false', correctAnswer: 'True', marks: 1, topic: 'Decimals' },
  ],
}

test('totals + percentage correct', () => {
  const s = svc.scoreAttempt({ content: TWO_TOPIC_CONTENT, answers: { 0: 'a', 1: 'b', 2: 'True' } })
  assert(s.totalScore === 5)
  assert(s.totalMarks === 5)
  assert(s.percentage === 100)
})

test('partial credit', () => {
  const s = svc.scoreAttempt({ content: TWO_TOPIC_CONTENT, answers: { 0: 'a', 1: 'a', 2: 'False' } })
  assert(s.totalScore === 2)
  assert(s.totalMarks === 5)
  assert(s.percentage === 40)
})

test('topicScores aggregates per-topic pass rate as percentage', () => {
  // Get Fractions q0 right (2/2), miss q1 (0/2) → Fractions 50%
  // Get Decimals q2 right (1/1) → Decimals 100%
  const s = svc.scoreAttempt({ content: TWO_TOPIC_CONTENT, answers: { 0: 'a', 1: 'a', 2: 'True' } })
  assert(s.topicScores.Fractions === 50, `Fractions: ${s.topicScores.Fractions}`)
  assert(s.topicScores.Decimals === 100, `Decimals: ${s.topicScores.Decimals}`)
})

test('perQuestion has marking details', () => {
  const s = svc.scoreAttempt({ content: TWO_TOPIC_CONTENT, answers: { 0: 'a', 1: 'a', 2: 'True' } })
  assert(s.perQuestion.length === 3)
  assert(s.perQuestion[0].correct === true)
  assert(s.perQuestion[1].correct === false)
  assert(s.perQuestion[1].learnerAnswer === 'a')
})

test('empty content → zeros', () => {
  const s = svc.scoreAttempt({ content: { questions: [] }, answers: {} })
  assert(s.totalScore === 0 && s.totalMarks === 0 && s.percentage === 0)
})

// ── buildResultDocBase ─────────────────────────────────────────────

console.log('\nbuildResultDocBase shape')

test('result doc carries the fields existing results-collection consumers expect', () => {
  const artifact = { id: 'art-1', grade: '7', subject: 'Mathematics', topic: 'Fractions', subtopic: 'Adding fractions', content: { title: 'Fractions practice' } }
  const scored = { totalScore: 5, totalMarks: 10, percentage: 50, topicScores: { Fractions: 50 }, perQuestion: [] }
  const doc = svc.buildResultDocBase({ artifact, scored, learnerId: 'L1', learnerGrade: '7' })
  assert(doc.userId === 'L1', 'userId set')
  assert(doc.aiContentId === 'art-1', 'aiContentId stamped')
  assert(doc.source === 'ai_practice', 'source tag set')
  assert(doc.grade === '7', 'grade carried')
  assert(doc.subject === 'Mathematics')
  assert(doc.topic === 'Fractions')
  assert(doc.topicScores.Fractions === 50, 'topicScores passed through')
  assert(doc.score === 5)
  assert(doc.totalMarks === 10)
  assert(doc.percentage === 50)
  // completedAt is added by buildResultDoc in the service file
  // (serverTimestamp sentinel) — base doc doesn't have it.
  assert(!('completedAt' in doc), 'base doc must not include completedAt sentinel')
})

test('quizTitle falls back to subject — topic when artifact has no title', () => {
  const artifact = { id: 'a', subject: 'Science', topic: 'Plants', content: {} }
  const doc = svc.buildResultDocBase({ artifact, scored: { totalScore: 0, totalMarks: 0, percentage: 0, topicScores: {}, perQuestion: [] }, learnerId: 'L1' })
  assert(doc.quizTitle === 'Science — Plants', `got: ${doc.quizTitle}`)
})

// ── buildWeaknessTaskPayload ──────────────────────────────────────

console.log('\nbuildWeaknessTaskPayload')

test('weakness task carries weakLearnerId for the runner', () => {
  const p = svc.buildWeaknessTaskPayload({
    artifact: { id: 'a', grade: '7', subject: 'Mathematics', topic: 'F' },
    learnerId: 'L1', resultId: 'R1',
  })
  assert(p.taskType === 'weakness_analysis')
  assert(p.agentName === 'weakness')
  assert(p.status === 'queued')
  assert(p.parameters.weakLearnerId === 'L1',
    'weakness task must carry weakLearnerId for runner.normaliseParameters')
  assert(p.parameters.learnerId === 'L1', 'learnerId set')
  assert(p.parameters.triggerStudyTips === true,
    'must explicitly request studyTips trigger (default but pinned)')
  assert(p.triggeredBy === 'ai_practice_attempt:R1', 'triggeredBy traces the result doc')
})

test('weakness task scopes to artifact grade + subject for the runner', () => {
  const p = svc.buildWeaknessTaskPayload({
    artifact: { id: 'a', grade: '8', subject: 'Science', topic: 'Plants', subtopic: 'Roots' },
    learnerId: 'L1', resultId: 'R1',
  })
  assert(p.grade === '8')
  assert(p.subject === 'Science')
  assert(p.topic === 'Plants')
  assert(p.subtopic === 'Roots')
})

// ── buildFeedbackTaskPayload ──────────────────────────────────────

console.log('\nbuildFeedbackTaskPayload')

test('feedback task carries learnerId + attemptId per learnerFeedbackParametersSchema', () => {
  const p = svc.buildFeedbackTaskPayload({
    artifact: { id: 'a', grade: '7', subject: 'Mathematics', topic: 'F' },
    learnerId: 'L1', resultId: 'R1',
  })
  assert(p.taskType === 'learner_feedback')
  assert(p.agentName === 'feedback')
  assert(p.parameters.learnerId === 'L1', 'learnerId set')
  assert(p.parameters.attemptId === 'R1', 'attemptId links to this result doc')
})

// ── Helpers ──────────────────────────────────────────────────────

console.log('\nestimatedMinutesForQuiz + describeDifficulty')

test('uses content.estimatedMinutes when present', () => {
  const m = svc.estimatedMinutesForQuiz({ content: { estimatedMinutes: 8 } })
  assert(m === 8)
})
test('falls back to questions × 1.2 when missing', () => {
  const m = svc.estimatedMinutesForQuiz({ content: { questions: Array(10).fill({}) } })
  assert(m === 12, `expected 12, got ${m}`)
})
test('floor at 3 minutes', () => {
  const m = svc.estimatedMinutesForQuiz({ content: { questions: [{}] } })
  assert(m === 3, `expected 3, got ${m}`)
})

test('describeDifficulty returns the explicit value', () => {
  assert(svc.describeDifficulty({ difficulty: 'medium' }) === 'medium')
})
test('describeDifficulty derives "easy" when all questions are easy', () => {
  assert(svc.describeDifficulty({ questions: [{ difficulty: 'easy' }, { difficulty: 'easy' }] }) === 'easy')
})
test('describeDifficulty returns "mixed" by default', () => {
  assert(svc.describeDifficulty({ questions: [{ difficulty: 'easy' }, { difficulty: 'hard' }] }) === 'mixed')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
