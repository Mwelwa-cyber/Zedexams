#!/usr/bin/env node
/**
 * The legacy `Navbar` menu must not offer an account a page it cannot open.
 *
 * ## The failure this closes
 *
 * `Navbar` branched its menu by role, and the STAFF branch — the one a
 * teacher gets — was:
 *
 *     { to: '/notes' }  { to: '/lessons' }  { to: '/quizzes' }
 *
 * All three are refused to a teacher. `/notes` and `/quizzes` are
 * `<LearnerOnlyRoute>` pages, and `/lessons` is a `<Navigate to="/notes">`,
 * so every item in a teacher's menu ended on "Teacher accounts stay in the
 * teacher portal". The menu had a 100% failure rate for the role it was
 * written for and nobody noticed, for two reasons worth keeping in mind:
 *
 *   - The branch existed, so the code LOOKED audience-aware. It had simply
 *     been written before those routes became learner-only, and nothing
 *     re-read it afterwards.
 *   - One of the three hid behind a redirect. Reading the list tells you
 *     `/lessons` is not in `LEARNER_ONLY_SEGMENTS`; only following the hop
 *     tells you it lands on `/notes`, which is. So this guard resolves
 *     redirects rather than classifying the literal.
 *
 * `src/utils/navigation.js` already stated the rule: the refusal card is
 * right for a typed or bookmarked learner URL, and wrong when the app itself
 * pointed you at it. A menu item is the app pointing at it.
 *
 * ## Why text-parsed
 *
 * The link sets live inside the component, the way `test:admin-links` and
 * `test:dashboard-v2-links` find their targets. Keep each `to:` a plain
 * string literal so the parser can see it; anything else is skipped AND
 * PRINTED, because a guard that quietly covers less than it claims reads
 * exactly like one that found nothing wrong.
 *
 * Run: npm run test:navbar-audience
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canOpenLearnerRoutes, isLearnerOnlyPath } from '../src/utils/navigation.js'
import { makeRouteMatcher, readSource } from './lib/declaredRoutes.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const navbar = readFileSync(resolve(root, 'src/components/layout/Navbar.jsx'), 'utf8')
const app = readSource('src/app/App.jsx')

/* ── Redirect resolution ──────────────────────────────────────────────── */

/**
 * `<Route path="/lessons" element={<Navigate to="/notes" replace />} />`
 * — one hop, which is all App.jsx ever declares. A second hop would be a
 * redirect to a redirect, and the assertion below would name the wrong
 * path rather than pass, so this fails loudly if that ever appears.
 */
const redirects = new Map(
  [...app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Navigate\s+to="([^"]+)"/g)]
    .map((m) => [m[1], m[2]]),
)
assert.ok(redirects.size >= 10, `Parsed only ${redirects.size} <Navigate> routes — parser drifted?`)

function landsOn(path) {
  const once = redirects.get(path) ?? path
  assert.ok(
    !redirects.has(once) || once === path,
    `${path} redirects to ${once}, which redirects again — resolve the chain here before trusting it`,
  )
  return once
}

/* ── Parse the link sets ──────────────────────────────────────────────── */

/** `const xLinks = [ … ]` in Navbar.jsx, as {literals, dynamic}. */
function linkSet(name) {
  const block = navbar.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n  \\]`))
  assert.ok(block, `Navbar.jsx no longer declares ${name} — parser drifted, or the menu was restructured`)
  const rows = block[1].split('\n').filter((line) => line.includes('to:'))
  assert.ok(rows.length > 0, `${name} parsed as empty — a vacuous pass is not a pass`)
  const literals = rows.map((line) => line.match(/to:\s*'([^']+)'/)?.[1]).filter(Boolean)
  const dynamic = rows.length - literals.length
  return { literals, dynamic, rows: rows.length }
}

const teacherLinks = linkSet('teacherLinks')
const adminLinks = linkSet('adminLinks')
const learnerLinks = linkSet('learnerLinks')

/* ── The branch is real ───────────────────────────────────────────────── */

// A correct set of arrays that nothing selects between is decoration.
assert.match(
  navbar,
  /const navLinks = isAdmin \? adminLinks : \(isTeacher \? teacherLinks : learnerLinks\)/,
  'Navbar no longer picks its menu by role in the shape this guard checks. Teachers and '
  + 'admins are NOT interchangeable here: an admin passes LearnerOnlyRoute on role alone '
  + 'and may keep the learner surfaces; a teacher is refused every one of them.',
)

// The four-tab learner bar is the phone-sized half of the same question, and
// on a phone it IS the navigation. It must be told who it is drawing for.
assert.match(
  navbar,
  /<MobileBottomNav\s+learnerRoutesOpen=\{learnerRoutesOpen\}\s+homePath=\{homePath\}\s*\/>/,
  'Navbar renders the learner tab bar without saying who for. Unqualified, its Home tab '
  + 'points every account at /dashboard — which is where a teacher met the refusal card.',
)

/* ── Every destination exists ─────────────────────────────────────────── */

const routeExists = makeRouteMatcher()
for (const [name, set] of [['teacherLinks', teacherLinks], ['adminLinks', adminLinks], ['learnerLinks', learnerLinks]]) {
  for (const to of set.literals) {
    assert.ok(routeExists(to), `${name} points at ${to}, which no <Route> declares`)
  }
  if (set.dynamic) {
    console.log(`  note: ${name} has ${set.dynamic} destination(s) built at runtime — not classified here`)
  }
}

/* ── …and every account can open the ones it is offered ───────────────── */

const AUDIENCES = [
  { name: 'teacherLinks', set: teacherLinks, profile: { role: 'teacher' } },
  { name: 'adminLinks', set: adminLinks, profile: { role: 'admin' } },
]
for (const { name, set, profile } of AUDIENCES) {
  const open = canOpenLearnerRoutes(profile)
  for (const to of set.literals) {
    const destination = landsOn(to)
    if (open) continue
    assert.ok(
      !isLearnerOnlyPath(destination),
      `${name} offers a ${profile.role} ${to}`
      + (destination === to ? '' : ` (which redirects to ${destination})`)
      + ', and LearnerOnlyRoute refuses it — the menu item ends on the refusal card.',
    )
  }
}

/* ── The guard can fail ───────────────────────────────────────────────── */

// The exact regression, with the redirect that hid it the first time.
assert.equal(landsOn('/lessons'), '/notes', 'App.jsx should still redirect /lessons to /notes')
assert.ok(
  isLearnerOnlyPath(landsOn('/lessons')),
  'Mutation check: a teacher link to /lessons must still be detectable through the redirect',
)

console.log(
  `✓ navbar audience — ${teacherLinks.rows} teacher / ${adminLinks.rows} admin / `
  + `${learnerLinks.rows} learner menu items, each openable by the account it is shown to`,
)
