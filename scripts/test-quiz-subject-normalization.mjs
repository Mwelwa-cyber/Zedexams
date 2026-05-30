#!/usr/bin/env node
/* global console, process */
/**
 * Regression tests for the quiz subject slug -> display-label repair.
 *
 * Bug: the quiz editor / document importer could carry a curriculum *id*
 * slug (e.g. "mathematics", "social-studies") into the quiz `subject`
 * field instead of the canonical display label ("Mathematics", "Social
 * Studies"). normalizeSubject() repairs that, and the quiz write schema
 * applies it via z.preprocess so a stray slug never hard-fails the save.
 *
 * Run: npm run test:quiz-subject
 */
import assert from 'node:assert/strict'
import { normalizeSubject, SUBJECT_LABELS } from '../src/config/curriculum.js'
import { quizWriteSchema } from '../src/schemas/quiz.js'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}`)
    console.error(`       ${err.message}`)
    process.exitCode = 1
  }
}

const baseQuiz = (overrides = {}) => ({
  title: 'Sample Quiz',
  subject: 'Mathematics',
  grade: '7',
  createdBy: 'admin-uid',
  ...overrides,
})

// ── normalizeSubject ──────────────────────────────────────────────
console.log('\nnormalizeSubject')

check('slug "mathematics" -> "Mathematics"', () => {
  assert.equal(normalizeSubject('mathematics'), 'Mathematics')
})

check('multi-word slug "social-studies" -> "Social Studies"', () => {
  assert.equal(normalizeSubject('social-studies'), 'Social Studies')
})

check('curriculum id "science" -> "Integrated Science"', () => {
  assert.equal(normalizeSubject('science'), 'Integrated Science')
})

check('valid display label passes through unchanged', () => {
  assert.equal(normalizeSubject('Mathematics'), 'Mathematics')
  assert.equal(normalizeSubject('Integrated Science'), 'Integrated Science')
})

check('uppercased label / slug both resolve', () => {
  assert.equal(normalizeSubject('MATHEMATICS'), 'Mathematics')
})

check('value is trimmed', () => {
  assert.equal(normalizeSubject('  Mathematics  '), 'Mathematics')
})

check('unrecognised value is returned trimmed-but-unchanged', () => {
  // The helper must NOT swallow genuine garbage — strict validation
  // elsewhere should still be able to see/reject it.
  assert.equal(normalizeSubject('not-a-real-subject'), 'not-a-real-subject')
})

check('null / undefined are passed through', () => {
  assert.equal(normalizeSubject(null), null)
  assert.equal(normalizeSubject(undefined), undefined)
})

check('every label round-trips, and its lowercase resolves', () => {
  for (const label of SUBJECT_LABELS) {
    assert.equal(normalizeSubject(label), label, `label ${label} should be stable`)
    assert.equal(normalizeSubject(label.toLowerCase()), label, `lower(${label}) should resolve`)
  }
})

// ── quizWriteSchema preprocess ────────────────────────────────────
console.log('\nquizWriteSchema (subject coercion)')

check('slug subject is coerced to label before validation', () => {
  const parsed = quizWriteSchema.safeParse(baseQuiz({ subject: 'mathematics' }))
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues))
  assert.equal(parsed.data.subject, 'Mathematics')
})

check('multi-word slug subject coerced through schema', () => {
  const parsed = quizWriteSchema.safeParse(baseQuiz({ subject: 'social-studies' }))
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues))
  assert.equal(parsed.data.subject, 'Social Studies')
})

check('valid display subject passes unchanged through schema', () => {
  const parsed = quizWriteSchema.safeParse(baseQuiz({ subject: 'Integrated Science' }))
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues))
  assert.equal(parsed.data.subject, 'Integrated Science')
})

check('empty subject still fails (min length enforced)', () => {
  const parsed = quizWriteSchema.safeParse(baseQuiz({ subject: '' }))
  assert.ok(!parsed.success, 'empty subject must be rejected')
})

console.log(`\n${passed} checks passed`)
