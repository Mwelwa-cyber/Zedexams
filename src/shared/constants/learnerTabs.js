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

/**
 * `learnerOnly` records which tabs `LearnerOnlyRoute` refuses to a
 * non-learner. It is NOT decoration and it is NOT a second copy of
 * `LEARNER_ONLY_SEGMENTS`: `test:learner-tabs` reads that list out of
 * `src/utils/navigation.js` and fails if a tab's flag disagrees with it, in
 * both directions. The flag lives here rather than being derived here
 * because `src/shared` is the bottom layer and may not reach `src/utils`
 * (which reaches an engine) — so the fact is written down beside the tabs
 * and a guard keeps it true.
 *
 * Two of the four tabs are open to everybody. That asymmetry is the whole
 * reason this matters: `/papers` and `/games` are public routes that mount
 * the learner shell, so the bar is drawn for teachers, guardians and
 * signed-out visitors as well as learners — see `resolveLearnerTabs`.
 */
/** @type {ReadonlyArray<{id: string, to: string, end: boolean, labelKey: string, label: string, learnerOnly: boolean}>} */
export const LEARNER_TABS = Object.freeze([
  { id: 'home', to: '/dashboard', end: true, labelKey: 'nav.dashboard', label: 'Home', learnerOnly: true },
  { id: 'papers', to: '/papers', end: false, labelKey: 'nav.papers', label: 'Papers', learnerOnly: false },
  { id: 'notes', to: '/notes', end: false, labelKey: 'nav.notes', label: 'Notes', learnerOnly: true },
  { id: 'games', to: '/games', end: false, labelKey: 'nav.games', label: 'Games', learnerOnly: false },
].map(Object.freeze))

/**
 * The tabs to draw for the account looking at them.
 *
 * ## The failure this closes
 *
 * `/papers` and `/games` are UNGUARDED and render inside `LearnerLayout`, so
 * the learner shell — and this bar — is what a teacher sees when they open
 * the past-paper archive. Home pointed at `/dashboard` and Notes at `/notes`,
 * and both are `LearnerOnlyRoute` pages, so the app's own navigation offered
 * a teacher two destinations it would then refuse. Tapping Home, which is the
 * obvious control for "take me back to my part of the app", answered
 * "Teacher accounts stay in the teacher portal" — drawn inside this very
 * shell, tab bar and all. That is the reported Android bug: on a phone this
 * bar IS the navigation, where on a desktop it is a sidebar beside a page
 * that has other ways out.
 *
 * `src/utils/navigation.js` already states the rule the fix follows: the
 * refusal card is right for a typed or bookmarked learner URL and wrong when
 * the app itself sent you there. So the bar stops sending.
 *
 * ## The two moves, and why it is not simply "hide the bar"
 *
 * `LearnerShell` carries no header of its own. Dropping the bar for a
 * non-learner would leave a teacher on `/papers` with no navigation at all —
 * trading a wrong door for no door. So:
 *
 *   - **Home is retargeted, never removed.** A tab labelled Home has to go
 *     home, and for a teacher home is `/teacher`. Retargeting is what makes
 *     the tap the user was already making do the thing they meant.
 *   - **Every other learner-only tab is dropped**, because there is no
 *     teacher equivalent of the learner Notes hub to point at, and an offer
 *     that ends in a refusal card is worse than no offer.
 *
 * `Papers` and `Games` are public, so they stay for everyone.
 *
 * ## `learnerRoutesOpen`
 *
 * The caller answers it with `canOpenLearnerRoutes` (one predicate, shared
 * with the guard). A SIGNED-OUT visitor is open, deliberately: they have no
 * account to be refused, `ProtectedRoute` sends them to sign in, and
 * `resolvePostAuthPath` returns them to the tab they tapped. Narrowing their
 * bar would break that funnel to fix a refusal they never meet.
 *
 * @param {{homePath?: string, learnerRoutesOpen?: boolean}} [audience]
 *   `homePath` is consulted ONLY when the account cannot open learner routes,
 *   so a signed-out caller never has to invent one.
 */
export function resolveLearnerTabs({ homePath = '/dashboard', learnerRoutesOpen = true } = {}) {
  if (learnerRoutesOpen) return LEARNER_TABS
  return Object.freeze(
    LEARNER_TABS
      .filter((tab) => tab.id === 'home' || !tab.learnerOnly)
      // `end: true` stays right for a retargeted Home: /teacher and /admin are
      // both real pages with children (/teacher/library, /admin/agents), and a
      // Home tab lit on every screen of the portal is the "hardcoded
      // active: true" bug in a different costume.
      .map((tab) => (tab.id === 'home' ? Object.freeze({ ...tab, to: homePath }) : tab)),
  )
}

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
