/**
 * Tests for objectConfidence — the import confidence → auto-approve band policy.
 * Plain `node` ES-module script; throws on the first failed assertion.
 *
 * Run: node src/utils/objectConfidence.test.js
 */

import assert from 'node:assert'
import {
  AUTO_APPROVE_MIN,
  REVIEW_MIN,
  CONFIDENCE_BANDS,
  bandFor,
  isAutoApprovable,
  requiresApproval,
  bandLabel,
  penalise,
} from './objectConfidence.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('objectConfidence')

test('thresholds match the spec (0.95 / 0.80)', () => {
  assert.strictEqual(AUTO_APPROVE_MIN, 0.95)
  assert.strictEqual(REVIEW_MIN, 0.8)
})

test('> 0.95 auto-approves', () => {
  assert.strictEqual(bandFor(0.96), CONFIDENCE_BANDS.AUTO)
  assert.strictEqual(bandFor(1), CONFIDENCE_BANDS.AUTO)
  assert.strictEqual(bandFor(0.95), CONFIDENCE_BANDS.AUTO) // boundary is inclusive
})

test('0.80..0.95 is review', () => {
  assert.strictEqual(bandFor(0.8), CONFIDENCE_BANDS.REVIEW)
  assert.strictEqual(bandFor(0.9), CONFIDENCE_BANDS.REVIEW)
  assert.strictEqual(bandFor(0.949), CONFIDENCE_BANDS.REVIEW)
})

test('< 0.80 requires approval', () => {
  assert.strictEqual(bandFor(0.79), CONFIDENCE_BANDS.APPROVE)
  assert.strictEqual(bandFor(0), CONFIDENCE_BANDS.APPROVE)
})

test('unknown/non-finite score falls back to review, never auto', () => {
  assert.strictEqual(bandFor(null), CONFIDENCE_BANDS.REVIEW)
  assert.strictEqual(bandFor(undefined), CONFIDENCE_BANDS.REVIEW)
  assert.strictEqual(bandFor(NaN), CONFIDENCE_BANDS.REVIEW)
  assert.strictEqual(isAutoApprovable(null), false)
})

test('isAutoApprovable / requiresApproval agree with bandFor', () => {
  assert.strictEqual(isAutoApprovable(0.99), true)
  assert.strictEqual(isAutoApprovable(0.85), false)
  assert.strictEqual(requiresApproval(0.5), true)
  assert.strictEqual(requiresApproval(0.85), false)
})

test('bandLabel gives readable copy', () => {
  assert.strictEqual(bandLabel(CONFIDENCE_BANDS.AUTO), 'Auto-approved')
  assert.strictEqual(bandLabel(CONFIDENCE_BANDS.APPROVE), 'Needs approval')
  assert.strictEqual(bandLabel(CONFIDENCE_BANDS.REVIEW), 'Review')
})

test('penalise lowers a score proportionally and clamps', () => {
  assert.strictEqual(penalise(1, 0.5), 0.5)
  assert.strictEqual(penalise(0.9, 0), 0.9) // no penalty
  assert.strictEqual(penalise(0.9, 1), 0) // full penalty
  assert.ok(Math.abs(penalise(0.8, 0.25) - 0.6) < 1e-9)
})

test('penalise drops a high score out of the auto band on disagreement', () => {
  // A confident extraction the assist model disagrees with should no longer
  // auto-approve.
  const penalised = penalise(0.98, 0.1) // 0.882 → out of auto, into review
  assert.ok(penalised < AUTO_APPROVE_MIN)
  assert.strictEqual(bandFor(penalised), CONFIDENCE_BANDS.REVIEW)
  // A bigger disagreement can push it all the way to needing approval.
  assert.strictEqual(bandFor(penalise(0.98, 0.25)), CONFIDENCE_BANDS.APPROVE)
})

test('penalise leaves an unknown score unknown', () => {
  assert.ok(Number.isNaN(Number(penalise(null, 0.5))) || penalise(null, 0.5) === null)
})

console.log(`\n${passed} passed`)
