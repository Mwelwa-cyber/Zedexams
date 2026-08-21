#!/usr/bin/env node
/**
 * The learner tab bar: one registry, and the three ways it can rot.
 *
 * `shared/constants/learnerTabs.js` replaced three hand-written copies of
 * the same four tabs (`docs/learner/LEARNER_UI_AUDIT.md` L-04, L-25). A
 * single array stops the copies drifting from EACH OTHER. It does nothing
 * about the array drifting from the things around it, which is what this
 * checks:
 *
 *   1. **A tab points at a route that does not exist.** The four tabs are
 *      the whole learner IA — a dead one is not a broken link in a corner,
 *      it is a quarter of the app's navigation. Resolved against the real
 *      route table through `scripts/lib/declaredRoutes.mjs`, the same
 *      reader `test:dashboard-v2-links` and `test:admin-links` use.
 *
 *   2. **A label has no translation.** Every tab carries a `labelKey` and
 *      an English `label`. If the key is missing from `en/common.json`,
 *      i18n silently renders the key itself — a bar reading
 *      "nav.dashboard". If the two disagree, the fallback shown before
 *      i18n is ready says something different from the label that
 *      replaces it a moment later.
 *
 *   3. **A renderer stops reading the registry.** The whole point is that
 *      neither bar declares its own destinations. A regression here looks
 *      exactly like the code it replaced, so it is checked as text: no
 *      learner-tab route may be written as a literal inside either
 *      renderer.
 *
 *   4. **The bar offers a tab the app would refuse.** `/papers` and
 *      `/games` are public routes that mount the learner shell, so this
 *      bar is drawn for teachers and guardians as well as learners — and
 *      Home (`/dashboard`) and Notes (`/notes`) are `LearnerOnlyRoute`
 *      pages. Until 2026-08-21 a teacher who tapped Home on the past-paper
 *      archive was answered with "Teacher accounts stay in the teacher
 *      portal", inside the very shell whose bar had just sent them there.
 *      `resolveLearnerTabs` closes it; the two checks below are that each
 *      tab's `learnerOnly` flag still agrees with the route table, and
 *      that the resolver still acts on it.
 *
 * Also pins `activeLearnerTab`, because a nav that cannot say which tab it
 * is on is what the Papers copy did (`active: true`, hardcoded, forever).
 *
 * Run: npm run test:learner-tabs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEARNER_TABS, activeLearnerTab, resolveLearnerTabs } from '../src/shared/constants/learnerTabs.js'
import { isLearnerOnlyPath, canOpenLearnerRoutes, getRoleLandingPath } from '../src/utils/navigation.js'
import { makeRouteMatcher } from './lib/declaredRoutes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

/* ── 0. The registry is the shape the renderers assume ────────────────── */

assert.equal(LEARNER_TABS.length, 4, 'the learner IA is four tabs (Home · Papers · Notes · Games)')
assert.deepEqual(
  LEARNER_TABS.map((t) => t.id),
  ['home', 'papers', 'notes', 'games'],
  'tab order is the prototype IA and is not a free choice — it is muscle memory on the app’s most-used control',
)
for (const tab of LEARNER_TABS) {
  for (const key of ['id', 'to', 'labelKey', 'label']) {
    assert.equal(typeof tab[key], 'string', `tab ${tab.id} is missing ${key}`)
    assert.ok(tab[key].length > 0, `tab ${tab.id} has an empty ${key}`)
  }
  assert.equal(typeof tab.end, 'boolean', `tab ${tab.id} must state whether its match is exact`)
  assert.equal(
    typeof tab.learnerOnly, 'boolean',
    `tab ${tab.id} must state whether LearnerOnlyRoute refuses it to a non-learner`,
  )
  assert.ok(tab.to.startsWith('/'), `tab ${tab.id} must be an absolute path`)
  assert.ok(Object.isFrozen(tab), `tab ${tab.id} is mutable — a shared registry a consumer can edit is not one`)
}

/* ── 1. Every tab resolves to a declared route ────────────────────────── */

const routeExists = makeRouteMatcher()
for (const tab of LEARNER_TABS) {
  assert.ok(
    routeExists(tab.to),
    `the ${tab.label} tab points at ${tab.to}, which no <Route> declares`,
  )
}

/* ── 2. Every label has a translation that agrees with the fallback ───── */

const en = JSON.parse(read('src/i18n/locales/en/common.json'))
for (const tab of LEARNER_TABS) {
  const [ns, key] = tab.labelKey.split('.')
  assert.equal(ns, 'nav', `tab ${tab.id}'s labelKey should live under nav.*, got ${tab.labelKey}`)
  const translated = en?.[ns]?.[key]
  assert.ok(translated, `en/common.json has no ${tab.labelKey} — the bar would render the key itself`)
  assert.equal(
    translated,
    tab.label,
    `tab ${tab.id}: the English fallback (${tab.label}) and en/common.json (${translated}) disagree, `
    + 'so the label changes under the learner once i18n resolves',
  )
}

/* ── 3. Neither renderer declares its own destinations ────────────────── */

const RENDERERS = [
  'src/features/learnerHome/components/LearnerBottomNav.jsx',
  'src/shared/components/MobileBottomNav.jsx',
]
for (const file of RENDERERS) {
  const src = read(file)
  assert.match(
    src,
    /resolveLearnerTabs\(/,
    `${file} no longer resolves its tabs through the registry — that is the fork this `
    + 'registry exists to prevent, and going back to the raw array would also drop the '
    + 'audience check that keeps a teacher off /dashboard',
  )
  for (const tab of LEARNER_TABS) {
    // A route written as a string literal in a renderer is a second copy of
    // the registry, whatever it is called.
    assert.ok(
      !src.includes(`'${tab.to}'`) && !src.includes(`"${tab.to}"`),
      `${file} hardcodes ${tab.to} — take the destination from LEARNER_TABS instead`,
    )
  }
}

/**
 * `PastPapersHub` carried the third copy. It is gone; the hub renders
 * inside the learner shell and takes the shell's bar like every other
 * tab. This is the "and it stays gone" half.
 */
const hub = read('src/features/papers/pages/PastPapersHub.jsx')
assert.ok(
  !/function BottomNav\b/.test(hub),
  'PastPapersHub declares a BottomNav again — the Papers tab must take the shell’s bar, '
  + 'not draw a second one over the cards (LEARNER_UI_AUDIT L-03/L-04)',
)

/* ── 4. activeLearnerTab ──────────────────────────────────────────────── */

assert.equal(activeLearnerTab('/dashboard'), 'home')
assert.equal(activeLearnerTab('/papers'), 'papers')
// A tab stays lit inside its own section — this is the case the hardcoded
// `active: true` flag was standing in for.
assert.equal(activeLearnerTab('/papers/abc123'), 'papers')
assert.equal(activeLearnerTab('/papers/abc123/quiz'), 'papers')
assert.equal(activeLearnerTab('/notes/xyz'), 'notes')
assert.equal(activeLearnerTab('/games/play/7'), 'games')
// `/dashboard` is an exact match, so a deeper path under it is NOT Home.
assert.equal(activeLearnerTab('/dashboard/classic'), null)
// A learner route under no tab lights nothing, rather than guessing.
assert.equal(activeLearnerTab('/progress'), null)
assert.equal(activeLearnerTab('/profile'), null)
assert.equal(activeLearnerTab('/daily'), null)
// A path that merely starts with a tab's letters is not that tab.
assert.equal(activeLearnerTab('/papers-archive'), null)
assert.equal(activeLearnerTab(''), null)
assert.equal(activeLearnerTab(undefined), null)

/* ── 5. `learnerOnly` agrees with the route table ─────────────────────── */

// The flag is written down in `src/shared` because that layer may not import
// `src/utils/navigation.js` (which reaches an engine). A copied fact needs a
// guard or it is just a comment: this is it, and it runs in both directions.
for (const tab of LEARNER_TABS) {
  assert.equal(
    tab.learnerOnly,
    isLearnerOnlyPath(tab.to),
    `tab ${tab.id} says learnerOnly: ${tab.learnerOnly}, but LEARNER_ONLY_SEGMENTS `
    + `says ${isLearnerOnlyPath(tab.to)} about ${tab.to}. `
    + (tab.learnerOnly
      ? 'A tab flagged learner-only that is not gets hidden from a teacher for no reason.'
      : 'A tab that IS gated and is not flagged is offered to a teacher and then refused — '
        + 'the bug this flag exists to prevent.'),
  )
}

/* ── 6. The resolver acts on it ───────────────────────────────────────── */

// A learner, an admin and a signed-out visitor all see the bar unchanged.
// `resolveLearnerTabs` returns the registry itself in that case, so this is
// identity rather than deep equality — a copy would mean a branch was taken.
assert.equal(resolveLearnerTabs(), LEARNER_TABS, 'the default audience is the full bar')
assert.equal(
  resolveLearnerTabs({ learnerRoutesOpen: true, homePath: '/admin' }),
  LEARNER_TABS,
  'an account that CAN open learner routes keeps /dashboard as Home — an admin previewing '
  + 'the learner app must not be ejected to /admin by the Home tab',
)

// …and every role the guard refuses gets a bar it can actually use.
for (const profile of [
  { role: 'teacher' },
  { role: 'parent' },
  { role: 'something-this-app-does-not-know' },
]) {
  assert.equal(canOpenLearnerRoutes(profile), false, `${profile.role} should be refused learner routes`)
  const homePath = getRoleLandingPath(profile)
  const tabs = resolveLearnerTabs({ learnerRoutesOpen: false, homePath })

  const home = tabs.find((t) => t.id === 'home')
  assert.ok(home, 'Home is retargeted, never dropped — a shell with no header and no bar strands the account')
  assert.equal(home.to, homePath, `Home must lead ${profile.role} to ${homePath}`)
  assert.equal(home.label, 'Home', 'the retargeted tab is still Home — it is the same idea, a reachable one')

  for (const tab of tabs) {
    assert.ok(
      tab.id === 'home' || !isLearnerOnlyPath(tab.to),
      `the bar offers ${profile.role} ${tab.to}, which LearnerOnlyRoute refuses`,
    )
  }
  // The public half survives: dropping Papers and Games would leave a teacher
  // on /papers with a bar that cannot reach the page they are looking at.
  assert.deepEqual(
    tabs.map((t) => t.id),
    ['home', 'papers', 'games'],
    'a refused account keeps Home (retargeted) plus the two public tabs, in IA order',
  )
}

// The registry itself is never mutated by a resolution — both bars call this
// on every render, and a shared frozen array that a caller could edit is the
// thing `Object.freeze` is there to stop.
assert.deepEqual(
  LEARNER_TABS.map((t) => t.to),
  ['/dashboard', '/papers', '/notes', '/games'],
  'resolveLearnerTabs must not write through to the registry',
)

// The guard can fail: flagging Notes as public is the exact regression, and
// it must be visible here rather than on a teacher's phone.
{
  const mislabelled = { id: 'notes', to: '/notes', learnerOnly: false }
  assert.notEqual(
    mislabelled.learnerOnly,
    isLearnerOnlyPath(mislabelled.to),
    'Mutation check: a learner-only tab flagged public must be detectable',
  )
}

console.log(
  `learner tabs: ${LEARNER_TABS.length} tabs — routes resolve, labels translate, both bars read `
  + 'the registry, and no bar offers a tab its account would be refused',
)
