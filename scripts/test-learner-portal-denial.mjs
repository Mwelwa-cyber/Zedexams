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
import { isLearnerOnlyPath, getRoleLandingPath } from '../src/utils/navigation.js'
import { LEARNER_ROLES, isLearnerRole } from '../src/utils/permissions.js'

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

// ── The loop closes ONE HOP OUT, so the check has to follow it ───────
//
// The rule above is necessary and was not sufficient. '/' is not a
// learner-only segment, so the generic card passed — and then RootRedirect
// resolved '/' through getRoleLandingPath and sent a legacy `role: 'student'`
// account straight back to /dashboard, which renders this card again. The
// loop was one redirect further out than the check looked.
//
// So: walk the button, then walk the redirect that button lands on, and
// require that the account is not deposited back on a learner-only path it
// cannot open.
const REDIRECTING_PATHS = new Set(['/'])

function landsOn(actionPath, profile) {
  // Only '/' redirects by role; every other actionPath is its own destination.
  return REDIRECTING_PATHS.has(actionPath) ? getRoleLandingPath(profile) : actionPath
}

for (const role of [...LEARNER_ROLES, 'teacher', 'parent', 'nonsense', undefined]) {
  const profile = role === undefined ? {} : { role }
  const denial = resolveLearnerPortalDenial(profile)
  const destination = landsOn(denial.actionPath, profile)

  // An account the app treats as a learner must never be shown this card in
  // the first place — that is what LearnerOnlyRoute's role branch is for, and
  // it is the disagreement that produced the loop.
  if (isLearnerRole(role)) {
    assert.equal(
      getRoleLandingPath(profile),
      '/dashboard',
      `'${role}' must land on the learner dashboard, or the role vocabularies have drifted again`,
    )
    continue
  }

  assert.equal(
    isLearnerOnlyPath(destination),
    false,
    `'${role}' presses "${denial.actionLabel}" → ${denial.actionPath} → ${destination}, which is learner-only — the card returns`,
  )
}

// ── The two vocabularies agree ───────────────────────────────────────
// The loop existed because getRoleLandingPath called 'student' a learner and
// AuthContext's isLearner did not. Both now read LEARNER_ROLES; this fails if
// either grows a spelling the other lacks.
//
// The explicit fallback is load-bearing. getRoleLandingPath's DEFAULT fallback
// is '/dashboard', so asserting the default return value cannot tell a role
// that was RECOGNISED as a learner from one that fell through unrecognised and
// got the same answer by accident. That accident is precisely how the original
// bug stayed invisible: the redirect looked right while the guard disagreed.
// Passing a sentinel makes the two distinguishable.
const NOT_MATCHED = '/__fell_through__'
for (const role of LEARNER_ROLES) {
  assert.ok(isLearnerRole(role), `${role} is in LEARNER_ROLES but isLearnerRole says no`)
  assert.equal(
    getRoleLandingPath({ role }, NOT_MATCHED),
    '/dashboard',
    `${role} is a learner role but getRoleLandingPath does not recognise it — it reached the fallback instead`,
  )
}
assert.equal(isLearnerRole('teacher'), false)
assert.equal(isLearnerRole('parent'), false)
assert.equal(isLearnerRole('admin'), false)
assert.equal(isLearnerRole(undefined), false)

console.log(`✓ learner-portal denial — ${Object.keys(LEARNER_PORTAL_DENIALS).length} audiences, each with a way out that does not loop (checked one redirect hop out)`)
