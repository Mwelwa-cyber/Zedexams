// Regression test for src/features/assessmentStudio/lib/assessmentLoadGuard.js
//
// Root cause (data-loss): getAssessmentQuestions swallows read errors and
// returns []. The AssessmentStudio edit loader used an inline guard
// (`assessment.questionCount > 0 && questions.length === 0`) to block
// hydration, but it was not tested in isolation. This script tests the
// extracted shouldBlockHydration() pure function.
//
// The data-loss scenario: questionCount > 0 but questions read returns [] —
// if the loader were to hydrate this as an "empty paper", the studio would
// show a blank editor and the next autosave would write questionCount: 0 and
// totalMarks: 0 over the real values, permanently losing the paper's metadata.

import assert from 'node:assert/strict'
import { shouldBlockHydration } from '../src/features/assessmentStudio/lib/assessmentLoadGuard.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ── Blocking cases (failed read detected) ─────────────────────────────────

console.log('shouldBlockHydration — cases that BLOCK hydration')

test('blocks when questionCount > 0 and questions array is empty', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: 5 }, questions: [] }),
    true,
  )
})

test('blocks when questionCount is large (a 40-question exam)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: 40, totalMarks: 80 }, questions: [] }),
    true,
  )
})

test('blocks on totalMarks > 0 even when questionCount is absent', () => {
  // A paper saved by an older build may lack questionCount but carry totalMarks.
  assert.equal(
    shouldBlockHydration({ assessment: { totalMarks: 20 }, questions: [] }),
    true,
  )
})

test('blocks on totalMarks > 0 even when questionCount is 0', () => {
  // A denormalized paper that somehow has totalMarks but questionCount 0.
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: 0, totalMarks: 10 }, questions: [] }),
    true,
  )
})

// ── Non-blocking cases (safe to hydrate) ──────────────────────────────────

console.log('shouldBlockHydration — cases that ALLOW hydration')

test('allows a genuinely empty paper (questionCount 0, totalMarks 0)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: 0, totalMarks: 0 }, questions: [] }),
    false,
  )
})

test('allows a paper with no count fields at all (new/legacy shell)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: {}, questions: [] }),
    false,
  )
})

test('allows when questions did arrive (normal successful load)', () => {
  assert.equal(
    shouldBlockHydration({
      assessment: { questionCount: 3, totalMarks: 6 },
      questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
    }),
    false,
  )
})

test('allows when questions is a non-empty array (even one question)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: 1 }, questions: [{ id: 'q1' }] }),
    false,
  )
})

test('allows when assessment is null (handled separately by the loader)', () => {
  // The null-assessment path is handled by the "not found" check before
  // shouldBlockHydration is reached, but it must not throw here.
  assert.equal(
    shouldBlockHydration({ assessment: null, questions: [] }),
    false,
  )
})

test('allows when questions is not an array (defensive — should never happen)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: 5 }, questions: null }),
    false,
  )
})

// ── Boundary / coercion ───────────────────────────────────────────────────

console.log('shouldBlockHydration — boundary values')

test('treats undefined questionCount / totalMarks as 0 (no block)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: undefined, totalMarks: undefined }, questions: [] }),
    false,
  )
})

test('treats null questionCount / totalMarks as 0 (no block)', () => {
  assert.equal(
    shouldBlockHydration({ assessment: { questionCount: null, totalMarks: null }, questions: [] }),
    false,
  )
})

console.log(`\n${passed} assertions passed.`)
