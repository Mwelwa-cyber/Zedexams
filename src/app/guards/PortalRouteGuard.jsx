/**
 * PortalRouteGuard — a session never renders another portal's screen.
 *
 * Mounted once, above the route table, rather than wrapped around each
 * route. That is the point: the failures it closes were not one bad link
 * but a whole SHAPE of link.
 *
 *   • Anything that puts a guardian on `/settings`, `/my-subscription`,
 *     `/profile` or `/dashboard` renders the learner shell and (because
 *     `ZedExamsSettings` coerces an unknown role to `learner`) tells them
 *     they are "Signed in as Learner".
 *   • Anything that puts a TEACHER on `/profile` renders the learner
 *     `Navbar` — Notes, Lessons, Practise — over a page whose own back
 *     link reads "Back to Teacher". Their profile is `/settings/profile`,
 *     inside the teacher shell.
 *
 * Fixing the one link each portal owned would leave every notification
 * action, old email, bookmark and future link producing the same screen.
 *
 * It is a redirect rather than a refusal because every route in each map
 * has an equivalent in the account's own portal: they get the screen that
 * answers the question they were asking, not a wall. Learner-only pages
 * with no equivalent are NOT in these maps — `LearnerOnlyRoute` answers
 * those with the refusal card, which is the right answer for a URL
 * somebody typed or bookmarked (see `src/utils/navigation.js`).
 *
 * The decision lives in `src/utils/portalRedirects.js` so the mapping is a
 * pure, tested function; this component only reads the role and the
 * pathname.
 *
 * Deliberately narrow:
 *   • Admins are exempt. `portalAudience` returns null for them — and it
 *     checks admin FIRST, because `isTeacher` is true for super-admins
 *     (AuthContext), so asking about teachers first would move every
 *     admin into the teacher shell. An admin viewing a learner surface
 *     for support keeps doing so; that is the job.
 *   • Only while the profile is loaded. Redirecting on an absent profile
 *     would bounce every signed-out visitor off the public routes in the
 *     maps on the first frame.
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { portalAudience, resolvePortalRedirect } from '../../utils/portalRedirects'

export default function PortalRouteGuard({ children }) {
  const { userProfile, isAdmin, isTeacher, isParent } = useAuth()
  const { pathname } = useLocation()

  if (!userProfile) return children

  // Pass the context flags, not the profile alone: `isTeacher` there is the
  // resolved fact (it includes super-admins, which is exactly why `isAdmin`
  // has to travel with it), and `isParent`/`isAdmin` likewise. Reading
  // `userProfile.role` on its own here would disagree with every other
  // guard in the app about who a super-admin is.
  const audience = portalAudience({ role: userProfile.role, isAdmin, isTeacher, isParent })
  if (!audience) return children

  const to = resolvePortalRedirect(audience, pathname)
  if (!to) return children

  return <Navigate to={to} replace />
}
