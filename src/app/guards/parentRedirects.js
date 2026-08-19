/**
 * Where a parent session goes when it lands on a learner route.
 *
 * ── The failure this closes ─────────────────────────────────────────
 *
 * `/family/account` → "Alerts you receive" → "Email and push alerts"
 * navigated to `/settings?section=notifications`. That route renders
 * `ZedExamsSettings`, which coerces any role outside
 * `['admin','teacher','learner']` to `learner` — so a guardian got the
 * learner top nav, a character-avatar picker built for children, and a
 * heading reading "Signed in as Learner. Manage your preferences below."
 *
 * The link itself is fixed (it points at `/family/account/alerts` now),
 * but fixing one link is not the same as closing the hole. A notification
 * action, an old email, a bookmark, a support reply or the next link
 * somebody adds can all put a parent on a learner route again, and every
 * one of those produces the same screen. So the redirect is a property of
 * the ROUTE rather than a property of the links into it.
 *
 * ── Pure, so the mapping is testable ────────────────────────────────
 *
 * `resolveParentRedirect` is a function of the pathname. The React guard
 * around it does nothing but call it and render `<Navigate>`.
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
  ['/ask-zed', '/family'],
  // The child's "ask a grown-up" screen. A guardian who lands here is
  // the person being asked, so the useful destination is the plan page
  // — and the ask itself would be refused for them server-side anyway.
  ['/ask-a-grown-up', '/family/plan'],
])

/**
 * @param {string} pathname
 * @returns {string|null} where to send a parent, or null to render as-is.
 *   Null rather than a default so the caller can tell "no rule applies"
 *   from "the rule says go home" — a guard that redirected everything it
 *   did not recognise would trap a parent on /family for any route this
 *   list has not thought about, including public ones.
 */
export function resolveParentRedirect(pathname) {
  const path = typeof pathname === 'string' ? pathname : ''
  if (!path) return null

  const match = PARENT_ROUTE_REDIRECTS
    .filter(([from]) => path === from || path.startsWith(`${from}/`) || path.startsWith(`${from}?`))
    .sort((a, b) => b[0].length - a[0].length)[0]

  if (!match) return null
  // Already where we would send them: no redirect, or the guard would
  // bounce a parent between two routes forever.
  const [, to] = match
  return path === to || path.startsWith(`${to}/`) ? null : to
}
