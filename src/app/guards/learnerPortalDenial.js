/**
 * What a blocked account is TOLD when LearnerOnlyRoute refuses a learner route.
 *
 * ── The failure this closes ─────────────────────────────────────────
 *
 * The refusal card was written for exactly one audience — a teacher — and
 * then rendered for every account the guard turns away. A parent without
 * learner-portal access who opened a learner link (a note their child sent,
 * a restored tab, a bookmark) was told "Teacher accounts stay in the teacher
 * portal" about an account that is not a teacher's, and handed a "Back to
 * Teacher Portal" button. Pressing it navigated to `/teacher`, where the
 * route guard read the real role and moved them to `/family` — so the one
 * button on the screen named a destination it never reached.
 *
 * Wrong copy and a lying button are the same bug: the card describes a role
 * it never looked up. So the audience is resolved from the profile, once,
 * here — and the destination comes out of the same resolution as the words,
 * which is what stops the two drifting apart again.
 *
 * ── The property that keeps the escape hatch an escape hatch ────────
 *
 * `actionPath` must never itself be a learner-only path, or the button
 * returns the account to this very card. That is checked in
 * `test:learner-portal-denial` against `LEARNER_ONLY_SEGMENTS`, not asserted
 * in prose — the default landing for an unrecognised role is `/dashboard`,
 * which IS learner-only, so the loop is one careless `getRoleLandingPath`
 * away rather than hypothetical.
 *
 * It was not hypothetical. `actionPath: '/'` satisfied that rule and looped
 * anyway, because '/' renders nothing of its own: RootRedirect resolves it BY
 * ROLE, and for a role nobody recognises that resolution is /dashboard. So the
 * test now walks the button AND the redirect the button lands on, and every
 * destination has to be somewhere the account can actually stay.
 */

/**
 * One entry per audience. `audience` is returned alongside the copy so a
 * caller (or a test) can key on the decision rather than on the words.
 */
export const LEARNER_PORTAL_DENIALS = Object.freeze({
  teacher: Object.freeze({
    audience: 'teacher',
    title: 'Teacher accounts stay in the teacher portal',
    body:
      'The teacher and learner experiences are separate. Your teacher account '
      + 'works from the teacher portal — the learner dashboard, quizzes, lessons '
      + 'and exams aren’t part of it.',
    actionLabel: 'Back to Teacher Portal',
    actionPath: '/teacher',
  }),
  parent: Object.freeze({
    audience: 'parent',
    title: 'This part of ZedExams belongs to your child',
    body:
      'The learner dashboard, quizzes, lessons and exams are opened from your '
      + 'child’s own account. From the family portal you can see how they are '
      + 'getting on, read their weekly report and manage what they can use.',
    actionLabel: 'Back to Family Portal',
    actionPath: '/family',
  }),
  other: Object.freeze({
    audience: 'other',
    title: 'This page is part of the learner app',
    body:
      'Your account doesn’t open the learner dashboard, quizzes, lessons and '
      + 'exams. Everything your account does have is on your home page.',
    // Deliberately NOT the role landing page: the fallback for a role this
    // app does not recognise is /dashboard, which is a learner route — the
    // button would land straight back on this card.
    // NOT '/'. That was the first answer here, on the reasoning that '/' is
    // not a learner-only path — true, and not sufficient, because '/' does not
    // RENDER anything: RootRedirect resolves it through getRoleLandingPath,
    // whose fallback for an unrecognised role is /dashboard, which is
    // learner-only, which is this card. The loop was one hop further out than
    // the check that was guarding against it.
    //
    // '/profile' terminates: it is ProtectedRoute-only, it re-resolves nothing
    // by role, and ParentRouteGuard already moves a guardian from it to their
    // own equivalent. An account whose role this app does not recognise can
    // always open it.
    actionLabel: 'Go to your account',
    actionPath: '/profile',
  }),
})

/**
 * @param {object|string|null} profileOrFlags a user profile, the auth-context
 *   flags, or a bare role string — the same shapes `getRoleLandingPath` takes,
 *   so a caller never has to know which one it is holding.
 * @returns {{audience: string, title: string, body: string, actionLabel: string, actionPath: string}}
 */
export function resolveLearnerPortalDenial(profileOrFlags) {
  const role = typeof profileOrFlags === 'string'
    ? profileOrFlags
    : profileOrFlags?.role

  // Teachers first: `isTeacher` is true for super-admins too, and an admin
  // never reaches this card — the guard let them through long before.
  if (profileOrFlags?.isTeacher || role === 'teacher') return LEARNER_PORTAL_DENIALS.teacher
  if (profileOrFlags?.isParent || role === 'parent') return LEARNER_PORTAL_DENIALS.parent
  return LEARNER_PORTAL_DENIALS.other
}
