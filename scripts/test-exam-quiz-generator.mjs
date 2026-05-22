#!/usr/bin/env node
/**
 * Exam Quiz Generator + Standards Agent — unit tests.
 *
 * Covers:
 *   - Standards Agent default lookup per assessmentType
 *   - Exam Quiz parameter normalisation
 *   - Stamping + filtering (drops invalid questions per section type)
 *   - Structured stub (CI / no-LLM fallback) builds A/B/C sections
 *     with valid answer key and marking guide
 *   - End-to-end Zod validation against examQuizContentSchema
 *   - Hard rule: shouldAutoPublish refuses exam_quiz (only practice_quiz
 *     can auto-publish)
 *   - Supervisor planner inserts standards step for exam_quiz
 *
 * Run: npm run test:exam-quiz  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const EXAM_RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/examQuiz.js')
const STANDARDS_RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/standards.js')
const SUPERVISOR = join(ROOT, 'functions/agents/learnerAi/runners/supervisor.js')
const DISPATCHER_TEXT = readFileSync(join(ROOT, 'functions/agents/learnerAi/dispatcher.js'), 'utf8')

// Stub admin + logger so the runners load in plain Node.
const fakeAdmin = {
  firestore: () => ({
    collection: () => ({
      where: () => ({where: () => ({where: () => ({limit: () => ({get: async () => ({empty: true})})})})}),
    }),
  }),
}
fakeAdmin.firestore.FieldValue = {serverTimestamp: () => '__ts__'}

const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  if (request === '../logger') {
    return {writeAgentLog: async () => {}, updateLiveAgentState: async () => {}, writeTaskStep: async () => {}}
  }
  return origLoad.call(this, request, parent, ...rest)
}

const exam = await import(EXAM_RUNNER)
const standards = await import(STANDARDS_RUNNER)
const supervisor = await import(SUPERVISOR)
const { examQuizContentSchema, examQuizParametersSchema } =
  await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nStandards Agent — defaults per assessmentType')

for (const t of ['practice_quiz', 'topic_test', 'monthly_test',
  'midterm_test', 'end_of_term_test', 'composite_exam']) {
  test(`DEFAULTS[${t}] has all required fields`, () => {
    const d = standards.DEFAULTS[t]
    assert(d, 'missing entry')
    assert(d.sectionASize >= 1, 'sectionASize')
    assert(d.totalMarks >= 1, 'totalMarks')
    assert(typeof d.timeAllowed === 'string', 'timeAllowed')
    assert(d.bloomsDistribution && typeof d.bloomsDistribution === 'object', 'bloomsDistribution')
  })
}

test('buildStandardsContext falls back to default when no approved doc', () => {
  const ctx = standards.buildStandardsContext({
    task: {assessmentType: 'end_of_term_test'}, approved: null,
  })
  assert(ctx.source === 'default', 'source must be default')
  assert(ctx.assessmentType === 'end_of_term_test', 'assessmentType echoed')
  assert(ctx.structure.sections.length === 3, '3 sections')
  assert(ctx.structure.bloomsDistribution, 'Blooms distribution present')
})

test('buildStandardsContext uses approved doc when present', () => {
  const ctx = standards.buildStandardsContext({
    task: {assessmentType: 'topic_test'},
    approved: {id: 'std-1', structure: {sections: [], paperName: 'Topic'},
      sourceReference: 'ECZ 2024'},
  })
  assert(ctx.source === 'approved', 'source must be approved')
  assert(ctx.standardId === 'std-1', 'standardId carried through')
})

console.log('\nSupervisor planner — exam_quiz chain includes Standards')

test('planStepsFor(exam_quiz) is [reader, standards, generator, standardsCheck, qualityCheck]', () => {
  const steps = supervisor.planStepsFor('exam_quiz')
  assert(Array.isArray(steps), 'steps must be an array')
  assert(steps.length === 5, `expected 5 steps, got ${steps.length}: ${steps.join(',')}`)
  assert(steps[0] === 'curriculumReader', `step 0 wrong: ${steps[0]}`)
  assert(steps[1] === 'standards', `step 1 must be standards: ${steps[1]}`)
  assert(steps[2] === 'examQuiz', `step 2 must be examQuiz: ${steps[2]}`)
  assert(steps[3] === 'standardsCheck', `step 3 must be standardsCheck: ${steps[3]}`)
  assert(steps[4] === 'qualityCheck', `step 4 wrong: ${steps[4]}`)
})

test('planStepsFor(practice_quiz) skips reference-data Standards (no exam structure needed)', () => {
  const steps = supervisor.planStepsFor('practice_quiz')
  assert(!steps.includes('standards'),
    `practice_quiz must NOT include reference-data Standards: ${steps.join(',')}`)
  // It DOES include the standardsCheck verification agent.
  assert(steps.includes('standardsCheck'),
    `practice_quiz must include standardsCheck verification: ${steps.join(',')}`)
})

console.log('\nExam Quiz parameter normalisation')

const stdCtx = standards.buildStandardsContext({
  task: {assessmentType: 'end_of_term_test'}, approved: null,
})

test('refuses without assessmentType', () => {
  const p = exam.normaliseParameters({
    task: {parameters: {}}, standards: null,
  })
  assert(p.assessmentType === null, `expected null, got ${p.assessmentType}`)
})

test('pulls assessmentType from parameters first', () => {
  const p = exam.normaliseParameters({
    task: {assessmentType: 'topic_test', parameters: {assessmentType: 'composite_exam'}},
    standards: stdCtx,
  })
  assert(p.assessmentType === 'composite_exam', `expected composite_exam, got ${p.assessmentType}`)
})

test('falls back to task.assessmentType when params omit it', () => {
  const p = exam.normaliseParameters({
    task: {assessmentType: 'topic_test', parameters: {}},
    standards: stdCtx,
  })
  assert(p.assessmentType === 'topic_test', `expected topic_test, got ${p.assessmentType}`)
})

test('clamps section sizes to bounds', () => {
  const p = exam.normaliseParameters({
    task: {assessmentType: 'topic_test',
      parameters: {assessmentType: 'topic_test',
        sectionASize: 999, sectionBSize: 999, sectionCSize: 999}},
    standards: stdCtx,
  })
  assert(p.sectionASize === 30, 'A clamp')
  assert(p.sectionBSize === 20, 'B clamp')
  assert(p.sectionCSize === 10, 'C clamp')
})

test('totalMarks defaults from Standards when not supplied', () => {
  const p = exam.normaliseParameters({
    task: {assessmentType: 'end_of_term_test', parameters: {assessmentType: 'end_of_term_test'}},
    standards: stdCtx,
  })
  // 25 MCQ × 1 + 10 short × 2 + 4 structured × 10 = 85
  assert(p.totalMarks === 85, `expected 85, got ${p.totalMarks}`)
})

test('parameters validate against examQuizParametersSchema (with assessmentType)', () => {
  const p = exam.normaliseParameters({
    task: {assessmentType: 'monthly_test', parameters: {assessmentType: 'monthly_test'}},
    standards: stdCtx,
  })
  const parsed = examQuizParametersSchema.parse(p)
  assert(parsed.assessmentType === 'monthly_test', 'parsed assessmentType')
})

console.log('\nStructured stub (CI / no-LLM fallback)')

const richReader = {
  grade: '7', subject: 'Mathematics', term: '1', topic: 'Fractions',
  subtopic: 'Adding fractions', lessonNumber: 2,
  competencies: ['Add and subtract fractions'],
  learningOutcomes: ['Add fractions with same denominator'],
  keyConcepts: ['numerator', 'denominator', 'common denominator'],
  citedExcerpts: [
    {text: 'Add fractions by finding the common denominator.', anchor: 'content'},
    {text: 'The numerator is on top.', anchor: 'outcomes'},
  ],
  curriculumDocumentPath: 'syllabi/g7-math.pdf',
  curriculumVersion: 'cbc-kb-2026-04-seed',
  sourceDocId: 'g7-math',
}

test('structured stub returns 3 sections with non-zero questions', () => {
  const params = exam.normaliseParameters({
    task: {assessmentType: 'end_of_term_test', parameters: {assessmentType: 'end_of_term_test'}},
    standards: stdCtx,
  })
  const stub = exam.buildStructuredStub({curriculumReader: richReader, parameters: params})
  assert(stub, 'stub must be non-null')
  assert(stub.sections.length === 3, '3 sections')
  assert(stub.sections[0].id === 'A', 'first section is A')
  assert(stub.sections[1].id === 'B', 'second section is B')
  assert(stub.sections[2].id === 'C', 'third section is C')
  assert(stub.sections.every((s) => s.questions.length > 0), 'every section non-empty')
})

test('structured stub answer key covers every question', () => {
  const params = exam.normaliseParameters({
    task: {assessmentType: 'topic_test', parameters: {assessmentType: 'topic_test'}},
    standards: stdCtx,
  })
  const stub = exam.buildStructuredStub({curriculumReader: richReader, parameters: params})
  const totalQuestions = stub.sections.reduce((acc, s) => acc + s.questions.length, 0)
  assert(stub.answerKey.length === totalQuestions,
    `answerKey ${stub.answerKey.length} should equal total questions ${totalQuestions}`)
})

test('structured stub returns null when no excerpts', () => {
  const params = exam.normaliseParameters({
    task: {assessmentType: 'topic_test', parameters: {assessmentType: 'topic_test'}},
    standards: stdCtx,
  })
  const stub = exam.buildStructuredStub({
    curriculumReader: {...richReader, citedExcerpts: []},
    parameters: params,
  })
  assert(stub === null, 'must refuse when no excerpts')
})

test('Section C structured items have ≥2 parts', () => {
  const params = exam.normaliseParameters({
    task: {assessmentType: 'composite_exam', parameters: {assessmentType: 'composite_exam'}},
    standards: stdCtx,
  })
  const stub = exam.buildStructuredStub({curriculumReader: richReader, parameters: params})
  const c = stub.sections.find((s) => s.id === 'C')
  assert(c.questions.every((q) => Array.isArray(q.structuredParts) && q.structuredParts.length >= 2),
    'every Section C question must have ≥2 structuredParts')
})

console.log('\nQuestion filter (drops bad output)')

test('drops mcq with duplicate options', () => {
  const out = exam.filterValidQuestions([{
    prompt: 'q', questionType: 'mcq',
    options: ['a', 'a', 'c', 'd'], correctAnswer: 'a',
    groundingIndex: 0,
  }], 2)
  assert(out.length === 0, 'duplicate-option mcq must be dropped')
})

test('drops mcq with correctAnswer not in options', () => {
  const out = exam.filterValidQuestions([{
    prompt: 'q', questionType: 'mcq',
    options: ['a', 'b', 'c', 'd'], correctAnswer: 'z',
    groundingIndex: 0,
  }], 2)
  assert(out.length === 0, 'mcq with bad correctAnswer dropped')
})

test('drops short_answer with empty correctAnswer', () => {
  const out = exam.filterValidQuestions([{
    prompt: 'q', questionType: 'short_answer',
    options: [], correctAnswer: '',
    groundingIndex: 0,
  }], 2)
  assert(out.length === 0, 'short_answer with empty answer dropped')
})

test('drops structured with <2 parts', () => {
  const out = exam.filterValidQuestions([{
    prompt: 'q', questionType: 'structured',
    options: [], correctAnswer: '',
    structuredParts: [{label: 'a', prompt: 'x', expectedAnswer: 'y', marks: 1}],
    groundingIndex: 0,
  }], 2)
  assert(out.length === 0, 'structured with 1 part dropped')
})

test('drops structured with empty part prompt or expectedAnswer', () => {
  const out = exam.filterValidQuestions([{
    prompt: 'q', questionType: 'structured',
    options: [], correctAnswer: '',
    structuredParts: [
      {label: 'a', prompt: 'x', expectedAnswer: '', marks: 1},
      {label: 'b', prompt: 'y', expectedAnswer: 'z', marks: 1},
    ],
    groundingIndex: 0,
  }], 2)
  assert(out.length === 0, 'structured with empty part field dropped')
})

test('keeps valid structured with 2+ complete parts', () => {
  const out = exam.filterValidQuestions([{
    prompt: 'q', questionType: 'structured',
    options: [], correctAnswer: '',
    structuredParts: [
      {label: 'a', prompt: 'x', expectedAnswer: 'y', marks: 2},
      {label: 'b', prompt: 'z', expectedAnswer: 'w', marks: 3},
    ],
    groundingIndex: 0,
  }], 2)
  assert(out.length === 1, 'valid structured must be kept')
})

console.log('\nEnd-to-end: structured stub passes examQuizContentSchema validation')

test('stub output assembles into a valid ExamQuizContent doc', () => {
  const params = exam.normaliseParameters({
    task: {assessmentType: 'topic_test', parameters: {assessmentType: 'topic_test'}},
    standards: stdCtx,
  })
  const stub = exam.buildStructuredStub({curriculumReader: richReader, parameters: params})
  const assembledSections = stub.sections.map((sec) => {
    const stamped = sec.questions.map((q) => exam.stampQuestion(q, richReader, sec.id))
    // strip _sectionId helper field
    const cleaned = stamped.map(({_sectionId, ...rest}) => { void _sectionId; return rest })
    return {...sec, questions: cleaned}
  })
  const totalMarks = assembledSections.reduce((acc, sec) => acc + sec.marks, 0)
  const content = {
    header: {
      schoolName: '', grade: '7', term: '1', year: 2026,
      subject: 'Mathematics', paperName: stdCtx.structure.paperName,
      learnerNameLabel: 'Learner name:', dateLabel: 'Date:', timeLabel: 'Time:',
      totalMarks, timeAllowed: stdCtx.structure.timeLimit,
      instructions: stdCtx.structure.instructions.slice(0, 6),
    },
    sections: assembledSections,
    answerKey: stub.answerKey,
    markingGuide: stub.markingGuide,
    modelUsed: 'stub',
    parametersUsed: params,
    standardsUsed: {source: 'default', assessmentType: 'topic_test',
      standardId: null, sourceReference: ''},
  }
  const parsed = examQuizContentSchema.parse(content)
  assert(parsed.sections.length === 3, 'parsed sections')
  assert(parsed.answerKey.length >= 1, 'parsed answer key')
})

console.log('\nHard rule: exam quizzes never auto-publish')

test('dispatcher shouldAutoPublish refuses any task that is not practice_quiz', () => {
  // Source-level inspection: the gate at functions/agents/learnerAi/dispatcher.js
  // explicitly pins to practice_quiz. If anyone ever broadens it, this test
  // fires.
  assert(/taskType !== "practice_quiz"/.test(DISPATCHER_TEXT) ||
    /taskType\s*!==\s*'practice_quiz'/.test(DISPATCHER_TEXT),
    'shouldAutoPublish must pin to practice_quiz (exam_quiz must never auto-publish)')
})

test('dispatcher carries chainContext.standards forward', () => {
  assert(DISPATCHER_TEXT.includes('chainContext.standards'),
    'dispatcher must stash result.standards onto chainContext')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
