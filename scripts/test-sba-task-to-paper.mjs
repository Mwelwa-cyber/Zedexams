/**
 * Unit tests for src/shared/utils/sbaTaskToPaper.js — the adapter that turns a
 * generated SBA task into printable-paper layout blocks.
 *
 * Plain `node` assertions (no test framework), in the repo's *.mjs style.
 * Run with `npm run test:sba-paper` or directly: `node scripts/test-sba-task-to-paper.mjs`.
 */

import assert from 'node:assert/strict'
import { buildSbaPaperBlocks } from '../src/shared/utils/sbaTaskToPaper.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const baseTask = {
  header: {
    title: 'Reading Comprehension: The Lost Goat',
    subject: 'english',
    grade: 'G5',
    taskType: 'reading_comprehension',
    skill: 'Reading',
    term: 'Term 1',
    duration: '40 minutes',
    totalMarks: 10,
    bloomLevels: ['Comprehension'],
    outcomeRefs: ['5.1.1'],
  },
  instructions: 'Read the passage and answer all the questions.',
  stimulus: 'Once upon a time there was a goat...',
  questions: [
    { number: 1, prompt: 'Where did the goat live?', marks: 2, answer: 'On a farm', markAllocation: [{ description: 'farm', marks: 2 }] },
    { number: 2, prompt: 'Write a short paragraph about the goat.', marks: 10, answer: 'Model paragraph...', markAllocation: [] },
  ],
  markingScheme: { style: 'answer_key', notes: 'Award full marks for relevance.', criteria: [] },
}

function kinds(blocks) {
  return blocks.map((b) => b.kind)
}
function byKind(blocks, kind) {
  return blocks.find((b) => b.kind === kind)
}

console.log('sbaTaskToPaper')

test('emits the school-paper block sequence', () => {
  const blocks = buildSbaPaperBlocks(baseTask, { year: 2026 })
  const k = kinds(blocks)
  assert.equal(k[0], 'header')
  assert.equal(k[1], 'learnerFields')
  assert.equal(k[2], 'instructions')
  assert.equal(k[3], 'passage')
  assert.equal(k[k.length - 2], 'endOfPaper')
  assert.equal(k[k.length - 1], 'footerCode')
})

test('header carries SBA title, subject label and task name', () => {
  const h = byKind(buildSbaPaperBlocks(baseTask, { year: 2026 }), 'header')
  assert.match(h.title, /GRADE FIVE/)
  assert.match(h.title, /TERM 1/)
  assert.match(h.title, /SCHOOL BASED ASSESSMENT - 2026/)
  assert.equal(h.subject, 'ENGLISH LANGUAGE')
  assert.equal(h.paperName, 'READING COMPREHENSION: THE LOST GOAT')
})

test('subject resolves from value OR label, falls back to raw', () => {
  assert.equal(byKind(buildSbaPaperBlocks({ header: { subject: 'mathematics', grade: 'G6' } }), 'header').subject, 'MATHEMATICS')
  assert.equal(byKind(buildSbaPaperBlocks({ header: { subject: 'Integrated Science', grade: 'G6' } }), 'header').subject, 'INTEGRATED SCIENCE')
  assert.equal(byKind(buildSbaPaperBlocks({ header: { subject: 'Improvised Drumming', grade: 'G6' } }), 'header').subject, 'IMPROVISED DRUMMING')
})

test('learner fields show total marks', () => {
  const lf = byKind(buildSbaPaperBlocks(baseTask), 'learnerFields')
  assert.equal(lf.marks, true)
  assert.equal(lf.totalMarks, 10)
})

test('instructions prepend the time-allowed line', () => {
  const instr = byKind(buildSbaPaperBlocks(baseTask), 'instructions')
  assert.match(instr.text, /Time allowed: 40 minutes\./)
  assert.match(instr.text, /Read the passage/)
  assert.equal(instr.isMarkingKey, false)
})

test('instructions fall back to a sensible default when none given', () => {
  const instr = byKind(buildSbaPaperBlocks({ header: { grade: 'G5' } }), 'instructions')
  assert.match(instr.text, /Answer all the tasks/)
})

test('questions become ruled-answer blocks and never leak answers', () => {
  const blocks = buildSbaPaperBlocks(baseTask)
  const qs = blocks.filter((b) => b.kind === 'question')
  assert.equal(qs.length, 2)
  // short answer (2 marks) vs essay (10 marks)
  assert.equal(qs[0].type, 'short_answer')
  assert.equal(qs[1].type, 'essay')
  assert.ok(qs[0].answerLines >= 2)
  assert.ok(qs[1].answerLines >= 8)
  // no model answer is carried onto the paper
  qs.forEach((q) => {
    assert.equal(q.showAnswer, false)
    assert.ok(!('answer' in q))
  })
})

test('blank-prompt tasks are skipped', () => {
  const blocks = buildSbaPaperBlocks({
    header: { grade: 'G5', subject: 'english' },
    questions: [{ number: 1, prompt: '   ', marks: 2 }],
  })
  assert.equal(blocks.filter((b) => b.kind === 'question').length, 0)
})

test('no stimulus → no passage block', () => {
  const blocks = buildSbaPaperBlocks({ header: { grade: 'G5', subject: 'english' }, stimulus: '' })
  assert.equal(blocks.some((b) => b.kind === 'passage'), false)
})

test('footer code reads G<grade>/<subject>/<term>/<year>', () => {
  const f = byKind(buildSbaPaperBlocks(baseTask, { year: 2026 }), 'footerCode')
  assert.equal(f.code, 'G5/English Language/Term 1/2026')
})

test('school name is blank by default (renderer supplies the placeholder)', () => {
  const h = byKind(buildSbaPaperBlocks(baseTask), 'header')
  assert.equal(h.schoolName, '')
  const h2 = byKind(buildSbaPaperBlocks(baseTask, { schoolName: 'Jemareen Academy' }), 'header')
  assert.equal(h2.schoolName, 'Jemareen Academy')
})

console.log(`\n${passed} tests passed.`)
