/**
 * The portals are separate, and a session never renders another portal's
 * screen.
 *
 * ── The two failures this closes ────────────────────────────────────
 *
 * **The parent one, first.** `/family/account` → "Alerts you receive" →
 * "Email and push alerts" navigated to `/settings?section=notifications`.
 * That route renders `ZedExamsSettings`, which coerces any role outside
 * `['admin','teacher','learner']` to `learner` — so a guardian got the
 * learner top nav, a character-avatar picker built for children, and a
 * heading reading "Signed in as Learner. Manage your preferences below."
 *
 * **The teacher one, on the same shape.** `/profile` is role-branched for
 * learners only: every other role gets the shared `ProfilePage` under the
 * legacy `Navbar`. So a teacher who opened their account page was handed
 * the LEARNER header — Notes, Lessons, Practise — over a page whose own
 * back link read "Back to Teacher". And because a route guard stashes the
 * page you asked for and `Login` honours the stash, a teacher with
 * `/profile` in a restored tab or a bookmark was returned to it on every
 * single sign-in. Their own profile is `/settings/profile`, inside the
 * teacher shell, and always was.
 *
 * Fixing one link is not the same as closing the hole. A notification
 * action, an old email, a bookmark, a support reply or the next link
 * somebody adds can all put an account on another portal's route again,
 * and every one of those produces the same screen. So the redirect is a
 * property of the ROUTE rather than a property of the links into it.
 *
 * ── One table per audience, one matcher ─────────────────────────────
 *
 * Two audiences with the same problem is one mechanism, not two modules.
 * A `teacherRedirects.js` copied from a `parentRedirects.js` would pass
 * its own tests and drift from its twin the first time the matching rule
 * changed — the prefix/query handling below is exactly the fiddly part
 * that would drift. So there is one `resolvePortalRedirect`, and an
 * audience picks a table.
 *
 * ── Pure, so the mapping is testable ────────────────────────────────
 *
 * `resolvePortalRedirect` is a function of the audience and the pathname.
 * The React guard around it does nothing but read the role and render
 * `<Navigate>`. `test:portal-redirects` holds the properties that make it
 * safe to mount above the whole route table — above all that no
 * destination is itself redirected, or an account would bounce forever.
 *
 * Lives in `src/utils/` rather than beside the guard because
 * `resolvePostAuthPath` reads it too: the sign-in landing and the guard
 * must agree about which paths belong to which portal, and `src/app/`
 * is above `src/utils/` in the layering, so the guard imports down.
 */

/**
 * Learner (and shared-surface) routes a parent must never render, mapped
 * to the family screen that answers the same question.
 *
 * Prefix-matched, longest first, so `/settings/profile` follows
 * `/settings`. A route with no family equivalent maps to `/family` —
 * landing on the family home is a fair answer to "this screen is not for
 * you", where rendering a learner shell is not.
 */
export const PARENT_ROUTE_REDIRECTS = Object.freeze([
  ['/settings', '/family/account/alerts'],
  ['/my-subscription', '/family/account/billing'],
  ['/subscription', '/family/account/billing'],
  ['/profile', '/family/account'],
  ['/dashboard', '/family'],
  ['/notifications', '/family/notifications'],
  // The child's "ask a grown-up" screen. A guardian who lands here is
  // the person being asked, so the useful destination is the plan page
  // — and the ask itself would be refused for them server-side anyway.
  ['/ask-a-grown-up', '/family/plan'],
])

/**
 * Shared surfaces a teacher must never render, mapped to the teacher
 * screen that answers the same question.
 *
 * Deliberately SHORT, and the shortness is the design. It lists only the
 * routes that would otherwise draw a learner screen around a teacher —
 * not every learner route. `/dashboard`, `/notes`, `/quizzes` and the
 * rest are `<LearnerOnlyRoute>` pages that answer a teacher with the
 * refusal card, and that stays: `src/utils/navigation.js` records the
 * rule those two halves share — the card is right when somebody TYPES or
 * bookmarks a learner URL, and wrong when the app itself put them there.
 * A silent redirect off a URL a teacher deliberately typed would trade a
 * clear "no" for a confusing "somewhere else".
 *
 * `/settings` is deliberately absent for the same reason: App.jsx already
 * branches it by role and gives a teacher `TeacherSettings` inside
 * `TeacherLayout`. It is a teacher route, not a shared one.
 *
 * `/offline` is absent too, and that one is a genuine shared surface
 * rather than an omission: the Offline Library holds a teacher's
 * downloaded worksheets and lesson notes as readily as a learner's
 * quizzes. Only its chrome was wrong, so App.jsx renders it in
 * `TeacherLayout` for a teacher instead of redirecting them off it.
 */
export const TEACHER_ROUTE_REDIRECTS = Object.freeze([
  // The reported screen. A teacher's profile is the Settings > Me > Profile
  // panel; `/profile` is the learner/admin one.
  ['/profile', '/settings/profile'],
  // `<Navigate to="/profile">` — the same screen, one hop further out. The
  // guard sits above the route table, so it answers before the hop.
  ['/my-badges', '/settings/profile'],
  // MySubscriptionRoute forwards teachers here as well. Listed anyway,
  // because this table is meant to be the whole statement of "a teacher
  // never renders a learner screen" — a map with a known hole in it is
  // the thing that rots.
  ['/my-subscription', '/teacher/subscription'],
  ['/subscription', '/teacher/subscription'],
  // A child's "ask a grown-up" screen: no price, no checkout, and an ask
  // that would be refused for a teacher server-side anyway.
  ['/ask-a-grown-up', '/teacher/subscription'],
])

const TABLES = Object.freeze({
  parent: PARENT_ROUTE_REDIRECTS,
  teacher: TEACHER_ROUTE_REDIRECTS,
})

/** Every audience `resolvePortalRedirect` knows about. */
export const PORTAL_AUDIENCES = Object.freeze(Object.keys(TABLES))

/**
 * Which redirect table applies to an account, or null for none.
 *
 * Admins FIRST, and they get null: `isTeacher` is true for super-admins
 * (AuthContext), so asking about teachers first would move every admin
 * into the teacher shell. An admin opening a learner surface for support
 * is the job, not a mistake — the same exemption `LearnerOnlyRoute` makes.
 *
 * @param {object|string|null} profileOrFlags a user profile, the auth-context
 *   flags, or a bare role string — the shapes `getRoleLandingPath` takes.
 */
export function portalAudience(profileOrFlags) {
  const profile = typeof profileOrFlags === 'string' ? { role: profileOrFlags } : profileOrFlags
  const role = profile?.role
  if (profile?.isAdmin || role === 'admin' || role === 'superAdmin') return null
  if (profile?.isParent || role === 'parent') return 'parent'
  if (profile?.isTeacher || role === 'teacher') return 'teacher'
  return null
}

/**
 * @param {string|null} audience one of PORTAL_AUDIENCES, or null/unknown for
 *   an account no table covers.
 * @param {string} pathname
 * @returns {string|null} where to send this account, or null to render as-is.
 *   Null rather than a default so the caller can tell "no rule applies"
 *   from "the rule says go home" — a guard that redirected everything it
 *   did not recognise would trap an account on its landing page for any
 *   route the table has not thought about, including public ones.
 */
export function resolvePortalRedirect(audience, pathname) {
  const table = TABLES[audience]
  if (!table) return null
  const path = typeof pathname === 'string' ? pathname : ''
  if (!path) return null

  const match = table
    .filter(([from]) => path === from || path.startsWith(`${from}/`) || path.startsWith(`${from}?`))
    .sort((a, b) => b[0].length - a[0].length)[0]

  if (!match) return null
  // Already where we would send them: no redirect, or the guard would
  // bounce an account between two routes forever.
  const [, to] = match
  return path === to || path.startsWith(`${to}/`) ? null : to
}

/** @deprecated-shape convenience wrappers — one matcher, two audiences. */
export const resolveParentRedirect = (pathname) => resolvePortalRedirect('parent', pathname)
export const resolveTeacherRedirect = (pathname) => resolvePortalRedirect('teacher', pathname)

/**
 * True when this account would be moved off `pathname` by the guard above.
 *
 * Read by `resolvePostAuthPath`: a page the app is about to redirect away
 * from is not a landing, and sign-in is the one moment when the account's
 * own home is the right answer rather than the mapped equivalent.
 */
export function crossesPortals(profileOrFlags, pathname) {
  return resolvePortalRedirect(portalAudience(profileOrFlags), pathname) !== null
}
