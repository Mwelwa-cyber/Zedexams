#!/usr/bin/env node
/* global console, process */
/**
 * Static smoke test for the PUBLIC surface: routes, redirects, sitemap, and
 * the public grade copy. Plain `node` (no browser, no emulator) so it runs
 * inside `npm run test:all` — the required CI "Tests" check. This is the
 * lightweight, convention-fitting alternative to a Playwright E2E suite.
 *
 * Why this exists: the /teachers funnel drift (#851). Old launch docs and the
 * SEO surface referenced /teachers and /teachers/samples, but the public
 * landing was never built, so those URLs 404'd. We added 301 redirects to
 * /pricing. This test pins that fix down AND guards the whole CLASS of drift
 * it belongs to:
 *
 *   1. Redirect integrity — legacy/parked marketing URLs keep redirecting,
 *      at BOTH the hosting layer (firebase.json — the real 301 a crawler
 *      sees) and the SPA layer (App.jsx <Navigate> — the dev-server fallback).
 *   2. Public routes stay public — the marketing/SEO routes are not behind an
 *      auth guard (a guard would bounce a signed-out crawler to /login).
 *   3. Auth-gated routes stay gated — learner/teacher/admin routes keep their
 *      ProtectedRoute / TeacherRoute / AdminRoute wrapper.
 *   4. sitemap.xml never advertises a URL that 404s, redirects, or is auth-
 *      gated — every <loc> must resolve to a real public route. This is the
 *      exact check that would have caught a /teachers entry in the sitemap.
 *   5. Public grade copy matches the active curriculum range (no "Grade 1-12"
 *      overclaim) — complements test:grade-rules, which guards the
 *      firestore.rules side, not the manifest / index.html marketing copy.
 *
 * Deliberately text/structure-level (it does NOT render the app), mirroring
 * scripts/test-firestore-rules-text.mjs and scripts/test-grade-rules-consistency.mjs.
 *
 * Run: npm run test:public-routes   (also via npm run test:all)
 */
import { readFileSync } from 'node:fs'
import { teacherRouteEntries } from './lib/declaredRoutes.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getActiveGrades } from '../src/config/curriculum.js'
import { buildRouteList } from './prerenderRoutes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const appJsx = read('src/app/App.jsx')
const firebaseJson = JSON.parse(read('firebase.json'))
const manifest = JSON.parse(read('public/manifest.webmanifest'))
const indexHtml = read('index.html')
const sitemap = read('public/sitemap.xml')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── Parse <Route> declarations out of App.jsx ───────────────────────
// Split on the "<Route " boundary; each chunk holds one route's path + its
// element expression. Multi-line elements stay intact because nested JSX
// never contains another literal "<Route".
const GUARDS = ['ProtectedRoute', 'AdminRoute', 'TeacherRoute', 'requiredRole']
const routes = appJsx
  .split(/<Route\s/)
  .slice(1)
  .map((chunk) => ({
    path: (chunk.match(/path="([^"]+)"/) || [])[1],
    gated: GUARDS.some((g) => chunk.includes(g)),
    redirect: /<Navigate\b/.test(chunk),
    redirectTo: (chunk.match(/<Navigate\s+to="([^"]+)"/) || [])[1] || null,
    chunk,
  }))
  .filter((r) => r.path)
  // …plus the /teacher/* routes, which are declared as data in their own
  // table rather than inline here. Without them this file would report every
  // teacher route as "not declared" — and, worse, the auth-guard checks below
  // would have nothing left to check.
  .concat(teacherRouteEntries().map((r) => ({
    ...r,
    redirect: /<Navigate\b/.test(r.chunk),
    redirectTo: (r.chunk.match(/<Navigate\s+to="([^"]+)"/) || [])[1] || null,
  })))

const byPath = (p) => routes.find((r) => r.path === p)

// Convert a route path (with :params and * splats) into an anchored matcher.
function pathToRegex(p) {
  const body = p
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) return '[^/]+'
      if (seg === '*') return '.*'
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return new RegExp('^' + body + '$')
}

// ── 1. Redirect integrity ───────────────────────────────────────────
console.log('\nredirect integrity (legacy/parked marketing URLs → canonical)')

const HOSTING_REDIRECTS = [
  { source: '/welcome', destination: '/' },
  { source: '/plans', destination: '/pricing' },
  // /teachers is a real landing page now (#851 parked it at /pricing until
  // it shipped); legacy sub-paths like /teachers/samples canonicalise onto it.
  { source: '/teachers/**', destination: '/teachers' },
]
const redirects = firebaseJson?.hosting?.redirects || []
for (const r of HOSTING_REDIRECTS) {
  test(`firebase.json 301s ${r.source} -> ${r.destination}`, () => {
    const match = redirects.find((x) => x.source === r.source)
    assert(match, `firebase.json hosting.redirects has no entry for '${r.source}'`)
    assert(
      match.destination === r.destination,
      `'${r.source}' redirects to '${match.destination}', expected '${r.destination}'`,
    )
    assert(match.type === 301, `'${r.source}' redirect type is ${match.type}, expected 301`)
  })
}

// SPA-layer fallback for the dev server, where firebase.json redirects don't run.
test('App.jsx <Navigate> fallback for /teachers/* -> /teachers', () => {
  const r = byPath('/teachers/*')
  assert(r, 'App.jsx has no <Route path="/teachers/*">')
  assert(
    r.redirect && r.redirectTo === '/teachers',
    `App.jsx /teachers/* does not <Navigate to="/teachers"> (got ${r.redirectTo || 'no <Navigate>'})`,
  )
})

// ── 2. Public routes stay public ────────────────────────────────────
console.log('\npublic routes are reachable without auth')
const PUBLIC_ROUTES = [
  '/', '/pricing', '/teachers', '/grade-7', '/grade-12', '/privacy', '/terms',
  '/papers', '/blog', '/status', '/login', '/register',
  '/games', '/games/leaderboard',
]
for (const p of PUBLIC_ROUTES) {
  test(`${p} is public`, () => {
    const r = byPath(p)
    assert(r, `App.jsx has no <Route path="${p}"> — expected public route missing`)
    assert(
      !r.gated,
      `${p} is wrapped in an auth guard — a signed-out visitor / crawler would be bounced to /login`,
    )
  })
}

// ── 3. Auth-gated routes keep their guard ───────────────────────────
console.log('\nauth-gated routes keep their guard')
const PROTECTED_ROUTES = [
  ['/dashboard', 'ProtectedRoute'],
  ['/my-papers', 'ProtectedRoute'],
  ['/profile', 'ProtectedRoute'],
  ['/ask-zed', 'ProtectedRoute'],
  ['/exams', 'ProtectedRoute'],
  ['/quizzes', 'ProtectedRoute'],
  ['/admin', 'AdminRoute'],
  ['/admin/users', 'AdminRoute'],
  // The dashboard renders inside the same shell as every other teacher page,
  // so it is gated by TeacherRoute like the rest. (It used to be wrapped in a
  // bare ProtectedRoute because it brought its own sidebar.)
  ['/teacher', 'TeacherRoute'],
  ['/teacher/subscription', 'TeacherRoute'],
  ['/teacher/classic', 'TeacherRoute'],
  ['/teacher/library', 'TeacherRoute'],
]
for (const [p, guard] of PROTECTED_ROUTES) {
  test(`${p} requires ${guard}`, () => {
    const r = byPath(p)
    assert(r, `no route declared for "${p}" in App.jsx or the teacher route table`)
    assert(
      r.chunk.includes(guard),
      `${p} is no longer wrapped in ${guard} — it may have become publicly accessible`,
    )
  })
}

// ── 4. sitemap.xml advertises only resolvable public pages ──────────
console.log('\nsitemap.xml only lists resolvable public URLs')
// Addressable pages only: drop the catch-all 404 ("*") and splat fallbacks
// ("/teachers/*") so they can't be counted as a real match for a sitemap URL.
const pageRoutes = routes.filter((r) => r.path !== '*' && !r.path.endsWith('/*'))
const locs = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(
  (m) => m[1].replace(/^https?:\/\/[^/]+/, '') || '/',
)

test('sitemap has at least one URL', () =>
  assert(locs.length > 0, 'no <loc> entries parsed from sitemap.xml'))

for (const loc of locs) {
  test(`sitemap ${loc} resolves to a public page`, () => {
    const matches = pageRoutes.filter((r) => pathToRegex(r.path).test(loc))
    assert(matches.length > 0, `sitemap lists ${loc} but no App.jsx route matches it — it would 404`)
    const publicReal = matches.some((r) => !r.gated && !r.redirect)
    const onlyRedirect = matches.every((r) => r.redirect)
    const onlyGated = matches.every((r) => r.gated)
    assert(
      publicReal,
      onlyRedirect
        ? `sitemap lists ${loc} but it only matches a redirect route — advertise the canonical destination instead`
        : onlyGated
          ? `sitemap lists ${loc} but it is auth-gated — a crawler would be bounced to /login`
          : `sitemap lists ${loc} but no matching route is a public page`,
    )
  })
}

// ── 4b. Every advertised public URL is prerendered ──────────────────
// A sitemap URL that is NOT prerendered falls back to dist/app.html — the
// neutral SPA shell, which carries no <link rel="canonical"> — so Googlebot
// reads identical raw HTML for it and the homepage and files it under
// "Duplicate without user-selected canonical", keeping it out of the index.
// The homepage ("/") IS prerendered, but by prerender.mjs directly (into
// dist/index.html), not via buildRouteList — so it's skipped here.
console.log('\nevery advertised public URL is prerendered (ships a self-canonical)')
const prerendered = new Set(buildRouteList())
for (const loc of locs) {
  if (loc === '/') continue
  test(`sitemap ${loc} is in the prerender route list`, () => {
    assert(
      prerendered.has(loc),
      `sitemap advertises ${loc} but scripts/prerenderRoutes.mjs does not prerender it — ` +
        `it would ship the canonical-less SPA shell and be flagged "Duplicate without ` +
        `user-selected canonical". Add it to buildRouteList().`,
    )
  })
}

// ── 4c. Hosting fallback ↔ prerender split stay in sync ─────────────
// Prerendering "/" into dist/index.html is only safe because the SPA `**`
// fallback serves the neutral shell from dist/app.html instead — and that file
// exists only because prerender.mjs copies it before overwriting index.html. If
// either side drifts, every fallback route either 404s (no app.html) or
// re-inherits the homepage's canonical="/". Pin both.
console.log('\nhomepage prerender ↔ Hosting fallback split is consistent')
const hostingCfg = Array.isArray(firebaseJson.hosting) ? firebaseJson.hosting[0] : firebaseJson.hosting
const prerenderMjs = read('scripts/prerender.mjs')
test('Hosting ** fallback serves the neutral shell (/app.html), not the prerendered homepage', () => {
  const fallback = (hostingCfg.rewrites || []).find((r) => r.source === '**')
  assert(fallback, 'firebase.json must keep a `**` SPA fallback rewrite')
  assert(
    fallback.destination === '/app.html',
    `the ** fallback must serve /app.html (the neutral shell) so prerendering "/" into ` +
      `index.html cannot poison fallback routes — got "${fallback.destination}"`,
  )
})
test('prerender.mjs produces dist/app.html and prerenders "/"', () => {
  assert(
    prerenderMjs.includes('copyFileSync') && /['"]app\.html['"]/.test(prerenderMjs),
    'prerender.mjs must copy the neutral dist/index.html to dist/app.html before prerendering "/"',
  )
  assert(
    /const routes = \[[^\]]*'\/'[^\]]*\]/.test(prerenderMjs) && /buildRouteList\(\)/.test(prerenderMjs),
    'prerender.mjs must include "/" in its route list so the homepage gets a snapshot',
  )
})

// Redirect SOURCES must never be advertised as canonical sitemap URLs.
// Exception: a splat redirect INTO its own base ("/teachers/**" -> "/teachers")
// is canonicalisation of sub-paths, not a parked URL — the base itself is a
// real page and may be advertised.
const redirectSources = new Set([
  ...redirects
    .filter((r) => r.destination !== r.source.replace(/\/\*\*$/, ''))
    .map((r) => r.source.replace(/\/\*\*$/, '')),
  ...routes
    .filter((r) => r.redirect && r.redirectTo !== r.path.replace(/\/\*$/, ''))
    .map((r) => r.path.replace(/\/\*$/, '')),
])
test('sitemap does not advertise any redirect source', () => {
  const bad = locs.filter((l) => redirectSources.has(l))
  assert(
    bad.length === 0,
    `sitemap lists redirecting URL(s) [${bad.join(', ')}] — list the canonical destination instead`,
  )
})

// ── 5. Public grade copy matches the active curriculum range ────────
console.log('\npublic grade copy matches active curriculum grades')
const active = getActiveGrades()
  .map((g) => g.value)
  .sort((a, b) => a - b)
const lo = active[0]
const hi = active[active.length - 1]
const rangeRe = new RegExp(`Grade\\s*${lo}\\s*[–-]\\s*${hi}`) // en-dash or hyphen
const surfaces = [
  ['manifest.webmanifest', manifest.description || ''],
  ['index.html', indexHtml],
]
for (const [label, text] of surfaces) {
  test(`${label} states the active learner grade range (${lo}-${hi})`, () => {
    assert(
      rangeRe.test(text),
      `${label} does not mention the active learner grade range "${lo}-${hi}" — public copy may be stale`,
    )
  })
  test(`${label} does not overclaim "Grade 1-12"`, () => {
    assert(
      !/Grade\s*1[–-]12/.test(text),
      `${label} still claims "Grade 1-12" but only grades ${lo}-${hi} are active for learners`,
    )
  })
}

// ── Report ──────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
