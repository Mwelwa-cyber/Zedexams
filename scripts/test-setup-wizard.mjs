#!/usr/bin/env node
/**
 * scripts/test-setup-wizard.mjs
 *
 * The first-run setup wizard's rules. The two that carry real weight:
 *
 *   • "needs setup" is keyed on the GRADE, so shipping the wizard does not
 *     march every existing learner back through onboarding.
 *   • resolveSetupStep is TOTAL — no URL reaches a screen it has not earned.
 */

import assert from 'node:assert/strict'
import {
  SETUP_STEP, SETUP_STEPS, normalizeGrade, needsSetup, resolveSetupStep,
  stepIndex, nextStep, prevStep, canAdvance, buildSetupPatch, resolveSetupSubjects,
} from '../src/features/learnerOnboarding/lib/setupWizardCore.js'
import { normalizeNotificationPrefs } from '../src/engines/notification-engine/notificationPrefs.js'

const GRADES = [4, 5, 6, 7]
let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`) }

test('the four steps are the prototype\'s four, in its order', () => {
  assert.deepEqual(SETUP_STEPS, ['grade', 'subjects', 'zed', 'notifications'])
  assert.equal(SETUP_STEPS.length, 4, 'the progress bar draws one dot per step')
})

test('normalizeGrade reads what Firestore actually stores', () => {
  assert.equal(normalizeGrade('7', GRADES), 7)
  assert.equal(normalizeGrade(7, GRADES), 7)
  assert.equal(normalizeGrade(' 7 ', GRADES), 7)
  assert.equal(normalizeGrade('', GRADES), null)
  assert.equal(normalizeGrade(null, GRADES), null)
  assert.equal(normalizeGrade(undefined, GRADES), null)
  assert.equal(normalizeGrade('seven', GRADES), null)
  assert.equal(normalizeGrade('7.5', GRADES), null)
})

test('a grade the catalogue does not serve is not a grade', () => {
  // Grade 8/9 are `active: false` in ALL_GRADES — there is no content behind
  // them, so a profile carrying one still needs setting up.
  assert.equal(normalizeGrade(9, GRADES), null)
  assert.equal(needsSetup({ grade: 9 }, GRADES), true)
})

test('an existing learner is NOT sent back through onboarding', () => {
  // The whole reason the test is on the grade rather than a completion flag.
  assert.equal(needsSetup({ grade: '7' }, GRADES), false)
  assert.equal(needsSetup({ grade: 4 }, GRADES), false)
  // …even though they carry no learnerSetup record at all.
  assert.equal(needsSetup({ grade: '6', learnerSetup: undefined }, GRADES), false)
})

test('a learner with no grade needs setup; a missing profile does not', () => {
  assert.equal(needsSetup({ grade: '' }, GRADES), true)
  assert.equal(needsSetup({}, GRADES), true)
  // No profile yet = still loading. Redirecting here would bounce every
  // learner through the wizard for one frame on every cold start.
  assert.equal(needsSetup(null, GRADES), false)
  assert.equal(needsSetup(undefined, GRADES), false)
})

test('resolveSetupStep is total — every input lands on a legal step', () => {
  for (const requested of [undefined, null, '', 'banana', 0, {}, [], 'GRADE']) {
    assert.ok(SETUP_STEPS.includes(resolveSetupStep({ requested, grade: 7 })),
      `illegal step for ${JSON.stringify(requested)}`)
  }
})

test('subjects cannot be deep-linked before a grade exists', () => {
  for (const step of ['subjects', 'zed', 'notifications']) {
    assert.equal(resolveSetupStep({ requested: step, grade: null }), SETUP_STEP.GRADE)
    assert.equal(resolveSetupStep({ requested: step, grade: '' }), SETUP_STEP.GRADE)
    assert.equal(resolveSetupStep({ requested: step, grade: 7 }), step)
  }
})

test('the grade blocks; nothing else does', () => {
  assert.equal(canAdvance(SETUP_STEP.GRADE, { grade: null }), false)
  assert.equal(canAdvance(SETUP_STEP.GRADE, {}), false)
  assert.equal(canAdvance(SETUP_STEP.GRADE, { grade: 7 }), true)
  // Picking no subjects is a legal answer, not an incomplete one.
  assert.equal(canAdvance(SETUP_STEP.SUBJECTS, { subjects: [] }), true)
  assert.equal(canAdvance(SETUP_STEP.ZED, {}), true)
  assert.equal(canAdvance(SETUP_STEP.NOTIFICATIONS, {}), true)
})

test('step navigation stops at both ends', () => {
  assert.equal(stepIndex('grade'), 0)
  assert.equal(stepIndex('notifications'), 3)
  assert.equal(stepIndex('nope'), -1)
  assert.equal(prevStep('grade'), null)
  assert.equal(nextStep('notifications'), null)
  assert.equal(nextStep('grade'), 'subjects')
  assert.equal(prevStep('zed'), 'subjects')
  assert.equal(nextStep('nope'), null)
  assert.equal(prevStep('nope'), null)
})

test('the patch writes the grade as a string, matching every existing reader', () => {
  const patch = buildSetupPatch({ grade: 7, subjects: ['english'], wantsReminders: true })
  assert.equal(patch.grade, '7')
  assert.deepEqual(patch.learnerSubjects, ['english'])
})

test('the reminder answer lands on the EXISTING preference shape', () => {
  // Not a new flag: a second source of truth for the same switch would drift
  // the first time either it or Settings was edited.
  const currentPrefs = normalizeNotificationPrefs({})
  const yes = buildSetupPatch({ grade: 7, wantsReminders: true, currentPrefs })
  assert.equal(yes.notificationPrefs.categories.learning, true)
  assert.equal(yes.notificationPrefs.channels.push, true)
  const no = buildSetupPatch({ grade: 7, wantsReminders: false, currentPrefs })
  assert.equal(no.notificationPrefs.categories.learning, false)
  assert.equal(no.notificationPrefs.channels.push, false)
  // Unanswered writes nothing rather than writing a default.
  assert.equal('notificationPrefs' in buildSetupPatch({ grade: 7, currentPrefs }), false)
})

test('the whole prefs object is written — updateDoc replaces maps, it does not merge', () => {
  // The failure this guards: returning a partial `{categories:{learning}}`
  // through updateDoc DELETES payments, account, system, announcements and
  // both quiet-hours settings. Silently, and only for learners who answered.
  const currentPrefs = normalizeNotificationPrefs({
    categories: { announcements: false },
    quietHours: { enabled: true, start: '21:00', end: '07:00' },
  })
  const { notificationPrefs: out } = buildSetupPatch({ grade: 7, wantsReminders: true, currentPrefs })
  assert.equal(out.categories.announcements, false, 'an unrelated category was lost')
  assert.equal(out.categories.payments, true)
  assert.equal(out.quietHours.enabled, true)
  assert.equal(out.quietHours.start, '21:00')
  assert.deepEqual(Object.keys(out).sort(), Object.keys(currentPrefs).sort())
})

test('the patch never writes junk into the subject list', () => {
  const patch = buildSetupPatch({ grade: 7, subjects: ['english', '', null, 3, 'science'] })
  assert.deepEqual(patch.learnerSubjects, ['english', 'science'])
})

test('an empty pick means EVERY subject, never none', () => {
  const all = ['english', 'mathematics', 'science']
  assert.deepEqual(resolveSetupSubjects([], all), all)
  assert.deepEqual(resolveSetupSubjects(null, all), all)
  assert.deepEqual(resolveSetupSubjects(undefined, all), all)
  assert.deepEqual(resolveSetupSubjects(['english'], all), ['english'])
})

test('a subject the new grade does not sit is dropped, not shown', () => {
  // Moving up a grade must not carry a subject the new grade has no catalogue
  // for — that is a card that opens onto nothing.
  const g7 = ['english', 'mathematics', 'science']
  assert.deepEqual(resolveSetupSubjects(['english', 'cinyanja'], g7), ['english'])
  // …and if NOTHING survives, fall back to the full set rather than to empty.
  assert.deepEqual(resolveSetupSubjects(['cinyanja'], g7), g7)
})

console.log(`\nsetup-wizard: ${passed} tests passed`)
