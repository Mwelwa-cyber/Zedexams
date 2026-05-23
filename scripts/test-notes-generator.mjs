#!/usr/bin/env node
/**
 * Notes Generator Agent — unit tests.
 *
 * Covers:
 *   - Parameter normalisation (detail level / diagrams / counts)
 *   - Per-grade body word caps (notes_length axis alignment)
 *   - buildBody concatenation produces a flat text the Quality Check
 *     v3 notes_simple + notes_length + notes_match_topic axes can read
 *   - trimBodyToWords enforces the cap
 *   - Structured stub produces every user-required section
 *   - End-to-end Zod validation against notesContentSchema
 *   - Auto-publish allow-list now covers notes via autoPublishNotes
 *
 * Run: npm run test:notes  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RUNNER = join(ROOT, 'functions/agents/learnerAi/runners/notes.js')
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

const notes = await import(RUNNER)
const { notesContentSchema, notesParametersSchema } =
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
  grade: '7', subject: 'Mathematics', term: '1', topic: 'Fractions',
  subtopic: 'Adding fractions', lessonNumber: 2,
  competencies: ['Add and subtract fractions'],
  learningOutcomes: ['Add fractions with same denominator'],
  keyConcepts: ['numerator', 'denominator', 'common denominator'],
  suggestedContent: ['Fraction strips'],
  citedExcerpts: [
    {text: 'Add fractions by finding the common denominator.', anchor: 'content'},
    {text: 'The numerator is on top.', anchor: 'outcomes'},
  ],
  curriculumDocumentPath: 'syllabi/g7-math.pdf',
  curriculumVersion: 'cbc-kb-2026-04-seed',
  sourceDocId: 'g7-math',
}

console.log('\nParameter normalisation')

test('defaults when params absent', () => {
  const p = notes.normaliseParameters({})
  assert(p.detailLevel === 'standard')
  assert(p.includeDiagrams === true)
  assert(p.numExamples === 3)
  assert(p.numKeyVocabulary === 5)
})
test('clamps numExamples to [1, 8]', () => {
  assert(notes.normaliseParameters({parameters: {numExamples: 999}}).numExamples === 8)
  assert(notes.normaliseParameters({parameters: {numExamples: 0}}).numExamples === 1)
})
test('clamps numKeyVocabulary to [1, 15]', () => {
  assert(notes.normaliseParameters({parameters: {numKeyVocabulary: 999}}).numKeyVocabulary === 15)
})
test('rejects bogus detailLevel', () => {
  assert(notes.normaliseParameters({parameters: {detailLevel: 'enormous'}}).detailLevel === 'standard')
})
test('includeDiagrams=false respected', () => {
  assert(notes.normaliseParameters({parameters: {includeDiagrams: false}}).includeDiagrams === false)
})
test('parameters validate against notesParametersSchema', () => {
  const p = notes.normaliseParameters({})
  const parsed = notesParametersSchema.parse(p)
  assert(parsed.detailLevel === 'standard')
})

console.log('\nPer-grade body word cap')

test('lower-primary (G1-G4) → 300', () => {
  assert(notes.bodyWordCapForGrade('1') === 300)
  assert(notes.bodyWordCapForGrade('4') === 300)
})
test('upper-primary (G5-G7) → 600', () => {
  assert(notes.bodyWordCapForGrade('5') === 600)
  assert(notes.bodyWordCapForGrade('7') === 600)
})
test('secondary (G8-G12) → 1200', () => {
  assert(notes.bodyWordCapForGrade('8') === 1200)
  assert(notes.bodyWordCapForGrade('12') === 1200)
})

console.log('\nBody builder')

test('buildBody concatenates every section that is non-empty', () => {
  const body = notes.buildBody({
    title: 'Title', shortExplanation: 'Intro.',
    keyVocabulary: [{term: 'V1', definition: 'D1'}],
    importantFacts: ['Fact 1'],
    examples: [{title: 'Ex1', explanation: 'Explanation 1.'}],
    summary: 'Summary text.',
    rememberThis: ['Remember 1'],
    quickRevision: ['Bullet 1'],
  })
  for (const s of ['Title', 'Intro', 'V1', 'D1', 'Fact 1', 'Ex1', 'Explanation 1',
    'Summary text', 'Remember 1', 'Bullet 1']) {
    assert(body.includes(s), `body missing "${s}"`)
  }
})
test('trimBodyToWords enforces cap', () => {
  const longBody = 'word '.repeat(1000)
  const trimmed = notes.trimBodyToWords(longBody, 50)
  const w = trimmed.split(/\s+/).filter(Boolean).length
  assert(w <= 51, `trimmed should be ≤51 words, got ${w}`)
})

console.log('\nStructured stub')

test('stub returns every required section non-empty', () => {
  const stub = notes.buildStructuredStub({
    curriculumReader: reader, parameters: notes.normaliseParameters({}),
  })
  assert(stub.title && stub.title.length > 0)
  assert(stub.shortExplanation && stub.shortExplanation.length > 0)
  assert(stub.keyVocabulary.length >= 1)
  assert(stub.importantFacts.length >= 1)
  assert(stub.examples.length >= 1)
  assert(stub.summary && stub.summary.length > 0)
  assert(stub.rememberThis.length >= 1)
  assert(stub.diagramSuggestions.length >= 1)
  assert(stub.quickRevision.length >= 1)
  assert(Number.isInteger(stub.estimatedReadingMinutes) && stub.estimatedReadingMinutes >= 1)
})

test('stub respects includeDiagrams:false', () => {
  const stub = notes.buildStructuredStub({
    curriculumReader: reader,
    parameters: {detailLevel: 'standard', includeDiagrams: false, numExamples: 3, numKeyVocabulary: 5},
  })
  assert(stub.diagramSuggestions.length === 0, 'no diagram suggestions when flag off')
})

test('stub returns null when no excerpts', () => {
  const stub = notes.buildStructuredStub({
    curriculumReader: {...reader, citedExcerpts: []},
    parameters: notes.normaliseParameters({}),
  })
  assert(stub === null, 'must refuse when no excerpts')
})

console.log('\nEnd-to-end Zod validation')

test('stub-derived notes content passes notesContentSchema', () => {
  const parameters = notes.normaliseParameters({})
  const stub = notes.buildStructuredStub({curriculumReader: reader, parameters})
  const body = notes.trimBodyToWords(
      notes.buildBody(stub),
      notes.bodyWordCapForGrade(reader.grade),
  )
  const content = {
    title: stub.title,
    shortExplanation: stub.shortExplanation,
    keyVocabulary: stub.keyVocabulary,
    importantFacts: stub.importantFacts,
    examples: stub.examples,
    summary: stub.summary,
    rememberThis: stub.rememberThis,
    diagramSuggestions: stub.diagramSuggestions,
    quickRevision: stub.quickRevision,
    body,
    grade: reader.grade, subject: reader.subject, term: reader.term,
    topic: reader.topic, subtopic: reader.subtopic,
    competency: reader.competencies[0],
    learningOutcome: reader.learningOutcomes[0],
    estimatedReadingMinutes: stub.estimatedReadingMinutes,
    modelUsed: 'stub', parametersUsed: parameters,
  }
  const parsed = notesContentSchema.parse(content)
  assert(parsed.title === stub.title)
  assert(parsed.body.length > 0)
})

console.log('\nDispatcher auto-publish allow-list')

test('dispatcher allow-list now includes notes', () => {
  assert(DISPATCHER_TEXT.includes('autoPublishNotes'),
    'dispatcher must read settings.autoPublishNotes for notes auto-publish')
})
test('dispatcher allow-list still allows practice_quiz', () => {
  assert(DISPATCHER_TEXT.includes('autoPublishPracticeQuizzes'),
    'practice_quiz auto-publish must remain wired')
})
test('dispatcher rejects unknown task types at auto-publish', () => {
  // Source-text guard: the dispatcher uses a settingKey lookup table
  // and bails when the task type isn't in it. We assert the table
  // exists by checking for its name.
  assert(DISPATCHER_TEXT.includes('AUTO_PUBLISH_SETTING_BY_TASK'),
    'dispatcher must use the per-type settingKey allow-list table')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
