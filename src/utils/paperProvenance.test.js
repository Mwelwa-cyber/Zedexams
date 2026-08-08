/**
 * Keeping mock-paper answers out of the topic analysis — and, just as
 * important, keeping ordinary practice quizzes IN it.
 *
 * The second half is the one that would go wrong quietly: an over-eager filter
 * that treated "no provenance stamp" as "a mock" would empty every learner's
 * recommendations, and the symptom would be an absence nobody reports.
 *
 * Plain-node script — `npm run test:paper-provenance`.
 */

import assert from 'node:assert/strict'
import { isMockPaperRecord, officialOnly } from './paperProvenance.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('\npaperProvenance — what counts as mock-paper work')

test('a record stamped not-official is a mock', () => {
  assert.equal(isMockPaperRecord({ paperIsOfficial: false }), true)
})

test('a stated non-ECZ source is a mock, even without the boolean', () => {
  assert.equal(isMockPaperRecord({ paperSource: 'prisca' }), true)
  assert.equal(isMockPaperRecord({ paperSource: 'school_mock' }), true)
  assert.equal(isMockPaperRecord({ paperSource: 'other' }), true)
})

test('an ECZ record is NOT a mock, by either field', () => {
  assert.equal(isMockPaperRecord({ paperSource: 'ecz' }), false)
  assert.equal(isMockPaperRecord({ paperIsOfficial: true }), false)
  assert.equal(isMockPaperRecord({ paperSource: 'ECZ ', paperIsOfficial: true }), false)
})

test('AN UNSTAMPED RECORD IS NOT A MOCK — absence is eligible', () => {
  // Nearly every result in the database is an ordinary CBC practice quiz with
  // no past paper behind it. Reading those as mocks would silently empty every
  // learner's recommendations.
  assert.equal(isMockPaperRecord({ quizId: 'q1', topicScores: {} }), false)
  assert.equal(isMockPaperRecord({}), false)
  assert.equal(isMockPaperRecord(null), false)
  assert.equal(isMockPaperRecord('result'), false)
})

test('officialOnly keeps the unstamped and drops the stated mocks', () => {
  const rows = [
    { id: 'plain' },
    { id: 'ecz', paperSource: 'ecz' },
    { id: 'mock', paperSource: 'prisca' },
    { id: 'flagged', paperIsOfficial: false },
  ]
  assert.deepEqual(officialOnly(rows).map((r) => r.id), ['plain', 'ecz'])
  assert.deepEqual(officialOnly(null), [])
})

// The other half of this rule — that `extractWeakTopics` actually APPLIES it,
// and that ordinary practice quizzes survive the filter — is asserted in
// scripts/test-learner-home-core.mjs, next to the aggregation itself.

console.log(`\n${passed} assertions passed.\n`)
