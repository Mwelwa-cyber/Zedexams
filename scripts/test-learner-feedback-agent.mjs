#!/usr/bin/env node
/**
 * Learner Feedback Generator Agent — unit tests.
 *
 * Covers:
 *   - Parameter normalisation (learnerId + attemptId required)
 *   - pickTone score-band mapping
 *   - buildScoreBlock normalisation
 *   - deriveStrengthsAndWeakAreas combines attempt + profile
 *   - Verb-head + generic study-tip filtering
 *   - Stub fallback per tone band
 *   - NO FAKE PRAISE rule (empty strengths → no fabricated strengths)
 *   - NO SHAMING rule (low score → gentle tone, no "you failed")
 *   - Auto-publish allow-list includes learner_feedback with
 *     learnerId+attemptId precondition
 *   - End-to-end Zod validation
 *
 * Run: npm run test:learner-feedback  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/feedback.js')
const DISPATCHER_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8')

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

const fb = await import(RUNNER)
const { learnerFeedbackContentSchema, learnerFeedbackParametersSchema } =
  await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const reader = {
  grade: '7', subject: 'Biology', term: '1',
  topic: 'Circulatory System', subtopic: 'Heart and blood vessels',
  citedExcerpts: [{text: 'Arteries carry oxygenated blood from the heart.', anchor: 'content'}],
  curriculumDocumentPath: 'syllabi/g7-biology.pdf',
  curriculumVersion: 'cbc-kb-2026-04-seed',
  sourceDocId: 'g7-biology',
}

console.log('\nParameter normalisation')

test('learnerId + attemptId both required', () => {
  const p1 = fb.normaliseParameters({})
  assert(p1.learnerId === null && p1.attemptId === null)
  const p2 = fb.normaliseParameters({parameters: {learnerId: 'L1', attemptId: 'A1'}})
  assert(p2.learnerId === 'L1' && p2.attemptId === 'A1')
})
test('resultId is accepted as attemptId alias', () => {
  const p = fb.normaliseParameters({parameters: {learnerId: 'L1', resultId: 'R1'}})
  assert(p.attemptId === 'R1', `expected R1, got ${p.attemptId}`)
})
test('parameters validate against learnerFeedbackParametersSchema', () => {
  const p = fb.normaliseParameters({parameters: {learnerId: 'L1', attemptId: 'A1'}})
  const parsed = learnerFeedbackParametersSchema.parse(p)
  assert(parsed.maxCorrectiveExplanations === 4)
})
test('clamps maxCorrectiveExplanations to [1, 8]', () => {
  assert(fb.normaliseParameters({parameters: {learnerId: 'L', attemptId: 'A', maxCorrectiveExplanations: 999}}).maxCorrectiveExplanations === 8)
  assert(fb.normaliseParameters({parameters: {learnerId: 'L', attemptId: 'A', maxCorrectiveExplanations: 0}}).maxCorrectiveExplanations === 1)
})

console.log('\nScore-band tone mapping')

const cases = [[95, 'celebratory'], [85, 'celebratory'], [70, 'positive'],
  [60, 'balanced'], [40, 'supportive'], [20, 'gentle'], [0, 'gentle']]
for (const [pct, want] of cases) {
  test(`tone(${pct}) = ${want}`, () => {
    const got = fb.pickTone(pct)
    assert(got === want, `expected ${want}, got ${got}`)
  })
}

console.log('\nbuildScoreBlock normalisation')

test('reads score+totalMarks+percentage from results doc', () => {
  const s = fb.buildScoreBlock({score: 7, totalMarks: 10, percentage: 70})
  assert(s.score === 7 && s.outOf === 10 && s.percentage === 70)
})
test('computes percentage when missing', () => {
  const s = fb.buildScoreBlock({score: 5, totalMarks: 10})
  assert(s.percentage === 50)
})
test('clamps outOf to ≥ 1', () => {
  const s = fb.buildScoreBlock({score: 0, totalMarks: 0})
  assert(s.outOf >= 1)
})

console.log('\nderiveStrengthsAndWeakAreas')

test('topicScores ≥ 70 → strengths, < 70 → weakAreas', () => {
  const d = fb.deriveStrengthsAndWeakAreas({
    attempt: {topicScores: {Heart: 90, BloodVessels: 30, Lungs: 75}},
  })
  assert(d.strengths.includes('Heart') && d.strengths.includes('Lungs'))
  assert(d.weakAreas.includes('BloodVessels'))
  assert(!d.strengths.includes('BloodVessels'))
  assert(!d.weakAreas.includes('Heart'))
})

test('profile.weakTopics enriches weakAreas without duplicating', () => {
  const d = fb.deriveStrengthsAndWeakAreas({
    attempt: {topicScores: {Heart: 30}},
    profile: {weakTopics: ['Heart', 'Fractions']},
  })
  assert(d.weakAreas.includes('Heart'))
  assert(d.weakAreas.includes('Fractions'))
  assert(d.weakAreas.filter(t => t === 'Heart').length === 1, 'no duplication')
})

test('empty attempt yields no strengths', () => {
  const d = fb.deriveStrengthsAndWeakAreas({attempt: {topicScores: {}}})
  assert(d.strengths.length === 0)
})

console.log('\nNo fake praise + no shaming rules')

test('low-score attempt yields zero strengths', () => {
  const lowAttempt = {topicScores: {Heart: 10, BloodVessels: 5}}
  const d = fb.deriveStrengthsAndWeakAreas({attempt: lowAttempt})
  assert(d.strengths.length === 0, 'no strength manufactured for low score')
})

test('stub feedback omits strengths sentence when empty', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 1, totalMarks: 10, percentage: 10}),
    strengths: [], weakAreas: ['Heart'],
    studyTip: null, parameters: fb.DEFAULT_PARAMETERS,
  })
  assert(!stub.encouragingMessage.includes('You did well'),
    `low score must NOT include "You did well" — got: ${stub.encouragingMessage}`)
})

test('stub feedback uses gentle opener on very low score', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 1, totalMarks: 10, percentage: 10}),
    strengths: [], weakAreas: ['Heart'],
    studyTip: null, parameters: fb.DEFAULT_PARAMETERS,
  })
  assert(stub.tone === 'gentle')
  assert(stub.encouragingMessage.startsWith(fb.TONE_OPENERS.gentle))
})

test('stub feedback never uses shaming words', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 1, totalMarks: 10, percentage: 10}),
    strengths: [], weakAreas: ['Heart'],
    studyTip: null, parameters: fb.DEFAULT_PARAMETERS,
  })
  const banned = ['you failed', "you're bad", 'you are bad', "you didn't try"]
  for (const phrase of banned) {
    assert(!stub.encouragingMessage.toLowerCase().includes(phrase),
      `must not include shaming phrase "${phrase}"`)
  }
})

console.log('\nVerb-head + generic tip filtering')

test('validStudyTip accepts imperative-led', () => {
  assert(fb.validStudyTip('Practice 5 blood-vessel questions tomorrow.') ===
    'Practice 5 blood-vessel questions tomorrow.')
})
test('validStudyTip rejects declarative', () => {
  assert(fb.validStudyTip('Blood vessels are important.') === null)
})
test('validStudyTip rejects generic', () => {
  assert(fb.validStudyTip('Study hard every day.') === null)
})

console.log('\nStructured stub end-to-end')

test('stub generates one corrective explanation per weak area (up to max)', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 4, totalMarks: 10, percentage: 40}),
    strengths: ['Heart'], weakAreas: ['BloodVessels', 'Lungs'],
    studyTip: null,
    parameters: {maxCorrectiveExplanations: 2},
  })
  assert(stub.correctiveExplanations.length === 2)
  assert(stub.correctiveExplanations[0].topic === 'BloodVessels')
})

test('stub reuses supplied study tip when valid', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 7, totalMarks: 10, percentage: 70}),
    strengths: ['Heart'], weakAreas: ['BloodVessels'],
    studyTip: 'Draw a labelled diagram of arteries and veins tomorrow.',
    parameters: fb.DEFAULT_PARAMETERS,
  })
  assert(stub.studyTip === 'Draw a labelled diagram of arteries and veins tomorrow.')
})

test('stub generates verb-led tip when none supplied', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 4, totalMarks: 10, percentage: 40}),
    strengths: [], weakAreas: ['BloodVessels'],
    studyTip: null, parameters: fb.DEFAULT_PARAMETERS,
  })
  assert(fb.VERB_HEAD.test(stub.studyTip),
    `stub-generated tip must be verb-led, got: ${stub.studyTip}`)
})

test('stub recommendedQuizzes default to easier difficulty', () => {
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock({score: 4, totalMarks: 10, percentage: 40}),
    strengths: [], weakAreas: ['BloodVessels'],
    studyTip: null, parameters: fb.DEFAULT_PARAMETERS,
  })
  assert(stub.recommendedQuizzes[0].difficulty === 'easy',
    'first recommended quiz must be easy to rebuild confidence')
})

console.log('\nDispatcher auto-publish allow-list')

test('learner_feedback entry exists', () => {
  assert(DISPATCHER_TEXT.includes('learner_feedback'),
    'dispatcher allow-list must include learner_feedback')
  assert(DISPATCHER_TEXT.includes('autoPublishLearnerFeedback'),
    'dispatcher must read settings.autoPublishLearnerFeedback')
})
test('learner_feedback entry enforces learnerId+attemptId precondition', () => {
  // Both names must appear in the entry block.
  const idx = DISPATCHER_TEXT.indexOf('learner_feedback:')
  const slice = DISPATCHER_TEXT.slice(idx, idx + 500)
  assert(slice.includes('learnerId'), 'precondition must check learnerId')
  assert(slice.includes('attemptId'), 'precondition must check attemptId')
})

console.log('\nEnd-to-end Zod validation')

test('stub-derived feedback content passes learnerFeedbackContentSchema', () => {
  const attempt = {userId: 'L1', score: 7, totalMarks: 10, percentage: 70,
    topicScores: {Heart: 90, BloodVessels: 30}, quizId: 'Q1'}
  const d = fb.deriveStrengthsAndWeakAreas({attempt})
  const params = fb.normaliseParameters({parameters: {learnerId: 'L1', attemptId: 'A1'}})
  const stub = fb.buildStructuredStub({
    curriculumReader: reader,
    attempt: fb.buildScoreBlock(attempt),
    strengths: d.strengths, weakAreas: d.weakAreas,
    studyTip: null, parameters: params,
  })
  const content = {
    title: stub.title, score: stub.score, tone: stub.tone,
    encouragingMessage: stub.encouragingMessage,
    strengths: stub.strengths, weakAreas: stub.weakAreas,
    correctiveExplanations: stub.correctiveExplanations,
    recommendedNotes: stub.recommendedNotes,
    recommendedQuizzes: stub.recommendedQuizzes,
    studyTip: stub.studyTip,
    grade: reader.grade, subject: reader.subject, term: reader.term,
    topic: reader.topic, subtopic: reader.subtopic,
    learnerId: 'L1', attemptId: 'A1', quizId: 'Q1',
    modelUsed: 'stub', parametersUsed: params,
  }
  const parsed = learnerFeedbackContentSchema.parse(content)
  assert(parsed.tone === 'positive')
  assert(parsed.score.percentage === 70)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
