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
  '/offline',            // not learner-only — teachers and admins reach it too
])

/* ── Parse the route table ────────────────────────────────────────────── */

// One <Route …/> per line in App.jsx, which is the shape every route-parsing
// guard in this repo relies on (and why routes are kept to a line each).
const mountsNavbar = new Set()
const allRoutes = new Set()
for (const line of app.split('\n')) {
  const path = line.match(/<Route\s+path="([^"]+)"/)?.[1]
  if (!path) continue
  allRoutes.add(path)
  if (/<Navbar\s*\/>/.test(line)) mountsNavbar.add(path)
}

assert.ok(allRoutes.size > 50, `expected to parse the route table, found ${allRoutes.size} routes`)

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

console.log(
  `learner-chrome: ok — ${mountsNavbar.size} learner route(s) still on the legacy chrome`
  + ` (10 → 9 when /notes/:id came off, 9 → 5 when the four superseded`
  + ` pages were retired), /notes/:id is clean.`,
)
