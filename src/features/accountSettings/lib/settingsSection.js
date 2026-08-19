/**
 * Which settings section a /settings URL is asking for.
 *
 * ── The bug this exists to close ────────────────────────────────────
 *
 * `ZedExamsSettings` read `?tab=` and nothing else. Every other part of
 * the product that links into settings writes `?section=` — the learner
 * settings dashboard uses `section` as its own parameter, and so did the
 * parent app's "Email and push alerts" row, which pointed at
 * `/settings?section=notifications`. The parameter was simply ignored,
 * so the link opened whatever tab happened to be first (Profile), with
 * no error and nothing to suggest the URL had asked for something else.
 * A deep link that silently lands somewhere else is worse than one that
 * fails: the person follows it, does not find what they were sent for,
 * and concludes the setting does not exist.
 *
 * ── Two vocabularies, one resolver ──────────────────────────────────
 *
 * The section ids in `features/learnerSettings/sections.js` and the tab
 * ids in `zedexams-settings.jsx` were written separately and mostly, but
 * not exactly, agree. `SECTION_TO_TAB` records the places they differ
 * rather than renaming either set: the tab ids are in URLs already
 * (`/settings?tab=school` from the Assessment Studio) and the section
 * ids are in the learner dashboard's own routing.
 *
 * Resolution tries the alias first and the raw id second, so a section
 * with no alias for one role still resolves when that role happens to
 * have a tab of the same name — `account` is "My Account" (personal
 * details) to a learner and the delete-account tab to an admin, and each
 * gets the one their own tab list actually has.
 */

/**
 * Learner-dashboard section id → settings tab id, where they differ.
 * A `null` means the section has no tab on this page at all; the caller
 * falls back rather than inventing one.
 */
export const SECTION_TO_TAB = Object.freeze({
  // "My Account" is personal details, which this page calls Profile.
  account: 'profile',
  security: 'security',
  notifications: 'notifications',
  learning: 'learning',
  accessibility: 'accessibility',
  appearance: 'appearance',
  // Sections with no counterpart here. Named explicitly so the absence is
  // a recorded decision rather than a lookup that happened to miss.
  progress: null,
  ai: null,
  premium: null,
  help: null,
})

/** The canonical query parameter. `tab` is a legacy alias, read-only. */
export const SECTION_PARAM = 'section'
export const LEGACY_TAB_PARAM = 'tab'

/**
 * Resolve the tab to open.
 *
 * @param {object} args
 * @param {string} [args.tab]      raw `?tab=` value (legacy alias)
 * @param {string} [args.section]  raw `?section=` value (canonical)
 * @param {Array<{id: string}>} args.tabs  the tab list for this role
 * @returns {string|null} a tab id present in `tabs`, or null when the
 *   URL asked for nothing this role has. Null rather than a default, so
 *   the caller decides what "nothing asked for" means; it currently
 *   means the first tab.
 */
export function resolveSettingsTab({ tab, section, tabs } = {}) {
  const ids = (Array.isArray(tabs) ? tabs : []).map((t) => t?.id).filter(Boolean)
  const has = (id) => (id ? ids.includes(id) : false)

  // `tab` first: it is the older spelling and the one already sitting in
  // links out in the world, so an explicit `?tab=school` must not be
  // second-guessed by a `section` that arrived alongside it.
  if (has(tab)) return tab

  const cleaned = typeof section === 'string' ? section.trim() : ''
  if (!cleaned) return null

  const alias = Object.prototype.hasOwnProperty.call(SECTION_TO_TAB, cleaned)
    ? SECTION_TO_TAB[cleaned]
    : undefined

  if (has(alias)) return alias
  if (has(cleaned)) return cleaned
  return null
}

/**
 * The search params for a given tab: canonical `section`, and the legacy
 * `tab` removed so the two cannot disagree on the next render.
 *
 * Mutates and returns the URLSearchParams it is given, which is the shape
 * react-router's `setSearchParams(prev => …)` updater wants.
 */
export function applySettingsTabToParams(params, tabId) {
  if (tabId) params.set(SECTION_PARAM, tabId)
  else params.delete(SECTION_PARAM)
  params.delete(LEGACY_TAB_PARAM)
  return params
}
