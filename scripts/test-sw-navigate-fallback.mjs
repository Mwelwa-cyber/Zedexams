#!/usr/bin/env node
/* global console, process */
/**
 * Guard for the service worker's SPA-fallback denylist.
 *
 * The bug this exists to prevent: VitePWA's `navigateFallback` answers every
 * navigation request with the precached index.html, so a browser navigation to
 * a real static file (/sitemap.xml, /robots.txt, a bundled PDF) got the SPA
 * shell and React Router rendered NotFound — a "404" for a file that ships in
 * dist/ and that Firebase Hosting serves correctly. It reproduces only on a
 * return visit in a real browser (curl and crawlers have no service worker),
 * which is what made it look like a hosting problem.
 *
 * Two directions, both load-bearing:
 *   - every file we actually ship at the origin root must be denied the
 *     fallback (otherwise it 404s for returning users);
 *   - every declared route must NOT be denied (otherwise deep links stop
 *     working offline, and break outright if the extension rule ever
 *     over-matches a real route).
 *
 * Run: npm run test:sw-navigate-fallback   (also via npm run test:all)
 */
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NAVIGATE_FALLBACK_DENYLIST,
  isNavigateFallbackDenied,
} from './lib/swNavigateFallback.mjs'
import { declaredRoutePaths } from './lib/declaredRoutes.mjs'
import { buildRouteList } from './prerenderRoutes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

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

const denied = (p) => isNavigateFallbackDenied(p)

console.log('\nservice worker never answers a file request with the SPA shell')

// The three files the outage report named, pinned by name so they can't
// regress behind a refactor of the generic rule.
for (const file of ['/sitemap.xml', '/robots.txt', '/llms.txt']) {
  test(`${file} bypasses the SPA fallback`, () => {
    assert(denied(file), `${file} would be answered with index.html — it renders the React 404 instead of the file`)
  })
}

test('every file shipped at the origin root bypasses the SPA fallback', () => {
  const rootFiles = readdirSync(join(root, 'public'))
    .filter((name) => !name.startsWith('.'))
    .filter((name) => statSync(join(root, 'public', name)).isFile())
  assert(rootFiles.length > 0, 'found no files in public/ — did the directory move?')

  const leaked = rootFiles.filter((name) => !denied(`/${name}`))
  assert(
    leaked.length === 0,
    `these ship at the origin root but the SW would answer them with index.html: ${leaked.join(', ')}`
  )
})

test('static files in nested public/ directories bypass the SPA fallback', () => {
  // The exam timetable is the case that was already found the hard way — it
  // is linked with target="_blank", which makes it a navigation request.
  const nested = [
    '/timetables/grade-7-2026-exam-timetable.pdf',
    '/syllabi/curriculum-data-2013.json',
    '/notes/example-diagram.png',
  ]
  const leaked = nested.filter((p) => !denied(p))
  assert(leaked.length === 0, `nested static files not denied: ${leaked.join(', ')}`)
})

test("Firebase's reserved namespace bypasses the SPA fallback", () => {
  assert(denied('/__/auth/handler'), '/__/auth/handler must reach the network')
})

console.log('\nreal routes still get the SPA fallback (deep links keep working offline)')

test('no declared route is denied the SPA fallback', () => {
  // Route patterns, not URLs — strip the react-router wildcards/params so we
  // test the concrete paths a user can actually land on.
  const concrete = declaredRoutePaths()
    .filter((p) => p.startsWith('/'))
    .map((p) => p.replace(/\/\*$/, ''))
    .filter((p) => !p.includes(':') && p !== '*')
  assert(concrete.length > 50, `expected the full route table, got ${concrete.length} paths`)

  const broken = concrete.filter((p) => denied(p || '/'))
  assert(
    broken.length === 0,
    `these are real routes but the SW would stop serving the app shell for them: ${broken.join(', ')}`
  )
})

test('no prerendered/advertised route is denied the SPA fallback', () => {
  const broken = buildRouteList().filter((p) => denied(p))
  assert(broken.length === 0, `sitemap-advertised routes denied the shell: ${broken.join(', ')}`)
})

test('a query string cannot make a route look like a file', () => {
  // Matched against pathname + search, so a `.` in the query must not count.
  for (const p of ['/papers?q=notes.pdf', '/blog?tag=grade-7.2', '/games/leaderboard?from=a.b']) {
    assert(!denied(p), `${p} is a route with a dotted query — must still get the shell`)
  }
})

console.log('\nthe denylist itself stays honest')

test('no origin-shaped pattern (they can never match pathname + search)', () => {
  // workbox tests `url.pathname + url.search`, so /^https?:\/\/…/ is dead
  // code that reads as protection. Three sat in this list for a year.
  const dead = NAVIGATE_FALLBACK_DENYLIST.filter((re) => re.source.includes('http'))
  assert(
    dead.length === 0,
    `these can never fire — workbox matches pathname + search, not a URL: ${dead.map(String).join(', ')}`
  )
})

test('every pattern is anchored at the start of the path', () => {
  const unanchored = NAVIGATE_FALLBACK_DENYLIST.filter((re) => !re.source.startsWith('^'))
  assert(
    unanchored.length === 0,
    `unanchored patterns match mid-path and will deny real routes: ${unanchored.map(String).join(', ')}`
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
