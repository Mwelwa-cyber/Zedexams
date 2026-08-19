import { hasLearnerPortalAccess } from '../engines/payment-engine/subscriptionConfig.js'
import { isLearnerRole } from './permissions.js'

export function getRoleLandingPath(profileOrFlags, fallback = '/dashboard') {
  const role = typeof profileOrFlags === 'string'
    ? profileOrFlags
    : profileOrFlags?.role

  if (profileOrFlags?.isAdmin || role === 'admin' || role === 'superAdmin') return '/admin'
  if (profileOrFlags?.isTeacher || role === 'teacher') return '/teacher'
  if (profileOrFlags?.isParent || role === 'parent') return '/family'
  // The legacy 'student' spelling lands here too — read from the one set in
  // permissions.js, so this can never again say "learner" about a role that
  // AuthContext's isLearner calls something else.
  if (isLearnerRole(role)) return '/dashboard'
  return fallback
}

/**
 * First path segment of every route App.jsx wraps in <LearnerOnlyRoute>.
 *
 * A teacher account cannot open any of these, and nor can any other account
 * without learner-portal access — the portals are separate, so LearnerOnlyRoute
 * renders a refusal card instead of the page. That card is the right answer
 * when somebody types or bookmarks a learner URL; it is the WRONG answer when
 * the app itself sent them there, which is what this list exists to prevent
 * (see resolvePostAuthPath).
 *
 * Kept as first segments rather than full patterns because that is what a
 * stashed `from` location gives us, and it degrades safely: a new learner
 * route under an existing segment is covered the day it is added.
 * `test:learner-only-routes` reads App.jsx and fails if this drifts in either
 * direction — a learner-only segment missing here, or an entry here that no
 * longer names one.
 */
export const LEARNER_ONLY_SEGMENTS = Object.freeze([
  'calendar',
  'dashboard',
  'dashboard-preview',
  'exam',
  'exam-results',
  'exams',
  'guardian',
  'lessons',
  'my-badges',
  'my-results',
  'my-stats',
  'notes',
  'notifications',
  'quiz',
  'quizzes',
  'results',
  'progress',
  'search',
  'setup',
  'study-plan',
  'subjects',
  'timetable',
])

const LEARNER_ONLY = new Set(LEARNER_ONLY_SEGMENTS)

/**
 * True when `path` is an in-app path only the learner portal serves.
 *
 * Anything that is not a plain in-app path — an empty value, a protocol-
 * relative `//host` that would leave the site, an absolute URL — is not
 * classified here; resolvePostAuthPath discards those outright rather than
 * asking this.
 */
export function isLearnerOnlyPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  const segment = path.split(/[?#]/, 1)[0].split('/')[1] || ''
  return LEARNER_ONLY.has(segment)
}

/** A stashed `from` we are willing to navigate to at all. */
function isSafeInAppPath(path) {
  return typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//')   // protocol-relative — leaves the site
    && !path.startsWith('/\\')  // some engines normalise this to //
}

/**
 * Where to land a user once auth completes.
 *
 * A guard that bounces someone to /login or /verify-email stashes the page
 * they wanted in location.state.from, and honouring it is what makes a
 * refresh of /teacher/assessment-papers come back to the same page. But the
 * stash records what the BROWSER asked for, not what the account can open —
 * so a teacher who follows a learner's /notes/:id link (or restores an old
 * tab, or has one bookmarked) was signed in and then sent straight to a
 * learner route, where LearnerOnlyRoute blocked them. From the teacher's side
 * that reads as "I signed in and the app opened the wrong portal", because
 * that is exactly what happened.
 *
 * So the destination is checked against the role before it is used. A `from`
 * the account cannot open is discarded for the role's own landing page — no
 * card, no bounce, no loop.
 *
 * The check mirrors LearnerOnlyRoute rather than approximating it, and does so
 * by calling the same predicate the guard's `canAccessLearnerPortal` flag is
 * derived from. That is the whole point: an approximation that is stricter
 * strands somebody on their landing page when the page they asked for would
 * have opened, and one that is looser signs them in and drops them on a
 * refusal card — which is the reported bug. A parent with no learner-portal
 * access followed a learner `/notes/:id` link, and the stash sent them there
 * the moment they signed in, every time.
 *
 * Admins and learners are never redirected: the guard lets both through on
 * role alone, before plan state is consulted at all.
 */
export function resolvePostAuthPath(profileOrFlags, fromPath, fallback = '/dashboard') {
  const landing = getRoleLandingPath(profileOrFlags, fallback)
  if (!isSafeInAppPath(fromPath)) return landing

  if (!isLearnerOnlyPath(fromPath)) return fromPath
  return blockedFromLearnerPortal(profileOrFlags) ? landing : fromPath
}

/**
 * Would LearnerOnlyRoute turn this account away from a learner route?
 *
 * Kept beside `resolvePostAuthPath` because it exists only to answer that
 * question the same way the guard does — role first (admins and learners are
 * through before anything else is read), then teachers refused outright, then
 * everyone else on the plan predicate the guard's own flag comes from.
 */
function blockedFromLearnerPortal(profileOrFlags) {
  const profile = typeof profileOrFlags === 'string' ? { role: profileOrFlags } : profileOrFlags
  const role = profile?.role
  const isAdmin = profile?.isAdmin || role === 'admin' || role === 'superAdmin'
  const isLearner = profile?.isLearner || role === 'learner'

  if (isAdmin || isLearner) return false
  if (profile?.isTeacher || role === 'teacher') return true
  return !hasLearnerPortalAccess(profile)
}
