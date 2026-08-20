/**
 * LEARNER_TABS — the learner information architecture, declared once.
 *
 * Four tabs, prototype-v3: Home · Papers · Notes · Games. Profile is not
 * one of them; it opens from the header avatar.
 *
 * ## Why this file exists
 *
 * The same four tabs were written out three times — `LearnerBottomNav`
 * (the `.lhx` shell), `MobileBottomNav` (the side door on the pages still
 * carrying the legacy `Navbar`), and a third copy inside
 * `PastPapersHub` — and the copies had already drifted in every way a
 * copy can:
 *
 *   - different labels reaching the screen (one resolved `nav.*` through
 *     i18n, two hardcoded English, so a Nyanja learner got a mixed bar);
 *   - different icons for the same destination;
 *   - and, worst, a different notion of ACTIVE. Two used `NavLink`, which
 *     asks the router; the Papers copy hardcoded `active: true` on its own
 *     row, so that bar could never highlight anything except Papers and
 *     never stopped highlighting it.
 *
 * `docs/learner/LEARNER_UI_AUDIT.md` L-04, L-25.
 *
 * ## What is shared and what is not
 *
 * The IA is shared — the destinations, their order, their labels. The
 * RENDERING is not, and deliberately: the learner shell draws these in
 * the `.lhx` design system with `LearnerIcon`, while the legacy-chrome
 * bar draws them in the older Tailwind system with lucide glyphs. Those
 * are two design systems that genuinely coexist today (five routes still
 * mount the legacy chrome — see `scripts/test-learner-chrome.mjs`), and
 * pretending otherwise would mean one bar looking wrong on half its
 * mounts.
 *
 * So each tab carries an `id`, and each renderer maps that id to an icon
 * from its own set. When the last legacy-chrome route migrates, the
 * second renderer goes with it and this file stays as it is.
 *
 * `label` is the English fallback for a surface with no i18n context; it
 * must agree with `src/i18n/locales/en/common.json`'s `nav.*`, which
 * `learnerTabs.test.js` checks rather than trusts.
 */

/** @type {ReadonlyArray<{id: string, to: string, end: boolean, labelKey: string, label: string}>} */
export const LEARNER_TABS = Object.freeze([
  { id: 'home', to: '/dashboard', end: true, labelKey: 'nav.dashboard', label: 'Home' },
  { id: 'papers', to: '/papers', end: false, labelKey: 'nav.papers', label: 'Papers' },
  { id: 'notes', to: '/notes', end: false, labelKey: 'nav.notes', label: 'Notes' },
  { id: 'games', to: '/games', end: false, labelKey: 'nav.games', label: 'Games' },
].map(Object.freeze))

/**
 * Does `pathname` sit under one of the tabs, and which?
 *
 * Longest match wins, so `/papers/12/quiz` resolves to Papers rather than
 * to nothing. Returns null for a learner route that is not under any tab
 * (`/progress`, `/profile`, `/daily`) — a bar with no tab lit is the
 * honest answer there, and is what `NavLink` already produces.
 *
 * Exported for the surfaces that cannot use `NavLink` (a bar rendered
 * outside a Router, a test asserting which tab a path belongs to) so that
 * "which tab am I on" has one answer rather than a hardcoded flag.
 */
export function activeLearnerTab(pathname) {
  const path = String(pathname || '')
  let best = null
  for (const tab of LEARNER_TABS) {
    const matches = tab.end
      ? path === tab.to
      : path === tab.to || path.startsWith(`${tab.to}/`)
    if (matches && (!best || tab.to.length > best.to.length)) best = tab
  }
  return best ? best.id : null
}
