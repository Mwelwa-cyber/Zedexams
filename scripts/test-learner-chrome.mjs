#!/usr/bin/env node
/**
 * Learner chrome ratchet — which learner routes still mount the legacy
 * `<Navbar />`, and the guarantee that the list only ever shrinks.
 *
 * ## What this is protecting
 *
 * The learner side runs two chromes at once. The redesign's shell
 * (`LearnerLayout` → `LearnerShell`: the indigo `.lhx` system and the
 * four-tab bar Home · Papers · Notes · Games) is the intended one. The
 * pre-redesign `Navbar` is the other, and its learner menu is still an
 * eight-item list of the RETIRED information architecture — Lessons,
 * Quizzes, Exams, Results (`src/components/layout/Navbar.jsx`).
 *
 * That menu is not a cosmetic leftover. It is the only thing on the live
 * learner side that links to `/my-stats`, `/my-results`, `/my-badges`,
 * `/calendar` and `/dashboard/classic` at all — nothing in the new
 * surfaces points at any of them. So every route that mounts `Navbar` is
 * a door back into the pre-redesign app, and closing the busiest door is
 * what makes those screens genuinely unreachable rather than merely
 * unlinked.
 *
 * ## Why a list rather than a ban
 *
 * Some of these routes cannot simply drop the Navbar: `LessonPlayer`
 * renders a bare `min-h-screen bg-gray-50` with no back control of its
 * own, so removing its chrome would strand a learner on the page. Those
 * need a real migration, not a deletion, and until then they are honest
 * entries here rather than a rule bent to accommodate them.
 *
 * ## The two directions
 *
 * 1. A learner route that mounts `Navbar` and is NOT listed → fail. That
 *    is the regression: chrome coming back, or a new page built on it.
 * 2. A listed route that no longer mounts `Navbar` → fail. The list is
 *    the work remaining; leaving a finished entry in it would let the
 *    number stop meaning anything, which is how a ratchet quietly stops
 *    being one.
 *
 * ## One hop, because the chrome can hide behind a role branch
 *
 * The parser used to read the `<Route>` LINE and nothing else, so a route
 * whose element is a locally-declared wrapper — `<ProfileRoute />`,
 * `<SettingsPage />`, `<OfflineRoute />` — was invisible to it whatever
 * that wrapper rendered. Three routes sat in that blind spot, and the
 * ratchet reported a clean number over all of them.
 *
 * It surfaced the day `/offline` grew a teacher arm: the Navbar moved one
 * line inward, the route stopped matching, and rule 2 correctly refused
 * to call a listed route finished. The fix is the one
 * `test:navbar-audience` already records for redirects — resolve the hop
 * rather than classify the literal.
 *
 * A wrapper that returns something ELSE for a learner before it reaches
 * the Navbar (`ProfileRoute` hands them `LearnerProfilePage`;
 * `SettingsPage` hands them `LearnerShell`) does not put the retired IA
 * in front of a learner, and is reported as branched rather than counted.
 * That distinction is printed, never silent: a guard that quietly covers
 * less than it claims reads exactly like one that found nothing wrong.
 *
 * Run: npm run test:learner-chrome
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(resolve(root, 'src/app/App.jsx'), 'utf8')

/**
 * Learner routes still mounting the legacy Navbar.
 *
 * SHRINK THIS LIST. Never add to it — a new learner surface belongs in
 * `LearnerLayout`, or brings its own chrome the way the note reader does.
 */
const STILL_ON_LEGACY_CHROME = new Set([
  '/quizzes',            // no replacement yet — needs the cream/orange re-skin
  '/results/:resultId',  // ditto, same quiz surface
  '/search',             // no replacement yet
  '/lessons/:lessonId',  // no back control of its own; needs a real migration
  // Reached through <OfflineRoute />, which gives a TEACHER the teacher shell
  // (that arm is done) and everyone else the legacy Navbar. Still listed
  // because a learner still gets it — the entry is the learner work left.
  '/offline',
])

/* ── Resolve one hop: local route wrappers ───────────────────────────── */

/**
 * `function Name() { … }` declared in App.jsx, as Name → body.
 *
 * Brace-counted from the opening `{` rather than regex-terminated, because
 * every one of these bodies contains JSX with braces in it and a lazy match
 * would stop at the first `}` of an attribute.
 */
function localComponents(source) {
  const bodies = new Map()
  const re = /\nfunction ([A-Z][A-Za-z0-9]*)\s*\([^)]*\)\s*\{/g
  let m
  while ((m = re.exec(source)) !== null) {
    let depth = 0
    let i = re.lastIndex - 1
    const start = i
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    bodies.set(m[1], source.slice(start, i + 1))
  }
  return bodies
}

const COMPONENTS = localComponents(app)
assert.ok(
  COMPONENTS.has('ProfileRoute') && COMPONENTS.has('SettingsPage'),
  'the local-component parser found neither ProfileRoute nor SettingsPage — it has drifted, '
  + 'and a parser that matches nothing reports a clean tree for a broken one',
)

/** A wrapper that hands a learner a different chrome before reaching Navbar. */
const LEARNER_ARM = /if\s*\((?:isLearnerRole\(|role === 'learner')/

/* ── Parse the route table ────────────────────────────────────────────── */

// One <Route …/> per line in App.jsx, which is the shape every route-parsing
// guard in this repo relies on (and why routes are kept to a line each).
const mountsNavbar = new Set()
const allRoutes = new Set()
const branched = []
for (const line of app.split('\n')) {
  const path = line.match(/<Route\s+path="([^"]+)"/)?.[1]
  if (!path) continue
  allRoutes.add(path)
  if (/<Navbar\s*\/>/.test(line)) { mountsNavbar.add(path); continue }
  // One hop into a locally-declared wrapper element on the same line.
  for (const name of line.matchAll(/<([A-Z][A-Za-z0-9]*)\s*\/>/g)) {
    const body = COMPONENTS.get(name[1])
    if (!body || !/<Navbar\s*\/>/.test(body)) continue
    if (LEARNER_ARM.test(body)) { branched.push(`${path} (${name[1]})`); continue }
    mountsNavbar.add(path)
  }
}

assert.ok(allRoutes.size > 50, `expected to parse the route table, found ${allRoutes.size} routes`)
if (branched.length) {
  console.log(
    '  note: role-branched wrappers reach <Navbar /> but hand a learner another chrome first,'
    + ' so they are not counted as learner legacy chrome:',
  )
  for (const entry of branched) console.log(`    ${entry}`)
}

/* ── 1. Nothing unlisted may mount the legacy chrome ──────────────────── */

const unexpected = [...mountsNavbar].filter((p) => !STILL_ON_LEGACY_CHROME.has(p))
assert.deepEqual(
  unexpected,
  [],
  `These routes mount the legacy <Navbar />, which is the retired learner IA:\n`
  + unexpected.map((p) => `  ${p}`).join('\n')
  + `\n\nPut the page in LearnerLayout, or give it its own chrome. Do not add it`
  + ` to STILL_ON_LEGACY_CHROME — that list only shrinks.`,
)

/* ── 2. Finished entries must leave the list ──────────────────────────── */

const stale = [...STILL_ON_LEGACY_CHROME].filter((p) => !mountsNavbar.has(p))
assert.deepEqual(
  stale,
  [],
  `These routes no longer mount <Navbar /> but are still listed as if they do:\n`
  + stale.map((p) => `  ${p}`).join('\n')
  + `\n\nRemove them from STILL_ON_LEGACY_CHROME — the list is the work left.`,
)

/* ── 3. The note reader specifically ──────────────────────────────────── */

// Named rather than left to rule 1, because this is the route the whole
// Home → subject → note funnel ends on, and it is the door the retired IA
// was still being reached through. A regression here is not one route
// among several; it re-opens the pre-redesign chrome to every learner who
// reads a note.
assert.ok(allRoutes.has('/notes/:id'), 'the note reader route disappeared')
assert.ok(
  !mountsNavbar.has('/notes/:id'),
  '/notes/:id must not mount <Navbar />: ReaderEngine carries its own back'
  + ' control, and the legacy header put the retired 8-item menu on top of'
  + ' the reading surface the funnel exists to reach.',
)

/* ── 4. The guard can actually fail ───────────────────────────────────── */

// A parser that silently matches nothing reports a clean build for a
// broken tree. Prove the detection works on a line known to carry it.
const probe = '          <Route path="/probe" element={<ProtectedRoute><Navbar /><X /></ProtectedRoute>} />'
assert.ok(/<Route\s+path="([^"]+)"/.test(probe) && /<Navbar\s*\/>/.test(probe),
  'the Navbar detection no longer matches a route line that mounts it')

// …and that the hop works, which is the half the line-only parser missed.
// `/offline` is the live case: its route line names <OfflineRoute /> and
// carries no <Navbar /> of its own, so a parser that stopped at the line
// would report it clean while a learner still gets the retired header.
assert.ok(
  !/<Navbar\s*\/>/.test(app.split('\n').find((l) => l.includes('<Route path="/offline"'))),
  'fixture drift: /offline mounts <Navbar /> on its own line again, so it no longer '
  + 'exercises the one-hop resolution',
)
assert.ok(
  mountsNavbar.has('/offline'),
  'the one-hop resolution stopped seeing <Navbar /> inside OfflineRoute',
)
// And that the learner-arm exclusion is real rather than vacuous: both of
// these DO reach <Navbar />, for an admin, and must not be counted.
assert.ok(
  /<Navbar\s*\/>/.test(COMPONENTS.get('ProfileRoute')) && !mountsNavbar.has('/profile'),
  'ProfileRoute reaches <Navbar /> but hands a learner LearnerProfilePage first',
)

console.log(
  `learner-chrome: ok — ${mountsNavbar.size} learner route(s) still on the legacy chrome`
  + ` (10 → 9 when /notes/:id came off, 9 → 5 when the four superseded`
  + ` pages were retired), /notes/:id is clean.`,
)
