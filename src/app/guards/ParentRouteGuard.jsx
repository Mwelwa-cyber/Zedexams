/**
 * ParentRouteGuard — a parent session never renders a learner screen.
 *
 * Mounted once, above the route table, rather than wrapped around each
 * learner route. That is the point: the failure it closes was not one bad
 * link but a whole SHAPE of link — anything that puts a guardian on
 * `/settings`, `/my-subscription`, `/profile` or `/dashboard` renders the
 * learner shell and (because `ZedExamsSettings` coerces an unknown role to
 * `learner`) tells them they are "Signed in as Learner". Fixing the one
 * link the family app owned would leave every notification action, old
 * email, bookmark and future link producing the same screen.
 *
 * It is a redirect rather than a refusal because every route in the map
 * has a family equivalent: the guardian gets the screen that answers the
 * question they were asking, not a wall.
 *
 * The decision lives in `parentRedirects.js` so the mapping is a pure,
 * tested function; this component only reads the role and the pathname.
 *
 * Deliberately narrow:
 *   • Only `role === 'parent'`. An admin viewing a learner surface for
 *     support keeps doing so — that is the job.
 *   • Only while the profile is loaded. Redirecting on an absent profile
 *     would bounce every signed-out visitor off the public routes in the
 *     map on the first frame.
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { resolveParentRedirect } from './parentRedirects'

export default function ParentRouteGuard({ children }) {
  const { userProfile, isParent } = useAuth()
  const { pathname } = useLocation()

  if (!userProfile || !isParent) return children

  const to = resolveParentRedirect(pathname)
  if (!to) return children

  return <Navigate to={to} replace />
}
