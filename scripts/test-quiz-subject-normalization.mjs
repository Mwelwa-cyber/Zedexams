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
import { quizWriteSchema, quizUpdateSchema } from '../src/schemas/quiz.js'

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

// ── KB-style underscore keys (BulkPublish subjectForLearnerCollection) ──
// The CBC knowledge base keys subjects with underscores; the learner filter
// matches on the canonical display label. These must resolve, or bulk-published
// quizzes never appear under the right subject (the 'expressive_arts' ->
// 'Expressive Arts' [plural] mis-map this batch fixes).
check('KB underscore key "expressive_arts" -> "Expressive Art" (singular)', () => {
  assert.equal(normalizeSubject('expressive_arts'), 'Expressive Art')
})

check('hyphen slug "expressive-arts" -> "Expressive Art" (singular)', () => {
  assert.equal(normalizeSubject('expressive-arts'), 'Expressive Art')
})

check('KB underscore key "social_studies" -> "Social Studies"', () => {
  assert.equal(normalizeSubject('social_studies'), 'Social Studies')
})

check('KB aliases "integrated_science" / "science" -> "Integrated Science"', () => {
  assert.equal(normalizeSubject('integrated_science'), 'Integrated Science')
  assert.equal(normalizeSubject('integrated science'), 'Integrated Science')
  assert.equal(normalizeSubject('science'), 'Integrated Science')
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

// ── duration field validation (P2b) ───────────────────────────────
console.log('\nquizWriteSchema (duration validation)')

check('valid in-range duration passes on create', () => {
  const parsed = quizWriteSchema.safeParse(baseQuiz({ duration: 60 }))
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues))
  assert.equal(parsed.data.duration, 60)
})

check('out-of-range duration hard-fails on CREATE with a named error', () => {
  const parsed = quizWriteSchema.safeParse(baseQuiz({ duration: 200 }))
  assert.ok(!parsed.success, 'duration > 180 must be rejected on create')
  const issue = parsed.error.issues.find((i) => i.path.includes('duration'))
  assert.ok(issue, 'the failing issue should name the duration field')
})

check('UPDATE path clamps a legacy out-of-range duration instead of failing', () => {
  // EditQuizV2 keeps a legacy/custom saved duration selectable and re-saves it
  // on unrelated edits; a hard-fail here would block editing the quiz. The
  // update schema clamps into 5..180 (and below the Firestore rule cap).
  const high = quizUpdateSchema.safeParse({ duration: 200 })
  assert.ok(high.success, JSON.stringify(high.error?.issues))
  assert.equal(high.data.duration, 180)

  const low = quizUpdateSchema.safeParse({ duration: 2 })
  assert.ok(low.success, JSON.stringify(low.error?.issues))
  assert.equal(low.data.duration, 5)

  const ok = quizUpdateSchema.safeParse({ duration: 45 })
  assert.ok(ok.success, JSON.stringify(ok.error?.issues))
  assert.equal(ok.data.duration, 45)
})

check('UPDATE path preserves unknown passthrough fields (reviewCount, mode)', () => {
  // updateQuizWithQuestions relies on .passthrough() so the autosave path
  // validates known fields without dropping ad-hoc ones.
  const parsed = quizUpdateSchema.safeParse({
    subject: 'mathematics',
    reviewCount: 3,
    mode: 'autosave',
    importStatus: 'done',
  })
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues))
  assert.equal(parsed.data.subject, 'Mathematics', 'subject still normalized on update')
  assert.equal(parsed.data.reviewCount, 3)
  assert.equal(parsed.data.mode, 'autosave')
  assert.equal(parsed.data.importStatus, 'done')
})

console.log(`\n${passed} checks passed`)
