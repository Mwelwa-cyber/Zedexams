/**
 * test:learner-grades — the staged grade rollout, checked in one place.
 *
 * Two claims, both of which fail silently in production if they stop holding:
 *
 *   1. THE CLIENT AND SERVER LISTS AGREE. `LEARNER_GRADES` decides who may sign
 *      in; `DAILY_QUIZ_GRADES` decides which grades the daily quiz is built
 *      for and which grades Vigil pages ops about hourly. A grade in one
 *      and not the other is either an hourly alert about learners who cannot
 *      exist, or a live grade with no daily quiz. Neither raises an error
 *      anywhere — the first is noise you learn to ignore and the second is an
 *      empty screen — so it has to be a test.
 *
 *   2. THE ROLLOUT LIST IS A SUBSET OF THE CATALOGUE. Opening a grade the
 *      product has no subjects, topics or syllabus for is the one way this
 *      config can be wrong that a mirror check cannot see.
 *
 * Plus the pure access rule, whose whole job is to keep an existing learner in
 * a paused grade from being silently relabelled.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { GRADES, LEARNER_GRADES, isLearnerGrade, isPendingLearnerGrade } from '../src/config/curriculum.js'
import {
  GRADE_ACCESS,
  resolveLearnerGradeAccess,
} from '../src/features/learnerOnboarding/lib/setupWizardCore.js'

const require = createRequire(import.meta.url)
const { DAILY_QUIZ_GRADES } = require('../functions/dailyQuiz/dailyQuizCore.js')

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('learner-grades')

test('client and server rollout lists name the same grades', () => {
  const client = [...LEARNER_GRADES].map(Number).sort((a, b) => a - b)
  const server = [...DAILY_QUIZ_GRADES].map(Number).sort((a, b) => a - b)
  assert.deepEqual(
    server, client,
    'LEARNER_GRADES (src/config/curriculum.js) and DAILY_QUIZ_GRADES ' +
    '(functions/dailyQuiz/dailyQuizCore.js) must list the same grades. ' +
    `client=[${client}] server=[${server}]`,
  )
})

test('every live grade exists in the curriculum catalogue', () => {
  for (const g of LEARNER_GRADES) {
    assert.ok(GRADES.includes(Number(g)), `Grade ${g} is open to learners but is not in GRADES`)
  }
})

test('the rollout list is non-empty', () => {
  assert.ok(LEARNER_GRADES.length > 0, 'no grade is open — every learner would hit the waitlist')
})

test('isLearnerGrade / isPendingLearnerGrade partition the catalogue', () => {
  for (const g of GRADES) {
    assert.equal(
      isLearnerGrade(g) !== isPendingLearnerGrade(g), true,
      `Grade ${g} is both or neither live and pending`,
    )
  }
  // String forms are what Firestore hands back.
  assert.equal(isLearnerGrade(String(LEARNER_GRADES[0])), true)
})

test('a learner in a live grade is let through', () => {
  assert.equal(
    resolveLearnerGradeAccess({ grade: String(LEARNER_GRADES[0]) }, LEARNER_GRADES, GRADES),
    GRADE_ACCESS.OK,
  )
})

test('a learner in a paused catalogue grade is waitlisted, not relabelled', () => {
  const paused = GRADES.filter((g) => !LEARNER_GRADES.includes(g))
  // Skip only when nothing is paused; that is a real state (full rollout).
  for (const g of paused) {
    assert.equal(
      resolveLearnerGradeAccess({ grade: String(g) }, LEARNER_GRADES, GRADES),
      GRADE_ACCESS.WAITLIST,
      `Grade ${g} should be waitlisted`,
    )
  }
})

test('no grade, or a grade off the catalogue, is the setup wizard’s case', () => {
  for (const profile of [{}, { grade: null }, { grade: '' }, { grade: 'banana' }, { grade: 99 }]) {
    assert.equal(
      resolveLearnerGradeAccess(profile, LEARNER_GRADES, GRADES),
      GRADE_ACCESS.UNKNOWN,
      `${JSON.stringify(profile)} should be UNKNOWN, never WAITLIST`,
    )
  }
})

test('a missing profile is UNKNOWN (admins and parents have no grade)', () => {
  assert.equal(resolveLearnerGradeAccess(null, LEARNER_GRADES, GRADES), GRADE_ACCESS.UNKNOWN)
  assert.equal(resolveLearnerGradeAccess(undefined, LEARNER_GRADES, GRADES), GRADE_ACCESS.UNKNOWN)
})

if (failures > 0) {
  console.error(`\nlearner-grades — ${failures} failed`)
  process.exit(1)
}
console.log('learner-grades — all passed')
