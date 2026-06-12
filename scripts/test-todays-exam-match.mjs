#!/usr/bin/env node
/* global console */
/**
 * Tests for daily-exam ↔ subject matching (src/utils/examMatching.js).
 *
 * Regression guard for the "Today's exams shows nothing" bug: daily exams
 * promoted by autoPickDailyExams / the admin pin patch keep whatever subject
 * the quiz already had, so a legacy quiz with a *slug* subject ("science")
 * must still resolve for the canonical label ("Integrated Science"). The old
 * exact `subject == label` Firestore match silently missed those.
 *
 * Pure logic, no Firestore. Run: npm run test:exam-subject-match
 */
import assert from 'node:assert/strict'
import {
  examMatchesSubject,
  pickExamForSubject,
  groupExamsBySubject,
} from '../src/utils/examMatching.js'

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

// ── examMatchesSubject ────────────────────────────────────────────────────
test('label-stored subject matches the label', () => {
  assert.equal(examMatchesSubject({ subject: 'Integrated Science' }, 'Integrated Science'), true)
})

test('slug-stored subject matches the canonical label (the bug)', () => {
  // autoPickDailyExams / setAsDailyExam never normalise subject, so a legacy
  // "science" slug reaches the hub. It must still resolve.
  assert.equal(examMatchesSubject({ subject: 'science' }, 'Integrated Science'), true)
  assert.equal(examMatchesSubject({ subject: 'mathematics' }, 'Mathematics'), true)
  assert.equal(examMatchesSubject({ subject: 'expressive-arts' }, 'Expressive Art'), true)
})

test('case / whitespace variants match', () => {
  assert.equal(examMatchesSubject({ subject: 'MATHEMATICS' }, 'Mathematics'), true)
  assert.equal(examMatchesSubject({ subject: '  Mathematics ' }, 'Mathematics'), true)
})

test('different subjects do not match', () => {
  assert.equal(examMatchesSubject({ subject: 'Mathematics' }, 'English'), false)
})

test('empty / missing subject never matches', () => {
  assert.equal(examMatchesSubject({ subject: '' }, 'Mathematics'), false)
  assert.equal(examMatchesSubject({}, 'Mathematics'), false)
  assert.equal(examMatchesSubject(null, 'Mathematics'), false)
})

// ── pickExamForSubject ────────────────────────────────────────────────────
test('picks the matching exam regardless of slug/label storage', () => {
  const exams = [
    { id: 'a', subject: 'english' },
    { id: 'b', subject: 'mathematics' },
  ]
  assert.equal(pickExamForSubject(exams, 'Mathematics')?.id, 'b')
  assert.equal(pickExamForSubject(exams, 'English')?.id, 'a')
})

test('returns null when no exam matches', () => {
  assert.equal(pickExamForSubject([{ id: 'a', subject: 'english' }], 'Cinyanja'), null)
  assert.equal(pickExamForSubject([], 'English'), null)
  assert.equal(pickExamForSubject(undefined, 'English'), null)
})

test('prefers the learner grade but falls back to any match', () => {
  const exams = [
    { id: 'g7', subject: 'Mathematics', grade: '7' },
    { id: 'g5', subject: 'Mathematics', grade: '5' },
  ]
  assert.equal(pickExamForSubject(exams, 'Mathematics', '5')?.id, 'g5')
  assert.equal(pickExamForSubject(exams, 'Mathematics', '7')?.id, 'g7')
  // grade with no exact match still resolves (don't trade one disappearance
  // for another)
  assert.equal(pickExamForSubject(exams, 'Mathematics', '4')?.id, 'g7')
  // no grade supplied → first match
  assert.equal(pickExamForSubject(exams, 'Mathematics')?.id, 'g7')
})

// ── groupExamsBySubject ───────────────────────────────────────────────────
test('keys the map by canonical label even for slug-stored subjects', () => {
  const map = groupExamsBySubject([
    { id: 'a', subject: 'science', grade: '5' },
    { id: 'b', subject: 'Mathematics', grade: '5' },
  ])
  assert.equal(map.get('Integrated Science')?.id, 'a')
  assert.equal(map.get('Mathematics')?.id, 'b')
  assert.equal(map.size, 2)
})

test('grouping prefers the learner grade on subject collisions', () => {
  const map = groupExamsBySubject([
    { id: 'g7', subject: 'Mathematics', grade: '7' },
    { id: 'g5', subject: 'mathematics', grade: '5' },
  ], '5')
  assert.equal(map.get('Mathematics')?.id, 'g5')
})

test('grouping skips entries with empty/unkeyable subjects', () => {
  const map = groupExamsBySubject([
    { id: 'x', subject: '' },
    { id: 'y', subject: null },
    { id: 'z', subject: 'English' },
  ])
  assert.equal(map.size, 1)
  assert.equal(map.get('English')?.id, 'z')
})

console.log(`\n${passed} assertions passed`)
