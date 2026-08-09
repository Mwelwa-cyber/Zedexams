/**
 * Unit tests for src/engines/export-engine/sbaTaskToDocx.js — the SBA Word export now renders
 * the task sheet through the shared paper-layout block renderer, with the
 * marking scheme appended only on the teacher copy.
 *
 * Plain `node` assertions. Run: `npm run test:sba-docx` or
 * `node scripts/test-sba-task-docx.mjs`.
 */

import assert from 'node:assert/strict'
import { Document } from 'docx'
import { buildSbaTaskChildren, buildSbaTaskDocument } from '../src/engines/export-engine/sbaTaskToDocx.js'

let passed = 0
async function test(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const task = {
  header: {
    title: 'Reading Comprehension: The Lost Goat',
    subject: 'english',
    grade: 'G5',
    taskType: 'reading_comprehension',
    skill: 'Reading',
    term: 'Term 1',
    duration: '40 minutes',
    totalMarks: 12,
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

// A rubric-only task (oral/practical) with no written questions.
const rubricTask = {
  header: { title: 'Prepared Speech', subject: 'english', grade: 'G6', taskType: 'prepared_speech', skill: 'Listening & Speaking', totalMarks: 10 },
  instructions: 'Deliver a 2-minute prepared speech.',
  stimulus: '',
  questions: [],
  markingScheme: {
    style: 'oral_observation',
    notes: 'Observe each pupil.',
    criteria: [
      { name: 'Fluency', maxMarks: 5, descriptor: 'Speaks smoothly' },
      { name: 'Content', maxMarks: 5, descriptor: 'Stays on topic' },
    ],
  },
}

console.log('sbaTaskToDocx')

await test('learner copy is just the paper (no marking scheme appended)', async () => {
  const learner = await buildSbaTaskChildren(task, { includeAnswers: false })
  const teacher = await buildSbaTaskChildren(task, { includeAnswers: true })
  assert.ok(learner.length > 0, 'learner copy has content')
  assert.ok(teacher.length > learner.length, 'teacher copy adds the marking scheme')
})

await test('teacher copy appends a marking scheme for a rubric-only task', async () => {
  const learner = await buildSbaTaskChildren(rubricTask, { includeAnswers: false })
  const teacher = await buildSbaTaskChildren(rubricTask, { includeAnswers: true })
  assert.ok(teacher.length > learner.length)
})

await test('builds a valid docx Document (teacher + learner)', async () => {
  const teacherDoc = await buildSbaTaskDocument(task, { includeAnswers: true })
  const learnerDoc = await buildSbaTaskDocument(task, { includeAnswers: false })
  assert.ok(teacherDoc instanceof Document)
  assert.ok(learnerDoc instanceof Document)
})

await test('does not throw on a minimal task', async () => {
  const doc = await buildSbaTaskDocument({ header: { title: 'X', grade: 'G5', subject: 'mathematics' }, questions: [{ number: 1, prompt: 'Add 2 + 2', marks: 1 }] })
  assert.ok(doc instanceof Document)
})

console.log(`\n${passed} tests passed.`)
