#!/usr/bin/env node
/**
 * Zambian Curriculum & Exam Standards Check Agent — unit tests.
 *
 * Covers:
 *   - Every per-axis check (pass / fail / skip outcomes)
 *   - Verdict assembly: confidence math, status decision rule
 *   - zambianCurriculumFit + zambianAssessmentFit derivation
 *   - Foreign-content heuristic with Zambian-whitelist override
 *   - Age-suitability check scoped to lower-primary grades only
 *   - Supervisor planner inserts standardsCheck into every applicable
 *     generator chain
 *   - Dispatcher carries chainContext.standardsCheck forward
 *   - End-to-end Zod validation against standardsCheckVerdictSchema
 *
 * Run: npm run test:standards-check  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/standardsCheck.js')
const SUPERVISOR = join(ROOT, 'functions/agents/learnerAi/runners/supervisor.js')
const DISPATCHER_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8')

// Stub admin + logger so the runner loads in plain Node.
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

const sc = await import(RUNNER)
const supervisor = await import(SUPERVISOR)
const { standardsCheckVerdictSchema } = await import('../src/schemas/learnerAi.js')
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
}

const goodQuestion = {
  questionText: 'What is 1/2 + 1/4? A learner from Lusaka asks.',
  prompt: 'What is 1/2 + 1/4? A learner from Lusaka asks.',
  questionType: 'mcq', marks: 2,
  grade: '7', subject: 'Mathematics', term: '1',
  topic: 'Fractions', subtopic: 'Adding fractions',
  competency: 'Add and subtract fractions',
  learningOutcome: 'Add fractions with same denominator',
  options: ['1/4', '3/4', '1/6', '2/6'], correctAnswer: '3/4',
}

const goodPracticeContent = {
  grade: '7', subject: 'Mathematics', term: '1',
  topic: 'Fractions', subtopic: 'Adding fractions',
  questions: [goodQuestion],
}

console.log('\nPer-axis alignment checks')

test('checkGrade passes on match', () => {
  const r = sc.checkGrade({content: goodPracticeContent, reader})
  assert(r.verdict === 'pass', `expected pass, got ${r.verdict}`)
})
test('checkGrade fails on mismatch', () => {
  const r = sc.checkGrade({content: {...goodPracticeContent, grade: '5'}, reader})
  assert(r.verdict === 'fail', 'must fail on mismatch')
  assert(r.issue && r.issue.severity === 'critical', 'must be critical')
})
test('checkSubject fails on mismatch', () => {
  const r = sc.checkSubject({content: {...goodPracticeContent, subject: 'Science'}, reader})
  assert(r.verdict === 'fail', 'subject mismatch must fail')
  assert(r.issue.severity === 'critical', 'subject mismatch is critical')
})
test('checkTopic fails on mismatch', () => {
  const r = sc.checkTopic({content: {...goodPracticeContent, topic: 'Decimals'}, reader})
  assert(r.verdict === 'fail')
  assert(r.issue.severity === 'critical')
})
test('checkCompetency fails when questions stamp wrong competency', () => {
  const bad = {...goodPracticeContent, questions: [{...goodQuestion, competency: 'Unrelated'}]}
  const r = sc.checkCompetency({content: bad, reader})
  assert(r.verdict === 'fail')
})
test('checkLearningOutcome fails on mismatch', () => {
  const bad = {...goodPracticeContent, questions: [{...goodQuestion, learningOutcome: 'something else'}]}
  const r = sc.checkLearningOutcome({content: bad, reader})
  assert(r.verdict === 'fail')
  assert(r.issue.severity === 'minor', 'learning outcome mismatch is minor')
})

console.log('\nForeign content detection')

test('flags London + dollar amounts', () => {
  const bad = {questions: [{prompt: 'What is the price of bread in London? $5 or $10?'}]}
  const r = sc.checkForeignContent({content: bad})
  assert(r.verdict === 'fail', `expected fail, got ${r.verdict}`)
  assert(r.issue.severity === 'critical')
})
test('whitelists Lusaka + ZMW', () => {
  const ok = {questions: [{prompt: 'What is the price of nshima in Lusaka in ZMW?'}]}
  const r = sc.checkForeignContent({content: ok})
  assert(r.verdict === 'pass')
})
test('passes when no excerpts referenced (vacuously)', () => {
  const r = sc.checkForeignContent({content: {questions: []}})
  assert(r.verdict === 'skip' || r.verdict === 'pass',
    `expected skip or pass, got ${r.verdict}`)
})

console.log('\nAge suitability — lower-primary only')

test('skips for upper grades (Grade 7)', () => {
  const r = sc.checkAgeSuitability({content: goodPracticeContent, reader})
  assert(r.verdict === 'skip', `expected skip on G7, got ${r.verdict}`)
})
test('flags multi-15-letter words for Grade 2', () => {
  const lpReader = {...reader, grade: '2'}
  const bad = {questions: [
    {prompt: 'Discuss internationalisation of educationalisation.'},
    {prompt: 'Constitutionality of unconstitutionality?'},
    {prompt: 'Internationally interconnected interrelated.'},
  ]}
  const r = sc.checkAgeSuitability({content: bad, reader: lpReader})
  assert(r.verdict === 'fail', `expected fail, got ${r.verdict}`)
})
test('passes for short words at Grade 2', () => {
  const lpReader = {...reader, grade: '2'}
  const ok = {questions: [{prompt: 'What is 1 + 1? Use small numbers.'}]}
  const r = sc.checkAgeSuitability({content: ok, reader: lpReader})
  assert(r.verdict === 'pass')
})

console.log('\nLanguage check')

test('flags archaic English (thou/thee/whilst)', () => {
  const bad = {questions: [{prompt: 'Thou shalt know thy fractions whilst learning.'}]}
  const r = sc.checkLanguage({content: bad})
  assert(r.verdict === 'fail')
})

console.log('\nExam-paper structural checks')

const goodExamContent = {
  header: {
    schoolName: '', grade: '7', term: '1', year: 2026,
    subject: 'Mathematics', paperName: 'End-of-Term',
    learnerNameLabel: 'Name:', dateLabel: 'Date:', timeLabel: 'Time:',
    totalMarks: 15, timeAllowed: '1 hour',
    instructions: ['Read carefully.', 'Answer all questions.'],
  },
  grade: '7', subject: 'Mathematics', term: '1',
  topic: 'Fractions', subtopic: 'Adding fractions',
  sections: [
    {id: 'A', title: 'A', marks: 5, questions: [
      {prompt: 'q1', marks: 5, competency: 'Add and subtract fractions',
        learningOutcome: 'Add fractions with same denominator',
        topic: 'Fractions', subtopic: 'Adding fractions'},
    ]},
    {id: 'B', title: 'B', marks: 10, questions: [
      {prompt: 'q2', marks: 10, competency: 'Add and subtract fractions',
        learningOutcome: 'Add fractions with same denominator',
        topic: 'Fractions', subtopic: 'Adding fractions'},
    ]},
  ],
}

test('paper_structure passes with Sections A + B', () => {
  const r = sc.checkPaperStructure({content: goodExamContent, artifactType: 'exam_quiz'})
  assert(r.verdict === 'pass')
})
test('paper_structure fails missing Section B', () => {
  const bad = {...goodExamContent, sections: goodExamContent.sections.slice(0, 1)}
  const r = sc.checkPaperStructure({content: bad, artifactType: 'exam_quiz'})
  assert(r.verdict === 'fail')
  assert(r.issue.severity === 'critical')
})
test('paper_structure is skip for non-exam artifact', () => {
  const r = sc.checkPaperStructure({content: goodExamContent, artifactType: 'practice_quiz'})
  assert(r.verdict === 'skip')
})
test('marks_allocation fails when section marks ≠ sum of question marks', () => {
  const bad = JSON.parse(JSON.stringify(goodExamContent))
  bad.sections[0].marks = 99
  const r = sc.checkMarksAllocation({content: bad, artifactType: 'exam_quiz'})
  assert(r.verdict === 'fail')
})
test('marks_allocation fails when header total ≠ sum of section marks', () => {
  const bad = JSON.parse(JSON.stringify(goodExamContent))
  bad.header.totalMarks = 999
  const r = sc.checkMarksAllocation({content: bad, artifactType: 'exam_quiz'})
  assert(r.verdict === 'fail')
})
test('instructions fails with <2 entries', () => {
  const bad = {...goodExamContent, header: {...goodExamContent.header, instructions: ['Only one.']}}
  const r = sc.checkInstructions({content: bad, artifactType: 'exam_quiz'})
  assert(r.verdict === 'fail')
})
test('sections fails when Standards expected Section C and it is missing', () => {
  const standards = {structure: {sections: [
    {id: 'A', count: 5}, {id: 'B', count: 3}, {id: 'C', count: 2},
  ]}}
  const r = sc.checkSections({content: goodExamContent, artifactType: 'exam_quiz', standards})
  assert(r.verdict === 'fail', `expected fail, got ${r.verdict}`)
})

console.log('\nVerdict assembly')

test('happy practice quiz → passed with confidence 1.0', () => {
  const v = sc.buildVerdict({
    artifactType: 'practice_quiz', content: goodPracticeContent, reader, standards: null,
  })
  assert(v.status === 'passed', `expected passed, got ${v.status}`)
  assert(v.confidenceScore === 1, `expected confidence 1.0, got ${v.confidenceScore}`)
  assert(v.issues.length === 0, 'no issues')
  assert(v.zambianCurriculumFit === true, 'curriculum fit')
  assert(v.zambianAssessmentFit === true, 'assessment fit (vacuous for non-exam)')
})

test('grade mismatch → failed (critical issue)', () => {
  const v = sc.buildVerdict({
    artifactType: 'practice_quiz',
    content: {...goodPracticeContent, grade: '5'},
    reader, standards: null,
  })
  assert(v.status === 'failed', `expected failed, got ${v.status}`)
  assert(v.zambianCurriculumFit === false, 'curriculum fit must be false')
  assert(v.recommendations.length >= 1, 'must surface a recommendation')
})

test('mark-allocation mismatch only → needs_review (minor only)', () => {
  const examBad = JSON.parse(JSON.stringify(goodExamContent))
  examBad.header.totalMarks = 999
  const v = sc.buildVerdict({
    artifactType: 'exam_quiz', content: examBad, reader, standards: null,
  })
  assert(v.status === 'needs_review',
    `expected needs_review, got ${v.status} (conf=${v.confidenceScore})`)
  assert(v.zambianAssessmentFit === false, 'assessment fit must be false')
  assert(v.zambianCurriculumFit === true, 'curriculum fit unaffected')
})

test('confidence math: 1 critical = 0.85', () => {
  assert(sc.computeConfidence([{severity: 'critical', axis: 'grade', message: 'x'}]) === 0.85)
})
test('confidence math: 3 minor = 0.85', () => {
  const conf = sc.computeConfidence([
    {severity: 'minor', axis: 'term', message: 'x'},
    {severity: 'minor', axis: 'language', message: 'x'},
    {severity: 'minor', axis: 'instructions', message: 'x'},
  ])
  assert(conf === 0.85, `expected 0.85, got ${conf}`)
})
test('confidence floor at 0', () => {
  const huge = Array.from({length: 20}, () => ({severity: 'critical', axis: 'grade', message: 'x'}))
  assert(sc.computeConfidence(huge) === 0)
})

test('decideStatus: critical issue → failed regardless of confidence', () => {
  const s = sc.decideStatus({
    issues: [{severity: 'critical', axis: 'grade', message: 'x'}],
    confidence: 0.95,
  })
  assert(s === 'failed', `expected failed, got ${s}`)
})
test('decideStatus: no issues + conf 1.0 → passed', () => {
  assert(sc.decideStatus({issues: [], confidence: 1.0}) === 'passed')
})
test('decideStatus: minor only + conf 0.85 → needs_review', () => {
  const s = sc.decideStatus({
    issues: [{severity: 'minor', axis: 'instructions', message: 'x'}],
    confidence: 0.85,
  })
  assert(s === 'needs_review', `expected needs_review, got ${s}`)
})

console.log('\nSupervisor planner — standardsCheck slotted into every applicable chain')

for (const t of ['practice_quiz', 'notes', 'study_tips', 'learner_feedback']) {
  test(`planStepsFor(${t}) includes standardsCheck before qualityCheck`, () => {
    const steps = supervisor.planStepsFor(t)
    const idxCheck = steps.indexOf('standardsCheck')
    const idxQuality = steps.indexOf('qualityCheck')
    assert(idxCheck > 0, `standardsCheck missing for ${t}`)
    assert(idxQuality > idxCheck, `standardsCheck must run before qualityCheck for ${t}`)
  })
}

test('planStepsFor(exam_quiz) = [reader, standards, examQuiz, standardsCheck, qualityCheck, supervisorReview]', () => {
  const steps = supervisor.planStepsFor('exam_quiz')
  assert(steps.length === 6, `expected 6 steps, got ${steps.join(',')}`)
  assert(steps[0] === 'curriculumReader')
  assert(steps[1] === 'standards')
  assert(steps[2] === 'examQuiz')
  assert(steps[3] === 'standardsCheck')
  assert(steps[4] === 'qualityCheck')
  assert(steps[5] === 'supervisorReview',
    `final step must be supervisorReview gatekeeper, got ${steps[5]}`)
})

test('planStepsFor(weakness_analysis) does NOT include standardsCheck', () => {
  const steps = supervisor.planStepsFor('weakness_analysis')
  assert(!steps.includes('standardsCheck'),
    `weakness_analysis must NOT carry standardsCheck (got ${steps.join(',')})`)
})

console.log('\nDispatcher wiring')

test('dispatcher imports runStandardsCheck', () => {
  assert(DISPATCHER_TEXT.includes('runStandardsCheck'),
    'dispatcher must require runStandardsCheck')
  assert(DISPATCHER_TEXT.includes('standardsCheck: runStandardsCheck'),
    'dispatcher RUNNER_MAP must include standardsCheck')
})

test('dispatcher carries chainContext.standardsCheck forward', () => {
  assert(DISPATCHER_TEXT.includes('chainContext.standardsCheck'),
    'dispatcher must stash result.standardsCheckVerdict on chainContext')
})

console.log('\nEnd-to-end Zod validation')

test('happy verdict validates against standardsCheckVerdictSchema', () => {
  const base = sc.buildVerdict({
    artifactType: 'practice_quiz', content: goodPracticeContent, reader, standards: null,
  })
  const full = {...base, contentId: 'abc', checkedAt: new Date()}
  const parsed = standardsCheckVerdictSchema.parse(full)
  assert(parsed.status === 'passed', 'parsed status')
})

test('exam mark-mismatch verdict validates', () => {
  const examBad = JSON.parse(JSON.stringify(goodExamContent))
  examBad.header.totalMarks = 999
  const base = sc.buildVerdict({
    artifactType: 'exam_quiz', content: examBad, reader, standards: null,
  })
  const full = {...base, contentId: 'abc', checkedAt: new Date()}
  const parsed = standardsCheckVerdictSchema.parse(full)
  assert(parsed.zambianAssessmentFit === false)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
