export function getRoleLandingPath(profileOrFlags, fallback = '/dashboard') {
  const role = typeof profileOrFlags === 'string'
    ? profileOrFlags
    : profileOrFlags?.role

  if (profileOrFlags?.isAdmin || role === 'admin' || role === 'superAdmin') return '/admin'
  if (profileOrFlags?.isTeacher || role === 'teacher') return '/teacher'
  if (profileOrFlags?.isParent || role === 'parent') return '/family'
  if (role === 'learner' || role === 'student') return '/dashboard'
  return fallback
}

/**
 * First path segment of every route App.jsx wraps in <LearnerOnlyRoute>.
 *
 * A teacher account cannot open any of these — the two portals are separate,
 * so LearnerOnlyRoute renders "Teacher accounts stay in the teacher portal"
 * instead of the page. That card is the right answer when a teacher types or
 * bookmarks a learner URL; it is the WRONG answer when the app itself sent
 * them there, which is what this list exists to prevent (see
 * resolvePostAuthPath).
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
  'lessons',
  'my-badges',
  'my-results',
  'my-stats',
  'notes',
  'practise',
  'quiz',
  'quizzes',
  'results',
  'search',
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
 * card, no bounce, no loop. Discarding is deliberately narrow: only teachers,
 * and only for learner-only paths, both of which are decidable from the
 * profile alone. Parents reach the learner portal on plan state this function
 * cannot see, so their `from` is left alone and the route guard decides.
 */
export function resolvePostAuthPath(profileOrFlags, fromPath, fallback = '/dashboard') {
  const landing = getRoleLandingPath(profileOrFlags, fallback)
  if (!isSafeInAppPath(fromPath)) return landing

  const role = typeof profileOrFlags === 'string' ? profileOrFlags : profileOrFlags?.role
  const isAdmin = profileOrFlags?.isAdmin || role === 'admin' || role === 'superAdmin'
  const isTeacher = profileOrFlags?.isTeacher || role === 'teacher'

  // Admins pass through the learner portal by design, so only a non-admin
  // teacher is turned away.
  if (isTeacher && !isAdmin && isLearnerOnlyPath(fromPath)) return landing

  return fromPath
}
