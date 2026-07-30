/**
 * test-route-targets — every in-app navigation target must resolve to a route
 * declared in App.jsx.
 *
 * WHY THIS EXISTS
 *
 * A "Page not found" was reported from inside the app with no reproducible
 * click path. Auditing the studio by hand could not find it, because a hand
 * audit only covers the files you think to open — and a dead link is created
 * by *deleting a route*, which leaves no trace at the call site. Two dead
 * links have already shipped this way:
 *
 *   • /ai-practice — the route went away with the learnerAi pipeline (PR #713)
 *     and the learner banner kept pointing at it (fixed in StudentDashboard).
 *   • /ai-notes    — never a route at all; the flagged-on arm of the learner
 *     study plan pointed at it (fixed in TodayStudyPlan).
 *
 * `test:dashboard-v2-links` already pins the dashboardV2 navigation config.
 * This is the same idea widened to the whole SPA — every role, every surface,
 * every config table — so the class of bug cannot come back silently.
 *
 * WHAT COUNTS AS A NAVIGATION TARGET
 *
 * An absolute path literal ('/…') on a line that also carries a navigation
 * token (`to=`, `to:`, `navigate(`, `href=`, `route:`, `createTo`, …). That
 * keeps the check honest without flagging every string in the tree: prefix
 * lists (`'/quiz/'` in reminderVisibility), price suffixes (`'/month'`) and
 * fetch paths (`'/syllabi/curriculum-data.json'`) are not nav targets and are
 * not on nav lines.
 *
 * Template placeholders are treated as one path segment, so
 * `/teacher/assessment-papers/${id}/edit` is checked against
 * `/teacher/assessment-papers/:paperId/edit`.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { declaredRoutePaths, readSource, TEACHER_ROUTES_PATH } from './lib/declaredRoutes.mjs'

const SRC = 'src'
const APP = join(SRC, 'App.jsx')

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ── Declared routes ─────────────────────────────────────────────────────────

const appSource = readFileSync(APP, 'utf8')
// Routes come from BOTH declaration sites — App.jsx's inline <Route>s and the
// /teacher/* route table. Reading App.jsx alone would silently drop every
// teacher route and report a working link as dead.
const declaredRoutes = declaredRoutePaths().filter((p) => p !== '*')

/**
 * React Router v6 matching, reduced to what our route table actually uses:
 *   • ':param' matches exactly one non-empty segment
 *   • a trailing '/*' matches the parent path itself AND any descendant
 *     (so path="/settings/*" matches '/settings' — this is real v6 behaviour
 *     and a naive translation gets it wrong)
 *   • a trailing slash on the target is ignored
 */
export function routeToRegExp(routePath) {
  const body = routePath
    .replace(/\/\*$/, '(?:/.+)?')
    .replace(/:[^/]+/g, '[^/]+')
  return new RegExp(`^${body}/?$`)
}

const ROUTE_MATCHERS = declaredRoutes.map((p) => ({ path: p, re: routeToRegExp(p) }))

export function resolvesToRoute(target, matchers = ROUTE_MATCHERS) {
  return matchers.some((m) => m.re.test(target))
}

// ── Collecting nav targets from the tree ────────────────────────────────────

/** A path literal only counts when its line is doing navigation. */
const NAV_LINE = /(?:\bto=|\bto:\s|navigate\(|\bhref=|\broute:\s|createTo|savedWorkTo|viewAllTo|linkTo|sourceRoute|landingPath|redirectTo)/

/**
 * Not routes, and never reached by the router:
 *   • '/api/…'  → Firebase Hosting rewrites to Cloud Functions
 *   • '/downloads/…' → apiAssessmentDownload rewrite
 * Both are real destinations, just not SPA routes. Anything else that needs to
 * live here should come with a reason — an unexplained entry is how a dead
 * link gets waved through.
 */
const NON_ROUTE_PREFIXES = ['/api/', '/downloads/']

/** Static assets under public/ opened directly (PDF, JSON, images, sounds). */
const STATIC_ASSET = /\.[a-z0-9]{2,5}$/i

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(jsx?|mjs)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name)) out.push(full)
  }
  return out
}

/** '/a/${id}/b' → '/a/X/b' so it can be matched against '/a/:id/b'. */
function normaliseTarget(raw) {
  let target = raw.replace(/\$\{[^}]*\}/g, 'X')
  const cut = target.search(/[?#]/)
  if (cut !== -1) target = target.slice(0, cut)
  if (target.length > 1 && target.endsWith('/')) target = target.slice(0, -1)
  return target
}

export function collectNavTargets(files, read = (f) => readFileSync(f, 'utf8')) {
  const found = new Map() // target → ['file:line', …]
  for (const file of files) {
    read(file).split('\n').forEach((line, index) => {
      if (!NAV_LINE.test(line)) return
      for (const match of line.matchAll(/['"`](\/[A-Za-z0-9\-_/${}:.]*)['"`]/g)) {
        const target = normaliseTarget(match[1])
        if (target === '/' || target === '') continue
        if (NON_ROUTE_PREFIXES.some((p) => target.startsWith(p))) continue
        if (STATIC_ASSET.test(target)) continue
        if (!found.has(target)) found.set(target, [])
        found.get(target).push(`${file}:${index + 1}`)
      }
    })
  }
  return found
}

// Literal <Navigate to="…"> redirect targets from both declaration sites. A
// redirect pointing at a route someone deleted 404s exactly like a dead link,
// and the redirect table is the easiest place for that to hide.
export function collectRedirectTargets(source = `${appSource}\n${readSource(TEACHER_ROUTES_PATH)}`) {
  return [...source.matchAll(/<Navigate\s+to="(\/[^"${]*)"/g)].map((m) => normaliseTarget(m[1]))
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('\nroute targets\n')

test('both declaration sites yield a route table we can read', () => {
  assert.ok(declaredRoutes.length > 100, `expected the full route table, parsed ${declaredRoutes.length}`)
  // One route from each site, so losing either is a failure rather than a
  // quietly shorter list.
  assert.ok(declaredRoutes.includes('/teacher/assessment-papers/new'), 'teacher route table')
  assert.ok(declaredRoutes.includes('/notes'), 'App.jsx inline routes')
})

test('routeToRegExp models the v6 rules we depend on', () => {
  // A trailing splat matches the parent path itself.
  assert.ok(routeToRegExp('/settings/*').test('/settings'))
  assert.ok(routeToRegExp('/settings/*').test('/settings/profile'))
  assert.ok(routeToRegExp('/settings/*').test('/settings/a/b'))
  // A param matches exactly one non-empty segment.
  assert.ok(routeToRegExp('/notes/:id').test('/notes/abc'))
  assert.ok(!routeToRegExp('/notes/:id').test('/notes'))
  assert.ok(!routeToRegExp('/notes/:id').test('/notes/a/b'))
  // Trailing slashes are equivalent.
  assert.ok(routeToRegExp('/pricing').test('/pricing/'))
})

test('the two dead links that shipped would both be caught', () => {
  assert.ok(!resolvesToRoute('/ai-notes'), '/ai-notes must not resolve — it is not a route')
  assert.ok(!resolvesToRoute('/ai-practice'), '/ai-practice was deleted in PR #713')
  // …and their replacements do resolve.
  assert.ok(resolvesToRoute('/notes'))
  assert.ok(resolvesToRoute('/lessons'))
})

test('every navigation target in src/ resolves to a declared route', () => {
  // The two route-DECLARATION files are excluded: their redirect builders
  // contain template literals (`/teacher/lesson-plans/new${search}`) that read
  // as nav targets but are route plumbing. Their <Navigate> targets are
  // checked by the redirect test below, so nothing goes unchecked.
  const files = sourceFiles(SRC)
    .filter((f) => f !== APP && !f.endsWith('teacherRoutes.jsx'))
  const targets = collectNavTargets(files)
  assert.ok(targets.size > 150, `expected to scan a real link surface, found ${targets.size} targets`)

  const dead = [...targets].filter(([target]) => !resolvesToRoute(target))
  assert.equal(
    dead.length,
    0,
    `these navigation targets match no declared route — each one is a "Page not found" `
    + `waiting for a user:\n${dead.map(([t, at]) => `  ${t}\n      ${at.join('\n      ')}`).join('\n')}`,
  )
})

test('every literal <Navigate> redirect resolves to a declared route', () => {
  const dead = collectRedirectTargets().filter((t) => !resolvesToRoute(t))
  assert.equal(dead.length, 0, `App.jsx redirects to routes that do not exist: ${dead.join(', ')}`)
})

console.log(`\n${passed} passing\n`)
