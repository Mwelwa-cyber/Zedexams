// Tests for the phantom-paper detector
// (src/features/assessmentStudio/lib/phantomAssessment.js) that
// scripts/cleanup-phantom-assessments.mjs deletes on.
//
// A phantom is a paper the studio filed on its own: one blank question, the
// generated title, no marks, nothing a teacher put there. Two failure modes are
// being guarded against, and they pull in opposite directions:
//
//   • recognising too little — the stored text of a blank question is not always
//     the empty string (it can be a STRINGIFIED empty Tiptap document), so a
//     careless check finds nothing and looks like a clean library;
//   • recognising too much — deleting a teacher's paper. Every check is a reason
//     to KEEP, and anything unrecognised keeps the paper.

import assert from 'node:assert/strict'
import {
  storedRichTextEmpty,
  storedQuestionIsBlank,
  inspectAssessmentForPhantom,
  planPhantomCleanup,
} from '../src/features/assessmentStudio/lib/phantomAssessment.js'
import { createStandaloneSection, serializeQuizSections } from '../src/utils/quizSections.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// The paper doc the studio wrote for a visit in which the teacher did nothing:
// defaults, School-Profile branding, the generated title, one blank question.
const phantomPaper = () => ({
  title: 'GRADE 4 END OF TERM 1 TEST - 2026',
  subject: 'Integrated Science',
  grade: '4',
  term: '1',
  year: 2026,
  duration: 90,
  assessmentType: 'end_of_term',
  // Seeded from the teacher's School Profile — present on a paper nobody
  // touched, which is exactly why none of it counts as evidence of authoring.
  schoolName: 'Kabulonga Primary School',
  motto: 'Knowledge is power',
  address: 'Lusaka',
  emisNumber: '123456',
  coverInstructions: 'Answer ALL questions.',
  topic: '',
  className: '',
  paperName: '',
  assessmentDate: '',
  questionCount: 1,
  totalMarks: 1,
  passages: [],
  parts: [],
  pagebreaks: [],
  mode: '',
})

// The real serialised shape of the studio's blank starter question.
const blankStarterQuestion = () =>
  serializeQuizSections([createStandaloneSection()], []).questions[0]

console.log('storedRichTextEmpty')

test('recognises every shape an empty stored field arrives in', () => {
  for (const value of [
    '', '   ', null, undefined, '<p></p>', '<p>&nbsp;</p>', '<p><br></p>',
    '{"type":"doc","content":[{"type":"paragraph"}]}',
    '{"type":"doc","content":[]}',
    { type: 'doc', content: [{ type: 'paragraph' }] },
  ]) {
    assert.equal(storedRichTextEmpty(value), true, `expected empty: ${JSON.stringify(value)}`)
  }
})

test('THE TRAP: a stringified Tiptap document WITH text is not empty', () => {
  assert.equal(
    storedRichTextEmpty('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Name two mammals."}]}]}'),
    false,
  )
  assert.equal(storedRichTextEmpty('<p>Name two mammals.</p>'), false)
  assert.equal(storedRichTextEmpty('Name two mammals.'), false)
})

test('a figure with no words is content', () => {
  assert.equal(
    storedRichTextEmpty({ type: 'doc', content: [{ type: 'verticalArithmetic', attrs: {} }] }),
    false,
  )
})

console.log('storedQuestionIsBlank')

test("the studio's own blank starter question reads as blank", () => {
  assert.equal(storedQuestionIsBlank(blankStarterQuestion()), true)
})

test('anything a teacher could have done keeps the question', () => {
  const cases = {
    text: '<p>Name two mammals.</p>',
    sharedInstruction: 'Answer in full sentences.',
    explanation: 'Any two of: dog, cat, cow.',
    topic: 'Animals',
    diagramText: 'a labelled heart',
    imageUrl: 'https://example.com/figure.png',
    marks: 5,
    correctAnswer: 2,
    teacherEdited: true,
    locked: true,
    options: ['Lion', '', '', ''],
    statements: [{ text: 'The ___ pumps blood.' }],
    subParts: [{ text: '(a)' }],
    imageDiagram: { libraryKey: 'heart' },
  }
  for (const [key, value] of Object.entries(cases)) {
    assert.equal(
      storedQuestionIsBlank({ ...blankStarterQuestion(), [key]: value }),
      false,
      `a question with ${key} set must not read as blank`,
    )
  }
})

console.log('inspectAssessmentForPhantom')

test('THE PHANTOM: one blank question, generated title, no marks → delete', () => {
  const verdict = inspectAssessmentForPhantom({
    assessment: phantomPaper(),
    questions: [blankStarterQuestion()],
  })
  assert.equal(verdict.phantom, true, JSON.stringify(verdict.keptBecause))
  assert.deepEqual(verdict.keptBecause, [])
  assert.ok(verdict.evidence.length >= 2)
})

test('THE PHANTOM: with a title carrying the wrong default term → still deleted', () => {
  // A Term 2 phantom whose title says TERM 1 (Bug 2's misreported term).
  const verdict = inspectAssessmentForPhantom({
    assessment: { ...phantomPaper(), term: '2' },
    questions: [blankStarterQuestion()],
  })
  assert.equal(verdict.phantom, true, JSON.stringify(verdict.keptBecause))
})

test('a phantom with no question docs at all → delete', () => {
  const verdict = inspectAssessmentForPhantom({
    assessment: { ...phantomPaper(), questionCount: 0, totalMarks: 0 },
    questions: [],
  })
  assert.equal(verdict.phantom, true, JSON.stringify(verdict.keptBecause))
})

test("a teacher's paper is kept, and the reason is named", () => {
  const kept = [
    ['its question has content', { questions: [{ ...blankStarterQuestion(), text: '<p>Name two mammals.</p>' }] }],
    ['2 questions', { questions: [blankStarterQuestion(), blankStarterQuestion()] }],
    ['topic is set', { assessment: { ...phantomPaper(), topic: 'Animals' } }],
    ['className is set', { assessment: { ...phantomPaper(), className: '4B' } }],
    ['paperName is set', { assessment: { ...phantomPaper(), paperName: 'Paper 1' } }],
    ['questionCount 12', { assessment: { ...phantomPaper(), questionCount: 12 } }],
    ['totalMarks 40', { assessment: { ...phantomPaper(), totalMarks: 40 } }],
    ['has a passage', { assessment: { ...phantomPaper(), passageCount: 1 } }],
    ['has parts', { assessment: { ...phantomPaper(), parts: [{ id: 'A' }] } }],
    ['was generated against a blueprint', { assessment: { ...phantomPaper(), blueprint: { version: 'blueprint.v1' } } }],
    ['came from an import', { assessment: { ...phantomPaper(), sourceFileName: 'scan.pdf' } }],
    ['the teacher named it', { assessment: { ...phantomPaper(), titleSource: 'manual' } }],
    ['its title is not one we generated', { assessment: { ...phantomPaper(), title: 'Revision for Mrs Banda' } }],
  ]
  for (const [reason, overrides] of kept) {
    const verdict = inspectAssessmentForPhantom({
      assessment: phantomPaper(),
      questions: [blankStarterQuestion()],
      ...overrides,
    })
    assert.equal(verdict.phantom, false, `expected kept: ${reason}`)
    assert.ok(
      verdict.keptBecause.includes(reason),
      `expected reason "${reason}", got ${JSON.stringify(verdict.keptBecause)}`,
    )
  }
})

test('a paper claiming more questions than it holds is kept, not deleted', () => {
  // A failed/partial read of the questions subcollection must never be mistaken
  // for an empty paper — the paper itself is intact.
  const verdict = inspectAssessmentForPhantom({
    assessment: { ...phantomPaper(), questionCount: 30, totalMarks: 40 },
    questions: [],
  })
  assert.equal(verdict.phantom, false)
})

console.log('planPhantomCleanup')

test('splits a mixed library into remove / keep', () => {
  const { remove, keep } = planPhantomCleanup([
    { id: 'phantom-1', assessment: phantomPaper(), questions: [blankStarterQuestion()] },
    { id: 'phantom-2', assessment: phantomPaper(), questions: [] },
    {
      id: 'real-1',
      assessment: { ...phantomPaper(), questionCount: 20, totalMarks: 40 },
      questions: [{ ...blankStarterQuestion(), text: '<p>Q1</p>' }],
    },
  ])
  assert.deepEqual(remove.map(r => r.id), ['phantom-1', 'phantom-2'])
  assert.deepEqual(keep.map(r => r.id), ['real-1'])
})

console.log(`\n${passed} assertions passed.`)
