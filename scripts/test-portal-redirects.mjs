#!/usr/bin/env node
// scripts/test-portal-redirects.mjs
//
// A session never renders another portal's screen.
//
// ── Bug one (parent) ─────────────────────────────────────────────────
// /family/account → "Email and push alerts" navigated to
// /settings?section=notifications. That route renders ZedExamsSettings,
// which coerces any role outside ['admin','teacher','learner'] to
// `learner` — so a guardian got the learner top nav, a character-avatar
// picker built for children, and the heading "Signed in as Learner."
//
// ── Bug two (teacher), the same shape ────────────────────────────────
// /profile is role-branched for LEARNERS only; every other role fell
// through to the shared ProfilePage under the legacy learner Navbar. So a
// teacher opening their account page got a header reading Notes / Lessons
// / Practise over a page whose own back link read "Back to Teacher". Their
// profile is /settings/profile, inside the teacher shell. And because
// ProtectedRoute stashes the page you asked for and Login honours the
// stash, a teacher with /profile in a restored tab was returned to it on
// every sign-in.
//
// The link is fixed in each case, but a link is not the hole. A
// notification action, an old email, a bookmark or the next link somebody
// writes lands the same account on the same route. These assertions are
// about the ROUTE.

import assert from 'node:assert/strict'
import {
  PARENT_ROUTE_REDIRECTS,
  TEACHER_ROUTE_REDIRECTS,
  PORTAL_AUDIENCES,
  crossesPortals,
  portalAudience,
  resolveParentRedirect,
  resolvePortalRedirect,
  resolveTeacherRedirect,
} from '../src/utils/portalRedirects.js'
import { getRoleLandingPath, isLearnerOnlyPath, resolvePostAuthPath } from '../src/utils/navigation.js'

const TABLES = { parent: PARENT_ROUTE_REDIRECTS, teacher: TEACHER_ROUTE_REDIRECTS }

/* ══ Parent ══════════════════════════════════════════════════════════ */

// ── The reported route, and its nested and query forms ───────────────
assert.equal(resolveParentRedirect('/settings'), '/family/account/alerts')
assert.equal(resolveParentRedirect('/settings?section=notifications'), '/family/account/alerts')
assert.equal(resolveParentRedirect('/settings/profile'), '/family/account/alerts')

// ── The others in the map ────────────────────────────────────────────
assert.equal(resolveParentRedirect('/my-subscription'), '/family/account/billing')
assert.equal(resolveParentRedirect('/subscription'), '/family/account/billing')
assert.equal(resolveParentRedirect('/profile'), '/family/account')
assert.equal(resolveParentRedirect('/dashboard'), '/family')
assert.equal(resolveParentRedirect('/notifications'), '/family/notifications')
assert.equal(resolveParentRedirect('/ask-a-grown-up'), '/family/plan')

// ── Everything else renders as-is ────────────────────────────────────
// A guard that redirected what it did not recognise would trap a parent
// on /family for every public page — including the child-safety standards
// document their own account screen links to.
for (const path of [
  '/', '/family', '/family/children', '/family/account', '/child-safety',
  '/pricing', '/privacy', '/terms', '/login', '/papers', '/settingsomething',
]) {
  assert.equal(resolveParentRedirect(path), null, `${path} should render as-is for a parent`)
}

/* ══ Teacher ═════════════════════════════════════════════════════════ */

// ── The reported route, and its query form ───────────────────────────
assert.equal(resolveTeacherRedirect('/profile'), '/settings/profile')
assert.equal(resolveTeacherRedirect('/profile?tab=badges'), '/settings/profile')
// /my-badges is a <Navigate to="/profile"> — the same screen one hop out.
// The guard sits above the route table, so it answers before the hop.
assert.equal(resolveTeacherRedirect('/my-badges'), '/settings/profile')

// ── The others in the map ────────────────────────────────────────────
assert.equal(resolveTeacherRedirect('/my-subscription'), '/teacher/subscription')
assert.equal(resolveTeacherRedirect('/subscription'), '/teacher/subscription')
assert.equal(resolveTeacherRedirect('/ask-a-grown-up'), '/teacher/subscription')

// ── What a teacher legitimately keeps ────────────────────────────────
// /settings is role-branched in App.jsx (TeacherSettings inside
// TeacherLayout), so redirecting it would send a teacher away from their
// own settings — and /settings/profile is where this table SENDS them, so
// listing /settings would also be an infinite bounce.
assert.equal(resolveTeacherRedirect('/settings'), null)
assert.equal(resolveTeacherRedirect('/settings/profile'), null)
assert.equal(resolveTeacherRedirect('/settings/teaching-profile'), null)
// /offline is a shared surface, not a learner one: it holds a teacher's
// downloaded worksheets and lesson notes. Only its chrome was wrong, and
// App.jsx fixes that by rendering it in TeacherLayout. Redirecting a
// teacher off it would delete a feature to fix a header.
assert.equal(resolveTeacherRedirect('/offline'), null)
// The past-paper archive is deliberately open to teachers (it is the one
// learner-shell surface Navbar offers them), and so is its history.
assert.equal(resolveTeacherRedirect('/papers'), null)
assert.equal(resolveTeacherRedirect('/papers/g7-science'), null)
assert.equal(resolveTeacherRedirect('/my-papers'), null)
for (const path of [
  '/', '/teacher', '/teacher/library', '/teacher/assessment-papers/x/edit',
  '/pricing', '/privacy', '/login', '/games', '/profiles', '/subscriptions',
]) {
  assert.equal(resolveTeacherRedirect(path), null, `${path} should render as-is for a teacher`)
}

// ── Learner-only pages are NOT in this table, on purpose ─────────────
// They are answered by LearnerOnlyRoute's refusal card, which is the right
// answer for a URL somebody typed or bookmarked. Silently redirecting a
// typed /dashboard would trade a clear "no" for a confusing "somewhere
// else" — see src/utils/navigation.js, which states the rule both halves
// share.
for (const learnerOnly of ['/dashboard', '/notes', '/notes/abc', '/quizzes', '/daily', '/progress']) {
  assert.ok(isLearnerOnlyPath(learnerOnly), `fixture drift: ${learnerOnly} is no longer learner-only`)
  assert.equal(
    resolveTeacherRedirect(learnerOnly), null,
    `${learnerOnly} is refused by LearnerOnlyRoute; redirecting it too would hide the refusal`,
  )
}

/* ══ Properties that hold for every audience ═════════════════════════ */

// ── A prefix must not match a different word that merely starts the same ──
for (const audience of PORTAL_AUDIENCES) {
  for (const [from] of TABLES[audience]) {
    assert.equal(
      resolvePortalRedirect(audience, `${from}x`), null,
      `${from}x is a different route and must not match ${from} for a ${audience}`,
    )
  }
}
assert.equal(resolveParentRedirect('/profiles'), null)
assert.equal(resolveParentRedirect('/dashboards'), null)
assert.equal(resolveTeacherRedirect('/profiles'), null)

// ── Malformed input ──────────────────────────────────────────────────
for (const audience of PORTAL_AUDIENCES) {
  for (const bad of ['', null, undefined, 42, {}]) {
    assert.equal(
      resolvePortalRedirect(audience, bad), null,
      `${String(bad)} should not redirect a ${audience}`,
    )
  }
}
// An audience nobody declared redirects nothing, rather than throwing on a
// missing table — the guard reads a live role and a new one must not 500.
for (const audience of [null, undefined, 'learner', 'admin', 'nonsense']) {
  assert.equal(resolvePortalRedirect(audience, '/profile'), null, `${String(audience)} has no table`)
}

// ── No redirect can bounce ───────────────────────────────────────────
// Every destination must itself resolve to null FOR THE AUDIENCE THAT WAS
// SENT THERE, or the guard would send an account back and forth forever.
// This is the property that made the guard safe to mount above the whole
// route table rather than per route.
//
// Own-audience only, and deliberately: `/settings/profile` is where a
// teacher is sent AND a route a parent is moved off, which is correct —
// an account has exactly one audience, so the two rules can never both
// apply to the same session. Asserting it across audiences would be
// asserting that the portals share a route map, which is the opposite of
// what this file is for.
for (const audience of PORTAL_AUDIENCES) {
  for (const [, to] of TABLES[audience]) {
    assert.equal(
      resolvePortalRedirect(audience, to), null,
      `${to} is a ${audience} destination and must not itself redirect a ${audience}`,
    )
  }
}

// ── …and no destination is a learner-only page ───────────────────────
// The whole point is to stop rendering another portal's screen. A
// destination LearnerOnlyRoute refuses would land the account on the
// refusal card instead — a different wrong screen.
for (const audience of PORTAL_AUDIENCES) {
  for (const [, to] of TABLES[audience]) {
    assert.ok(!isLearnerOnlyPath(to), `${to} is learner-only and cannot be a ${audience} destination`)
  }
}

// ── Every destination is inside the audience's own portal ────────────
// The guardian lands on the screen that answers what they were asking,
// inside the shell that knows who they are; so does the teacher.
for (const [, to] of PARENT_ROUTE_REDIRECTS) {
  assert.ok(to.startsWith('/family'), `${to} must be a family route`)
}
for (const [, to] of TEACHER_ROUTE_REDIRECTS) {
  assert.ok(
    to.startsWith('/teacher') || to.startsWith('/settings/'),
    `${to} must be a teacher route — /teacher/* or a /settings/* panel, both of `
    + 'which render inside TeacherLayout',
  )
}

/* ══ portalAudience ══════════════════════════════════════════════════ */

assert.equal(portalAudience({ role: 'teacher' }), 'teacher')
assert.equal(portalAudience('teacher'), 'teacher')
assert.equal(portalAudience({ isTeacher: true }), 'teacher')
assert.equal(portalAudience({ role: 'parent' }), 'parent')
assert.equal(portalAudience({ isParent: true }), 'parent')
assert.equal(portalAudience({ role: 'learner' }), null)
assert.equal(portalAudience({ role: 'student' }), null)
assert.equal(portalAudience(null), null)
assert.equal(portalAudience({ role: 'nonsense' }), null)
// Admins FIRST. AuthContext sets isTeacher true for super-admins, so an
// audience resolved teacher-first would move every admin into the teacher
// shell — and admins keep the learner surfaces on purpose (support).
assert.equal(portalAudience({ role: 'admin' }), null)
assert.equal(portalAudience({ role: 'superAdmin' }), null)
assert.equal(portalAudience({ isAdmin: true, isTeacher: true }), null)
assert.equal(portalAudience({ role: 'superAdmin', isTeacher: true }), null)
assert.equal(crossesPortals({ isAdmin: true, isTeacher: true }, '/profile'), false)
assert.equal(crossesPortals({ role: 'teacher' }, '/profile'), true)
assert.equal(crossesPortals({ role: 'learner' }, '/profile'), false)

/* ══ Sign-in lands in the account's own portal ═══════════════════════ */

// The report: "every time I log in to the teacher's portal, it brings me to
// this page". ProtectedRoute stashes /profile, Login honours the stash, and
// /profile was not learner-only — so the correction never fired.
assert.equal(resolvePostAuthPath({ role: 'teacher' }, '/profile'), '/teacher')
assert.equal(resolvePostAuthPath({ role: 'teacher' }, '/my-badges'), '/teacher')
assert.equal(resolvePostAuthPath({ role: 'teacher' }, '/subscription'), '/teacher')
// Discarded for the landing page, NOT mapped to the guard's destination:
// sign-in is the one moment when the account's own home is what was asked
// for. (Mid-session the guard still maps — there they asked for the page.)
assert.notEqual(resolvePostAuthPath({ role: 'teacher' }, '/profile'), '/settings/profile')
// A teacher page still returns them to that page.
assert.equal(
  resolvePostAuthPath({ role: 'teacher' }, '/teacher/assessment-papers/x/edit?step=quiz'),
  '/teacher/assessment-papers/x/edit?step=quiz',
)
assert.equal(resolvePostAuthPath({ role: 'teacher' }, '/settings/profile'), '/settings/profile')
// Nobody else's behaviour moved on a path their own portal owns.
assert.equal(resolvePostAuthPath({ role: 'learner' }, '/profile'), '/profile')
assert.equal(resolvePostAuthPath({ role: 'admin' }, '/profile'), '/profile')
assert.equal(resolvePostAuthPath({ role: 'parent' }, '/profile'), '/family')

// ── The landing itself never redirects ───────────────────────────────
// Whatever comes back is somewhere the account can STAY: neither the
// learner guard nor the portal guard has a reason to move them again. That
// is the loop this whole function exists to prevent.
const STASHES = [
  null, '', '/profile', '/my-badges', '/my-subscription', '/subscription',
  '/ask-a-grown-up', '/dashboard', '/notes/abc', '/settings', '/offline',
  '/papers/g7-science', '/teacher/help', '/family/children', '//evil.example.com',
]
for (const role of ['teacher', 'parent', 'learner', 'admin', 'nonsense']) {
  for (const from of STASHES) {
    const target = resolvePostAuthPath({ role }, from, '/')
    assert.equal(
      resolvePortalRedirect(portalAudience({ role }), target), null,
      `sign-in as ${role} from ${String(from)} lands on ${target}, which the portal guard redirects`,
    )
    if (!['learner', 'student', 'admin', 'superAdmin'].includes(role)) {
      assert.ok(
        !isLearnerOnlyPath(target),
        `sign-in as ${role} from ${String(from)} lands on ${target}, which LearnerOnlyRoute refuses`,
      )
    }
  }
}

/* ══ The guard can fail ══════════════════════════════════════════════ */

// Mutation check: the exact pre-fix behaviour must be detectable here, or
// this file would have passed against the code that shipped the bug. Before
// the fix `/profile` had no teacher rule at all, which is this:
assert.notEqual(
  resolvePortalRedirect('teacher', '/profile'), null,
  'A teacher on /profile must be redirected — that IS the reported bug',
)
assert.equal(
  getRoleLandingPath({ role: 'teacher' }), '/teacher',
  'The teacher landing page is /teacher; the post-auth assertions above rest on it',
)

console.log(
  `✓ portal redirects — ${PARENT_ROUTE_REDIRECTS.length} parent / `
  + `${TEACHER_ROUTE_REDIRECTS.length} teacher rules resolve into the account's own `
  + 'portal, nothing bounces, and sign-in lands somewhere it can stay',
)
