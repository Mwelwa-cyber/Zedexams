#!/usr/bin/env node
/**
 * Adapter test for examQuizToAssessment.
 *
 * Round-trips a known stub through the adapter and asserts:
 *   - title composition
 *   - header → assessment field mapping
 *   - section flattening: section meta stamped on every question
 *   - structuredParts pass through
 *   - filename suggestion is sensible
 *
 * Run: npm run test:exam-quiz-to-assessment
 */

import { examQuizToAssessment, suggestExamQuizFilename } from '../src/utils/examQuizToAssessment.js'

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({name, message: err.message}); console.log(`  FAIL ${name}\n       ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

const fixture = {
  title: 'Grade 7 Mathematics — End-of-Term Examination',
  header: {
    schoolName: 'Test Sec School',
    grade: '7', term: '1', year: 2026,
    subject: 'Mathematics', paperName: 'Paper 1',
    learnerNameLabel: 'Learner name:', dateLabel: 'Date:', timeLabel: 'Time:',
    totalMarks: 50, timeAllowed: '1 hour 30 minutes',
    instructions: ['Answer ALL questions.', 'Show all working.'],
  },
  sections: [
    {id: 'A', title: 'Section A — Multiple Choice', instructions: 'Answer all 2.', marks: 10,
      questions: [
        {number: 1, questionType: 'mcq', prompt: 'What is 1/2 + 1/4?',
          options: ['1/4', '3/4', '1/6', '2/6'], correctAnswer: '3/4',
          marks: 5, difficulty: 'easy', bloomsLevel: 'apply',
          grade: '7', subject: 'Mathematics', topic: 'Fractions',
          subtopic: 'Adding fractions', competency: 'Add fractions',
          learningOutcome: 'Add fractions with same denominator'},
        {number: 2, questionType: 'mcq', prompt: 'Which of these is a prime number?',
          options: ['4', '6', '7', '8'], correctAnswer: '7',
          marks: 5, difficulty: 'easy', bloomsLevel: 'remember',
          grade: '7', subject: 'Mathematics', topic: 'Numbers',
          subtopic: 'Prime numbers', competency: 'Identify prime numbers',
          learningOutcome: 'Define a prime number'},
      ]},
    {id: 'C', title: 'Section C — Structured', instructions: 'Show all working.', marks: 10,
      questions: [
        {number: 1, questionType: 'structured', prompt: 'A learner from Lusaka...',
          options: [], correctAnswer: '',
          structuredParts: [
            {label: 'a', prompt: 'Define numerator.', marks: 2,
              expectedAnswer: 'The top part of a fraction.',
              markingPoints: ['Correct definition', 'Uses CBC vocabulary']},
            {label: 'b', prompt: 'Add 1/3 + 1/6.', marks: 3,
              expectedAnswer: '1/2',
              markingPoints: ['Common denominator', 'Correct answer']},
          ],
          marks: 10, difficulty: 'medium', bloomsLevel: 'analyze',
          grade: '7', subject: 'Mathematics', topic: 'Fractions',
          subtopic: 'Adding fractions', competency: 'Add fractions',
          learningOutcome: 'Add fractions with different denominators'},
      ]},
  ],
  answerKey: [
    {sectionId: 'A', questionNumber: 1, answer: 'B (3/4)', marks: 5, markingNotes: ''},
    {sectionId: 'A', questionNumber: 2, answer: 'C (7)', marks: 5, markingNotes: ''},
    {sectionId: 'C', questionNumber: 1, answer: 'See structured parts', marks: 10,
      markingNotes: 'Award by part'},
  ],
  markingGuide: 'Award full marks for the verbatim answer drawn from the syllabus.',
}

console.log('\nexamQuizToAssessment adapter')

test('produces a non-empty assessment header', () => {
  const out = examQuizToAssessment(fixture)
  assert(out.assessment.grade === '7')
  assert(out.assessment.subject === 'Mathematics')
  assert(out.assessment.term === '1')
  assert(out.assessment.year === 2026)
  assert(out.assessment.totalMarks === 50)
  assert(out.assessment.timeAllowed === '1 hour 30 minutes')
  assert(Array.isArray(out.assessment.instructions) && out.assessment.instructions.length === 2)
})

test('composes title from content when present', () => {
  const out = examQuizToAssessment(fixture)
  assert(out.assessment.title === 'Grade 7 Mathematics — End-of-Term Examination',
    `title wrong: ${out.assessment.title}`)
})

test('composes title from header when content.title missing', () => {
  const noTitle = {...fixture, title: undefined}
  const out = examQuizToAssessment(noTitle)
  assert(out.assessment.title.includes('Mathematics'))
  assert(out.assessment.title.includes('Grade 7'))
})

test('flattens sections[] into one questions[] list with stable numericId', () => {
  const out = examQuizToAssessment(fixture)
  assert(out.questions.length === 3, `expected 3 questions, got ${out.questions.length}`)
  assert(out.questions[0].numericId === 1)
  assert(out.questions[1].numericId === 2)
  assert(out.questions[2].numericId === 3)
})

test('stamps section meta on every flattened question', () => {
  const out = examQuizToAssessment(fixture)
  assert(out.questions[0].sectionId === 'A')
  assert(out.questions[0].sectionTitle === 'Section A — Multiple Choice')
  assert(out.questions[0].sectionMarks === 10)
  assert(out.questions[2].sectionId === 'C', `Section C question wrong: ${out.questions[2].sectionId}`)
})

test('preserves MCQ options + correctAnswer', () => {
  const out = examQuizToAssessment(fixture)
  const q1 = out.questions[0]
  assert(q1.questionType === 'mcq')
  assert(q1.options.length === 4)
  assert(q1.correctAnswer === '3/4')
})

test('preserves structuredParts for Section C items', () => {
  const out = examQuizToAssessment(fixture)
  const q3 = out.questions[2]
  assert(q3.questionType === 'structured')
  assert(q3.structuredParts.length === 2)
  assert(q3.structuredParts[0].label === 'a')
  assert(q3.structuredParts[0].marks === 2)
  assert(q3.structuredParts[0].markingPoints.length === 2)
})

test('preserves curriculum echo (topic / competency / learningOutcome)', () => {
  const out = examQuizToAssessment(fixture)
  for (const q of out.questions) {
    assert(q.grade === '7', `grade on q${q.numericId}: ${q.grade}`)
    assert(q.subject === 'Mathematics')
    assert(q.competency.length > 0)
  }
})

test('passes answerKey through with field normalisation', () => {
  const out = examQuizToAssessment(fixture)
  assert(out.answerKey.length === 3)
  assert(out.answerKey[0].sectionId === 'A')
  assert(out.answerKey[0].questionNumber === 1)
  assert(out.answerKey[0].marks === 5)
})

test('passes markingGuide through unchanged', () => {
  const out = examQuizToAssessment(fixture)
  assert(out.markingGuide.startsWith('Award full marks'))
})

test('survives missing fields (defensive defaults)', () => {
  const empty = examQuizToAssessment({})
  assert(empty.assessment.totalMarks === 0)
  assert(empty.questions.length === 0)
  assert(empty.answerKey.length === 0)
  assert(empty.markingGuide === '')
})

test('survives null content', () => {
  const empty = examQuizToAssessment(null)
  assert(empty.questions.length === 0)
})

console.log('\nsuggestExamQuizFilename')

test('builds filename from grade + subject + paper + date', () => {
  const name = suggestExamQuizFilename(fixture, 'docx')
  assert(name.endsWith('.docx'), `wrong extension: ${name}`)
  assert(name.includes('g7'), `missing grade: ${name}`)
  assert(name.includes('mathematics'), `missing subject: ${name}`)
  assert(name.includes('paper-1'), `missing paper: ${name}`)
})

test('strips special characters', () => {
  const weird = {header: {grade: '12', subject: 'Maths / Physics?', paperName: 'Final!'}}
  const name = suggestExamQuizFilename(weird, 'pdf')
  assert(!/[/?!]/.test(name), `must strip special chars: ${name}`)
  assert(name.endsWith('.pdf'))
})

test('falls back gracefully on empty content', () => {
  const name = suggestExamQuizFilename({}, 'docx')
  assert(name.endsWith('.docx'))
  assert(name.length > 5)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
