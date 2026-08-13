/**
 * Route-derived active state for the teacher sidebar and its mobile drawer.
 *
 * Both surfaces used to carry their own copy of this rule, which is how they
 * drifted: the drawer's copy was a hand-kept mirror of the sidebar's, and a
 * comment saying "mirrors isNavActive in Sidebar.jsx" is not a mechanism.
 * One module, two callers.
 *
 * The rule is LONGEST MATCH WINS, not first match. Prefix matching alone is
 * ambiguous the moment one nav destination is a prefix of another: on
 * /teacher/library/abc123 both "My Library" (/teacher/library) and any future
 * /teacher/library/… entry would match, and whichever the config happened to
 * list first would light up. Scoring by matched length makes the answer a
 * property of the routes rather than of the array order.
 *
 * Active state is therefore computed for the whole item list at once — an
 * item cannot know it is the best match on its own.
 */

/**
 * How specifically `item` matches `pathname`, as the number of characters of
 * the path it claims. -1 means no match, so it can never win a Math.max.
 *
 * `activePrefix` widens matching for an item whose destination is one page of
 * a route family — the Lesson Plans entry points at /teacher/lesson-plans/new
 * but must stay lit on /teacher/lesson-plans/:id/edit. It scores on the
 * PREFIX's length, not the destination's, because the prefix is what actually
 * matched.
 */
function matchScore(pathname, item) {
  if (!item || !item.to) return -1

  const { to, activePrefix } = item

  if (activePrefix && (pathname === activePrefix || pathname.startsWith(`${activePrefix}/`))) {
    return activePrefix.length
  }

  const path = to.split('?')[0]

  // '/teacher' is the dashboard itself, so it matches exactly rather than
  // prefixing every teacher route. The mock preview lights it too, so the
  // sidebar never looks unanchored there.
  if (path === '/teacher') {
    return pathname === '/teacher' || pathname === '/teacher/dashboard-preview' ? path.length : -1
  }

  // '/settings' is exact so Settings and Profile ('/settings/profile') don't
  // both light up. Longest-match would now resolve that on its own, but the
  // exactness is also what keeps Settings dark on every OTHER /settings/*
  // panel that has no nav entry of its own.
  if (path === '/settings') {
    return pathname === '/settings' ? path.length : -1
  }

  if (pathname === path || pathname.startsWith(`${path}/`)) return path.length

  return -1
}

/**
 * The `to` of the single item that best matches `pathname`, or null when
 * nothing does. Ties (two items on the same destination) resolve to the first,
 * which the config's no-duplicate-destination test already rules out.
 */
export function resolveActiveNavTarget(pathname, items = []) {
  let best = null
  let bestScore = -1
  for (const item of items) {
    const score = matchScore(pathname, item)
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return bestScore < 0 ? null : best.to
}

/** Flattens grouped nav config to the flat item list the resolver takes. */
export function flattenNavItems(groups = []) {
  return groups.flatMap((group) => group.items || [])
}

/**
 * Convenience for the two renderers: `to` → true for the winning item only.
 * Built once per render and read per item, so the O(n) scan doesn't become
 * O(n²) across the list.
 */
export function buildActiveMatcher(pathname, groups) {
  const target = resolveActiveNavTarget(pathname, flattenNavItems(groups))
  return (to) => Boolean(to) && to === target
}
