#!/usr/bin/env node
/**
 * Practice Quiz Generator — unit test.
 *
 * Exercises the pure helpers + structured-stub fallback + Zod
 * validation against practiceQuizContentSchema. Does NOT call
 * Anthropic — covered by the same module's `runLive` LLM path which
 * is gated on ANTHROPIC_API_KEY at runtime.
 *
 * Run: npm run test:practice-quiz  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNNER_PATH = join(__dirname, '..', 'functions', 'agents', 'learnerAi', 'runners', 'practiceQuiz.js')

// Stub admin + logger so the runner module loads in plain Node.
const fakeAdmin = {
  firestore: () => ({collection: () => ({add: async () => ({id: 'fake'})})}),
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

const runner = await import(RUNNER_PATH)
const { practiceQuizContentSchema, practiceQuizParametersSchema } =
  await import('../src/schemas/learnerAi.js')
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

console.log('\nPractice Quiz parameter normalisation')

test('empty params → defaults', () => {
  const n = runner.normaliseParameters({})
  assert(n.numQuestions === 10, 'default numQuestions')
  assert(n.difficulty === 'mixed', 'default difficulty')
  assert(n.mode === 'topic', 'default mode')
  assert(n.allowedQuestionTypes.length === 4, 'all 4 question types by default')
})

test('numQuestions clamped to [1, 50]', () => {
  assert(runner.normaliseParameters({parameters: {numQuestions: 999}}).numQuestions === 50)
  assert(runner.normaliseParameters({parameters: {numQuestions: 0}}).numQuestions === 1)
  assert(runner.normaliseParameters({parameters: {numQuestions: -5}}).numQuestions === 1)
})

test('bogus difficulty falls back to default', () => {
  assert(runner.normaliseParameters({parameters: {difficulty: 'extreme'}}).difficulty === 'mixed')
})

test('bogus mode falls back to default', () => {
  assert(runner.normaliseParameters({parameters: {mode: 'nonsense'}}).mode === 'topic')
})

test('lessonNumber pulled from task when not on params', () => {
  const n = runner.normaliseParameters({lessonNumber: 4, parameters: {mode: 'lesson'}})
  assert(n.lessonNumber === 4, `expected lessonNumber=4, got ${n.lessonNumber}`)
})

test('Zod parameters schema accepts normalised output', () => {
  const n = runner.normaliseParameters({})
  const parsed = practiceQuizParametersSchema.parse(n)
  assert(parsed.numQuestions === 10, 'parsed numQuestions')
})

console.log('\nStructured stub (CI / no-LLM fallback)')

const richReader = {
  grade: '7', subject: 'Mathematics', term: '1', topic: 'Fractions',
  subtopic: 'Adding fractions', lessonNumber: 2,
  competencies: ['Add and subtract fractions'],
  learningOutcomes: ['Add fractions with same denominator'],
  keyConcepts: ['numerator', 'denominator', 'common denominator'],
  suggestedContent: ['Fraction strips'],
  citedExcerpts: [
    {text: 'Add fractions by finding the common denominator.', anchor: 'content'},
    {text: 'The numerator is on top, the denominator is on the bottom.', anchor: 'outcomes'},
  ],
  curriculumDocumentPath: 'syllabi/g7-math.pdf',
  curriculumVersion: 'cbc-kb-2026-04-seed',
  sourceDocId: 'g7-math',
}

test('structured stub generates one question per (concept × type) up to numQuestions', () => {
  const stub = runner.buildStructuredStub({
    task: {id: 't1'}, curriculumReader: richReader,
    parameters: runner.normaliseParameters({parameters: {numQuestions: 4}}),
  })
  assert(stub.questions.length >= 1, 'at least one question generated')
  assert(stub.questions.length <= 4, 'cap respected')
})

test('structured stub covers all four question types when allowed', () => {
  const stub = runner.buildStructuredStub({
    task: {id: 't1'}, curriculumReader: richReader,
    parameters: runner.normaliseParameters({parameters: {numQuestions: 8}}),
  })
  const types = new Set(stub.questions.map((q) => q.questionType))
  assert(types.has('mcq'), 'mcq missing from stub')
  assert(types.has('true_false'), 'true_false missing from stub')
  assert(types.has('short_answer'), 'short_answer missing from stub')
  assert(types.has('matching'), 'matching missing from stub')
})

test('structured stub respects allowedQuestionTypes filter', () => {
  const stub = runner.buildStructuredStub({
    task: {id: 't1'}, curriculumReader: richReader,
    parameters: runner.normaliseParameters({
      parameters: {numQuestions: 4, allowedQuestionTypes: ['mcq']},
    }),
  })
  const types = new Set(stub.questions.map((q) => q.questionType))
  assert(types.size === 1 && types.has('mcq'),
    `expected only mcq, got ${[...types].join(',')}`)
})

test('structured stub returns no questions when no excerpts', () => {
  const stub = runner.buildStructuredStub({
    task: {id: 't1'},
    curriculumReader: {...richReader, citedExcerpts: []},
    parameters: runner.normaliseParameters({parameters: {numQuestions: 4}}),
  })
  assert(stub.questions.length === 0, 'must refuse when no excerpts')
})

console.log('\nCurriculum stamping')

test('stampCurriculumOnQuestion stamps grade/subject/topic/competency', () => {
  const stamped = runner.stampCurriculumOnQuestion({
    questionText: 'q', questionType: 'mcq', options: ['a', 'b', 'c', 'd'],
    correctAnswer: 'a', explanation: 'x', difficulty: 'easy', marks: 1,
    groundingIndex: 0,
  }, richReader)
  assert(stamped.grade === '7', 'grade stamped')
  assert(stamped.subject === 'Mathematics', 'subject stamped')
  assert(stamped.topic === 'Fractions', 'topic stamped')
  assert(stamped.competency === 'Add and subtract fractions', 'competency stamped')
  assert(stamped.learningOutcome === 'Add fractions with same denominator', 'learningOutcome stamped')
})

console.log('\nQuestion filter (drops bad output)')

test('drops mcq with duplicate options', () => {
  const out = runner.filterValidQuestions([
    {
      questionText: 'q', questionType: 'mcq',
      options: ['a', 'a', 'c', 'd'], correctAnswer: 'a',
      groundingIndex: 0,
    },
  ], 2)
  assert(out.length === 0, 'duplicate-option mcq must be dropped')
})

test('drops mcq with correctAnswer not in options', () => {
  const out = runner.filterValidQuestions([
    {
      questionText: 'q', questionType: 'mcq',
      options: ['a', 'b', 'c', 'd'], correctAnswer: 'z',
      groundingIndex: 0,
    },
  ], 2)
  assert(out.length === 0, 'mcq with bad correctAnswer must be dropped')
})

test('drops question with out-of-range groundingIndex', () => {
  const out = runner.filterValidQuestions([
    {
      questionText: 'q', questionType: 'mcq',
      options: ['a', 'b', 'c', 'd'], correctAnswer: 'a',
      groundingIndex: 9,
    },
  ], 2)
  assert(out.length === 0, 'oor groundingIndex must be dropped')
})

test('drops true_false with non-True/False correctAnswer', () => {
  const out = runner.filterValidQuestions([
    {
      questionText: 'q', questionType: 'true_false',
      options: ['True', 'False'], correctAnswer: 'maybe',
      groundingIndex: 0,
    },
  ], 2)
  assert(out.length === 0, 'invalid t/f answer must be dropped')
})

test('drops matching with <2 pairs', () => {
  const out = runner.filterValidQuestions([
    {
      questionText: 'q', questionType: 'matching',
      options: [], correctAnswer: '',
      matchingPairs: [{left: 'a', right: 'b'}],
      groundingIndex: 0,
    },
  ], 2)
  assert(out.length === 0, 'matching with 1 pair must be dropped')
})

test('keeps valid mcq', () => {
  const out = runner.filterValidQuestions([
    {
      questionText: 'q', questionType: 'mcq',
      options: ['a', 'b', 'c', 'd'], correctAnswer: 'a',
      groundingIndex: 0,
    },
  ], 2)
  assert(out.length === 1, 'valid mcq must be kept')
})

console.log('\nEnd-to-end: structured stub → stamping → Zod content validation')

test('stub output passes practiceQuizContentSchema validation after stamping + filtering', () => {
  const parameters = runner.normaliseParameters({parameters: {numQuestions: 6}})
  const stub = runner.buildStructuredStub({
    task: {id: 't1'}, curriculumReader: richReader, parameters,
  })
  const stamped = stub.questions.map((q) => runner.stampCurriculumOnQuestion(q, richReader))
  const valid = runner.filterValidQuestions(stamped, richReader.citedExcerpts.length)
  const content = {
    title: 'Adding Fractions Practice',
    description: 'Auto-generated practice quiz.',
    mode: parameters.mode,
    difficulty: parameters.difficulty,
    totalMarks: valid.reduce((acc, q) => acc + q.marks, 0),
    estimatedMinutes: Math.round(valid.length * 1.5),
    questions: valid,
    modelUsed: 'stub',
    parametersUsed: parameters,
  }
  const parsed = practiceQuizContentSchema.parse(content)
  assert(parsed.questions.length >= 1, 'parsed questions non-empty')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
