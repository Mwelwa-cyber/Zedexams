import assert from 'node:assert/strict'
import {
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_VALUES,
  KNOWN_FEEDBACK_ROLES,
  FEEDBACK_STATUSES,
  isValidFeedbackType,
  normalizeFeedbackRole,
} from './feedbackOptions.js'

// These allowlists are duplicated by the `match /feedback/{...}` create
// validator in firestore.rules. If they drift, a valid submission gets
// silently rejected by Firestore. This test pins the shape; the
// rules-text test (scripts/test-firestore-rules-text.mjs) pins the rule
// side — both must agree.

let pass = 0
function test(name, fn) { fn(); pass++; console.log(`  ok  ${name}`) }

test('type values match the rule allowlist exactly', () => {
  assert.deepEqual(
    [...FEEDBACK_TYPE_VALUES].sort(),
    ['bug', 'content', 'feature', 'other', 'suggestion'],
  )
})

test('every type option has a value + label', () => {
  for (const t of FEEDBACK_TYPES) {
    assert.ok(t.value && typeof t.value === 'string', 'value missing')
    assert.ok(t.label && typeof t.label === 'string', 'label missing')
  }
})

test('role allowlist matches the rule', () => {
  assert.deepEqual(
    [...KNOWN_FEEDBACK_ROLES].sort(),
    ['admin', 'learner', 'other', 'parent', 'school', 'teacher'],
  )
})

test('statuses cover the admin workflow', () => {
  assert.deepEqual(FEEDBACK_STATUSES, ['new', 'planned', 'done', 'declined'])
})

test('isValidFeedbackType accepts known + rejects unknown', () => {
  assert.equal(isValidFeedbackType('content'), true)
  assert.equal(isValidFeedbackType('spam'), false)
  assert.equal(isValidFeedbackType(undefined), false)
})

test('normalizeFeedbackRole passes through known roles', () => {
  assert.equal(normalizeFeedbackRole('learner'), 'learner')
  assert.equal(normalizeFeedbackRole('teacher'), 'teacher')
  assert.equal(normalizeFeedbackRole('admin'), 'admin')
})

test('normalizeFeedbackRole collapses superAdmin to admin', () => {
  assert.equal(normalizeFeedbackRole('superAdmin'), 'admin')
})

test('normalizeFeedbackRole falls back to other for unknown/missing', () => {
  assert.equal(normalizeFeedbackRole('wizard'), 'other')
  assert.equal(normalizeFeedbackRole(undefined), 'other')
  assert.equal(normalizeFeedbackRole(null), 'other')
})

console.log(`\nfeedbackOptions: ${pass} passed`)
