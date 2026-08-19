#!/usr/bin/env node
// scripts/test-learner-portal-denial.mjs
//
// The card LearnerOnlyRoute shows an account it turns away.
//
// The bug: the card was written for a teacher and rendered for everyone. A
// parent who opened a learner link was told "Teacher accounts stay in the
// teacher portal" — about an account that is not a teacher's — and given a
// "Back to Teacher Portal" button that landed them on /family, because the
// teacher route guard read their real role and moved them. Wrong words and a
// button naming a destination it never reaches are one bug: the card never
// looked at the role.
//
// The load-bearing property here is not the wording but that the way out is
// really a way out — `actionPath` must never be a learner-only path, or the
// button returns the account to this very card.

import assert from 'node:assert/strict'
import {
  LEARNER_PORTAL_DENIALS,
  resolveLearnerPortalDenial,
} from '../src/app/guards/learnerPortalDenial.js'
import { isLearnerOnlyPath } from '../src/utils/navigation.js'

// ── The reported case ────────────────────────────────────────────────
const parent = resolveLearnerPortalDenial({ role: 'parent' })
assert.equal(parent.audience, 'parent')
assert.equal(parent.actionPath, '/family')
assert.doesNotMatch(parent.title, /teacher/i, 'a parent must not be called a teacher')
assert.doesNotMatch(parent.body, /teacher/i)
assert.doesNotMatch(parent.actionLabel, /teacher/i)
// The button says where it goes. This is the half of the bug a reader sees
// first: the label named the teacher portal and the navigation ended on the
// family portal.
assert.match(parent.actionLabel, /family/i)

// ── Teachers keep the card that was written for them ─────────────────
const teacher = resolveLearnerPortalDenial({ role: 'teacher' })
assert.equal(teacher.audience, 'teacher')
assert.equal(teacher.actionPath, '/teacher')
assert.match(teacher.title, /teacher accounts stay in the teacher portal/i)

// ── Both shapes of caller, and both spellings of each role ───────────
// The guard holds context flags; a test or a redirect may hold only the
// profile or a bare role string. All three must resolve the same audience.
assert.equal(resolveLearnerPortalDenial('teacher').audience, 'teacher')
assert.equal(resolveLearnerPortalDenial('parent').audience, 'parent')
assert.equal(resolveLearnerPortalDenial({ isTeacher: true }).audience, 'teacher')
assert.equal(resolveLearnerPortalDenial({ isParent: true }).audience, 'parent')

// A super-admin carries isTeacher, and never reaches this card at all — but if
// the guard's order ever changes, "teacher" is the safe reading of that flag.
assert.equal(resolveLearnerPortalDenial({ role: 'superAdmin', isTeacher: true }).audience, 'teacher')

// ── A role nobody planned for still gets an answer ───────────────────
for (const unknown of [null, undefined, '', {}, { role: 'nonsense' }, 42]) {
  const denial = resolveLearnerPortalDenial(unknown)
  assert.equal(denial.audience, 'other', `${JSON.stringify(unknown)} should fall to the generic card`)
  assert.doesNotMatch(denial.title, /teacher/i)
}

// ── Every card is complete ───────────────────────────────────────────
for (const denial of Object.values(LEARNER_PORTAL_DENIALS)) {
  for (const field of ['audience', 'title', 'body', 'actionLabel', 'actionPath']) {
    assert.equal(typeof denial[field], 'string', `${denial.audience}.${field} must be a string`)
    assert.ok(denial[field].length > 0, `${denial.audience}.${field} must not be empty`)
  }
}

// ── The escape hatch cannot loop ─────────────────────────────────────
// Checked against LEARNER_ONLY_SEGMENTS rather than a hand-listed set of
// paths: the landing page for an unrecognised role is /dashboard, which IS a
// learner route, so this is one careless getRoleLandingPath away.
for (const denial of Object.values(LEARNER_PORTAL_DENIALS)) {
  assert.ok(denial.actionPath.startsWith('/'), `${denial.audience} must go to an in-app path`)
  assert.equal(
    isLearnerOnlyPath(denial.actionPath),
    false,
    `${denial.audience}'s "${denial.actionLabel}" goes to ${denial.actionPath}, which is a learner-only route — the button would come straight back to this card`,
  )
}

console.log(`✓ learner-portal denial — ${Object.keys(LEARNER_PORTAL_DENIALS).length} audiences, each with a way out that does not loop`)
