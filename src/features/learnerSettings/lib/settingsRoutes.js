/**
 * Learner settings — the route table, and the redirect that keeps the old
 * links working.
 *
 * ## Why these are routes and not `?section=`
 *
 * `/settings?section=account` was one page holding about ten unrelated
 * concerns, so "Name & avatar" and "Delete account" were the same URL — and
 * the URL a child was sent to in order to change their nickname also carried
 * their invoices, their payment history and an irreversible delete button.
 * Splitting them is not tidiness: it is what lets a link mean one thing, a back
 * button return to one place, and a screen be responsible for one decision.
 *
 * A real route also gives each screen its own entry in the history stack, which
 * `?section=` never did — the child who opened Delete and pressed back landed
 * outside Settings entirely.
 *
 * ## Every path here has something behind it
 *
 * The temptation with a split like this is to declare the full menu and stub
 * what does not exist yet. A settings item that opens an empty screen is worse
 * than one that is absent: the child has been told the setting exists and then
 * shown that it does not work. So this table lists seven paths and there are
 * seven screens.
 *
 * ## The legacy parameter
 *
 * `?section=` is written into emails, push notification deep links and the
 * parent app's own copy ("your child finds this under Settings → Guardian").
 * Those cannot be edited after the fact, so every value the app ever wrote
 * still resolves — to a path now, rather than to a scroll position. A value we
 * do not recognise lands on the Settings index, which is a fair answer to a
 * link we cannot place; dropping a child on an unrelated screen is not.
 */

/** The learner settings paths, relative to `/settings`. */
export const SETTINGS_ROUTES = Object.freeze([
  Object.freeze({ path: 'profile', id: 'profile', label: 'Name & avatar' }),
  Object.freeze({ path: 'security', id: 'security', label: 'Password & security' }),
  Object.freeze({ path: 'notifications', id: 'notifications', label: 'Notifications' }),
  Object.freeze({ path: 'learning', id: 'learning', label: 'Learning' }),
  Object.freeze({ path: 'guardian', id: 'guardian', label: 'Your grown-up' }),
  Object.freeze({ path: 'data', id: 'data', label: 'Your data' }),
  Object.freeze({ path: 'help', id: 'help', label: 'Help & support' }),
  Object.freeze({ path: 'delete', id: 'delete', label: 'Delete account' }),
])

export const SETTINGS_PATHS = Object.freeze(SETTINGS_ROUTES.map((r) => `/settings/${r.path}`))

/**
 * Legacy `?section=` value → the path it now means.
 *
 * `account` maps to `profile` rather than to a combined screen, because the
 * links out in the world that carry it were written to reach personal details.
 * The other half of what `account` used to open — data export and delete —
 * are their own routes, reachable from the index, and a link that used to land
 * on both now lands on the harmless one. That is the right way round.
 */
const SECTION_TO_PATH = Object.freeze({
  account: 'profile',
  profile: 'profile',
  security: 'security',
  privacy: 'security',
  notifications: 'notifications',
  learning: 'learning',
  parent: 'guardian',
  guardian: 'guardian',
  data: 'data',
  help: 'help',
  delete: 'delete',
  // Sections the learner app no longer has a screen for. They resolve to the
  // index rather than to nothing: `premium` and `progress` were dashboard cards
  // in the retired settings dashboard, and `appearance`, `accessibility` and
  // `ai` are rows on the Settings index itself.
  appearance: '',
  accessibility: '',
  ai: '',
  premium: '',
  progress: '',
})

/**
 * The path a legacy `?section=` should redirect to.
 *
 * @param {string|null|undefined} section
 * @return {string} an absolute path under /settings
 */
export function redirectForSection(section) {
  const key = String(section || '').trim().toLowerCase()
  if (!key) return '/settings'
  const path = SECTION_TO_PATH[key]
  if (path === undefined) return '/settings'
  return path ? `/settings/${path}` : '/settings'
}

/** True when this legacy section had a screen of its own to redirect to. */
export function sectionHasRoute(section) {
  return redirectForSection(section) !== '/settings'
}
