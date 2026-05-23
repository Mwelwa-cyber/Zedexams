#!/usr/bin/env node
/**
 * Study Tips Generator Agent — unit tests.
 *
 * Covers:
 *   - Parameter normalisation (weakLearnerId, maxTips, etc.)
 *   - gatherWeakSignals across the 3 sources (profile / parameter / both)
 *   - Hard rule: refuses if zero signals → would throw 'missing_weakness_data'
 *   - Generic-tip filter (looksGeneric + stampTip)
 *   - Verb-head filter on stampTip (Quality Check v3 tips_actionable)
 *   - Structured stub produces every required section
 *   - buildDefaultRevisionPlan respects planDurationDays
 *   - Auto-publish allow-list includes study_tips with the
 *     weakLearnerId precondition
 *   - End-to-end Zod validation against studyTipsContentSchema
 *
 * Run: npm run test:study-tips  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/studyTips.js')
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

const tips = await import(RUNNER)
const { studyTipsContentSchema, studyTipsParametersSchema } =
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
  grade: '7', subject: 'Mathematics', term: '1',
  topic: 'Fractions', subtopic: 'Adding fractions',
  competencies: ['Add and subtract fractions'],
  learningOutcomes: ['Add fractions with same denominator'],
  keyConcepts: ['numerator', 'denominator', 'common denominator'],
  citedExcerpts: [{text: 'Add fractions by finding the common denominator.', anchor: 'content'}],
  curriculumDocumentPath: 'syllabi/g7-math.pdf',
  curriculumVersion: 'cbc-kb-2026-04-seed',
  sourceDocId: 'g7-math',
}

const profile = {
  learnerId: 'learner-1', grade: '7', subject: 'Mathematics',
  weakTopics: ['Fractions', 'Decimals'],
  weakSubtopics: ['Adding fractions', 'Multiplying decimals'],
  repeatedMistakes: [
    {topic: 'Fractions', subtopic: 'Adding fractions', mistake: 'confused numerator with denominator'},
  ],
}

console.log('\nParameter normalisation')

test('defaults when params absent', () => {
  const p = tips.normaliseParameters({})
  assert(p.weakLearnerId === null)
  assert(p.maxTips === 6)
  assert(p.includeRevisionPlan === true)
  assert(p.planDurationDays === 7)
})
test('clamps maxTips to [3, 15]', () => {
  assert(tips.normaliseParameters({parameters: {weakLearnerId: 'x', maxTips: 999}}).maxTips === 15)
  assert(tips.normaliseParameters({parameters: {weakLearnerId: 'x', maxTips: 0}}).maxTips === 3)
})
test('clamps planDurationDays to [3, 14]', () => {
  assert(tips.normaliseParameters({parameters: {weakLearnerId: 'x', planDurationDays: 999}}).planDurationDays === 14)
})
test('weakLearnerId trimmed to 120 chars', () => {
  const id = 'x'.repeat(200)
  assert(tips.normaliseParameters({parameters: {weakLearnerId: id}}).weakLearnerId.length === 120)
})
test('parameters validate against studyTipsParametersSchema', () => {
  const p = tips.normaliseParameters({parameters: {weakLearnerId: 'learner-1'}})
  const parsed = studyTipsParametersSchema.parse(p)
  assert(parsed.weakLearnerId === 'learner-1')
})

console.log('\ngatherWeakSignals — real-weakness-data invariant')

test('returns [] when neither profile nor weakAreas supplied', () => {
  const s = tips.gatherWeakSignals({profile: null, weakAreas: []})
  assert(s.length === 0, 'no data → no signals (runner will refuse)')
})

test('extracts subtopic-level signals from profile', () => {
  const s = tips.gatherWeakSignals({profile, weakAreas: []})
  assert(s.length === 2, `expected 2 signals, got ${s.length}`)
  assert(s.every(x => x.source === 'profile'), 'all from profile')
  assert(s.some(x => x.subtopic === 'Adding fractions'), 'Adding fractions signal present')
  assert(s.some(x => x.mistakeNote && x.mistakeNote.includes('numerator')), 'mistake note attached')
})

test('promotes weakTopics without subtopic coverage to topic-level signals', () => {
  const p2 = {weakTopics: ['Geometry'], weakSubtopics: [], repeatedMistakes: []}
  const s = tips.gatherWeakSignals({profile: p2, weakAreas: []})
  assert(s.length === 1)
  assert(s[0].topic === 'Geometry')
  assert(s[0].subtopic === null)
})

test('appends explicit weakAreas alongside profile signals', () => {
  const s = tips.gatherWeakSignals({
    profile,
    weakAreas: [{topic: 'Algebra', subtopic: 'Linear equations'}],
  })
  assert(s.length === 3, `expected 3 signals, got ${s.length}`)
  assert(s.some(x => x.source === 'parameter' && x.topic === 'Algebra'))
})

test('caps signals at 40', () => {
  const big = {weakTopics: Array.from({length: 60}, (_, i) => `Topic${i}`),
    weakSubtopics: [], repeatedMistakes: []}
  const s = tips.gatherWeakSignals({profile: big, weakAreas: []})
  assert(s.length <= 40, `must cap at 40, got ${s.length}`)
})

console.log('\nGeneric-tip + verb-head filtering (Quality Check v3 alignment)')

test('looksGeneric flags "study hard"', () => {
  assert(tips.looksGeneric('Study hard every day.') === true)
  assert(tips.looksGeneric('Practice numerator additions daily.') === false)
})
test('stampTip rejects declarative tips', () => {
  const out = tips.stampTip({tip: 'Fractions are important.', reason: 'x', topic: 'F'}, 'F')
  assert(out === null, 'declarative tips must be rejected')
})
test('stampTip rejects generic tips', () => {
  const out = tips.stampTip({tip: 'Study hard every night.', reason: 'x', topic: 'F', priority: 'high', estimatedMinutes: 10}, 'F')
  assert(out === null, 'generic tips must be rejected')
})
test('stampTip accepts imperative + specific tip', () => {
  const out = tips.stampTip({tip: 'Practice 5 same-denominator additions before bed.', reason: 'profile flagged', topic: 'Fractions', priority: 'high', estimatedMinutes: 10}, 'Fractions')
  assert(out !== null && out.priority === 'high' && out.estimatedMinutes === 10)
})

console.log('\nStructured stub (CI / no-LLM fallback)')

const signals = tips.gatherWeakSignals({profile, weakAreas: []})

test('stub returns null when no signals', () => {
  const stub = tips.buildStructuredStub({curriculumReader: reader, weakSignals: [], parameters: tips.normaliseParameters({parameters: {weakLearnerId: 'l1'}})})
  assert(stub === null, 'no signals → refuse')
})

test('stub produces tips per signal, respecting maxTips', () => {
  const stub = tips.buildStructuredStub({
    curriculumReader: reader, weakSignals: signals,
    parameters: tips.normaliseParameters({parameters: {weakLearnerId: 'l1', maxTips: 3}}),
  })
  assert(stub.tips.length <= 3, `expected ≤3 tips, got ${stub.tips.length}`)
  assert(stub.tips.every(t => tips.VERB_HEAD.test(t.tip)),
    'every tip must start with an imperative verb')
})

test('stub feedback names the weak area', () => {
  const stub = tips.buildStructuredStub({
    curriculumReader: reader, weakSignals: signals,
    parameters: tips.normaliseParameters({parameters: {weakLearnerId: 'l1'}}),
  })
  assert(stub.feedback.toLowerCase().includes('fraction') ||
    stub.feedback.toLowerCase().includes('decimal'),
    'feedback must reference an actual weak topic')
})

test('stub recommendedQuizzes target weak subtopics', () => {
  const stub = tips.buildStructuredStub({
    curriculumReader: reader, weakSignals: signals,
    parameters: tips.normaliseParameters({parameters: {weakLearnerId: 'l1'}}),
  })
  assert(stub.recommendedQuizzes.length >= 1, 'must recommend at least 1 quiz')
  assert(stub.recommendedQuizzes.every(q => q.numQuestions >= 3 && q.numQuestions <= 20))
})

test('buildDefaultRevisionPlan honours days', () => {
  const plan = tips.buildDefaultRevisionPlan(signals, 5, 'Fractions')
  assert(plan.length === 5)
  assert(plan[0].day === 1 && plan[4].day === 5)
})

test('stub omits revision plan when includeRevisionPlan:false', () => {
  const stub = tips.buildStructuredStub({
    curriculumReader: reader, weakSignals: signals,
    parameters: tips.normaliseParameters({parameters: {weakLearnerId: 'l1', includeRevisionPlan: false}}),
  })
  assert(stub.revisionPlan.length === 0, 'revision plan must be empty')
})

console.log('\nDispatcher auto-publish allow-list')

test('study_tips entry exists in AUTO_PUBLISH_SETTING_BY_TASK', () => {
  assert(DISPATCHER_TEXT.includes('study_tips'),
    'dispatcher allow-list must include study_tips entry')
  assert(DISPATCHER_TEXT.includes('autoPublishStudyTips'),
    'dispatcher must read settings.autoPublishStudyTips')
})

test('study_tips entry requires weakLearnerId precondition', () => {
  assert(DISPATCHER_TEXT.includes('weakLearnerId'),
    'study_tips precondition must reference weakLearnerId')
})

console.log('\nEnd-to-end Zod validation')

test('stub-derived studyTips content passes studyTipsContentSchema', () => {
  const parameters = tips.normaliseParameters({parameters: {weakLearnerId: 'learner-1', maxTips: 4}})
  const stub = tips.buildStructuredStub({curriculumReader: reader, weakSignals: signals, parameters})
  const content = {
    title: stub.title,
    feedback: stub.feedback,
    tips: stub.tips,
    recommendedNotes: stub.recommendedNotes,
    recommendedQuizzes: stub.recommendedQuizzes,
    revisionPlan: stub.revisionPlan,
    weakSignalsUsed: signals,
    grade: reader.grade, subject: reader.subject, term: reader.term,
    topic: reader.topic, subtopic: reader.subtopic,
    learnerId: 'learner-1',
    modelUsed: 'stub', parametersUsed: parameters,
  }
  const parsed = studyTipsContentSchema.parse(content)
  assert(parsed.tips.length >= 1)
  assert(parsed.weakSignalsUsed.length >= 1)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
