#!/usr/bin/env node
/* global console */
/**
 * Tests for the subject-normalization back-repair migration.
 *
 * Exercises the pure repairSubject() logic in isolation (no Firestore), the
 * same way the runner calls it: slug -> label produces a single-field patch,
 * already-correct / empty / missing / unrecognised values are no-ops.
 *
 * Run: npm run test:migrate-normalize-subjects
 */
import assert from 'node:assert/strict'
import { repairSubject } from './migrate-normalize-subjects.mjs'

let passed = 0
function test(name, fn) {
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

test('slug "mathematics" is repaired to "Mathematics"', () => {
  const summary = {}
  const patch = repairSubject({ subject: 'mathematics' }, summary)
  assert.ok(patch, 'returns a patch')
  assert.equal(patch.subject, 'Mathematics')
  assert.equal(summary.from, 'mathematics')
  assert.equal(summary.to, 'Mathematics')
})

test('multi-word slug "social-studies" -> "Social Studies"', () => {
  const patch = repairSubject({ subject: 'social-studies' })
  assert.ok(patch)
  assert.equal(patch.subject, 'Social Studies')
})

test('curriculum id "science" -> "Integrated Science"', () => {
  const patch = repairSubject({ subject: 'science' })
  assert.ok(patch)
  assert.equal(patch.subject, 'Integrated Science')
})

test('patch contains ONLY the subject field (no doc clobber)', () => {
  const patch = repairSubject({ subject: 'mathematics', title: 'Keep me', grade: '7' })
  assert.deepEqual(Object.keys(patch), ['subject'])
})

test('already-canonical label is a no-op', () => {
  assert.equal(repairSubject({ subject: 'Mathematics' }), null)
})

test('empty subject is a no-op', () => {
  assert.equal(repairSubject({ subject: '' }), null)
})

test('missing subject field is a no-op', () => {
  assert.equal(repairSubject({ title: 'No subject' }), null)
})

test('non-string subject is a no-op', () => {
  assert.equal(repairSubject({ subject: 42 }), null)
})

test('unrecognised subject is left untouched (no-op, not mangled)', () => {
  assert.equal(repairSubject({ subject: 'Underwater Basket Weaving' }), null)
})

test('null / non-object input is a no-op', () => {
  assert.equal(repairSubject(null), null)
  assert.equal(repairSubject(undefined), null)
  assert.equal(repairSubject('string'), null)
})

test('idempotent: repairing a repaired value is a no-op', () => {
  const once = repairSubject({ subject: 'mathematics' })
  assert.equal(repairSubject({ subject: once.subject }), null)
})

console.log(`\n${passed} checks passed`)
