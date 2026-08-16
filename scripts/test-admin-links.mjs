#!/usr/bin/env node
/**
 * Admin link integrity — every hard-coded navigation target in the admin
 * surface must resolve to a route declared in App.jsx.
 *
 * The teacher surface has had this guard since /teacher/settings shipped as a
 * dead link and 404'd in production (`test-dashboard-v2-links.mjs`). The admin
 * surface had nothing, while carrying a comparable amount of navigation: the
 * shell registry alone declares thirty-odd destinations, and the dashboard
 * adds a quick-action grid and an attention list on top. All of it was
 * hand-maintained against a route table in a different file.
 *
 * Same shape as the teacher guard on purpose — a text-level parse of the
 * declared routes, which is cheap, deterministic, and enough to catch a dead
 * link before deploy.
 *
 * ## A missing DIRS entry fails; it does not silently scan less
 *
 * A scanner aimed at a directory that is not there reports "0 broken" for
 * files it never opened. Every entry below is asserted to exist, so moving a
 * feature folder fails this test in the same commit rather than quietly
 * dropping its links from coverage.
 *
 * ## Dynamic targets are reported, not silently dropped
 *
 * `to={`/admin/users/${uid}`}` cannot be checked against a route table by
 * reading the source, so it is excluded — but the count is PRINTED. A guard
 * that skips work without saying so reads exactly like one that found nothing
 * wrong, which is the failure this file was written about.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { makeRouteMatcher } from './lib/declaredRoutes.mjs'

const ROOT = new URL('..', import.meta.url).pathname

const routeExists = makeRouteMatcher()

// Every directory that DECLARES an admin navigation target. Each MUST exist.
//
// This scanner reads link targets out of FILES on disk; it does not follow the
// import graph, so a registry is covered only if its directory is named here.
const DIRS = [
  'src/features/adminShell',      // the nav registry, sidebar, drawer, ⌘K palette
  'src/features/adminHome',       // the dashboard: quick actions + attention list
  'src/features/adminContent',
  'src/features/adminLearners',
  'src/features/adminUsers',
  'src/features/adminPayments',
  'src/features/adminQuestionBank',
  'src/features/adminSettings',
  'src/features/adminAnalytics',
  'src/features/adminPastPapers',
  'src/features/adminCurriculum',
  'src/features/adminAiCosts',
  'src/features/adminTrials',
  'src/features/adminFeedback',
  'src/features/adminCbcKb',
  'src/features/adminAppCheck',
  'src/features/adminMfa',
]

for (const d of DIRS) {
  if (!existsSync(join(ROOT, d))) {
    throw new Error(
      `test:admin-links scans "${d}", which does not exist.\n` +
      'If that part of the admin moved, point this list at its new home in the SAME commit — ' +
      'a scanner aimed at a missing directory reports "0 broken" for files it never opened.',
    )
  }
}

function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...collect(full)); continue }
    if (!(entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) continue
    if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue
    out.push(full)
  }
  return out
}
const files = DIRS.flatMap((d) => collect(join(ROOT, d)))

const patterns = [
  /\bto:\s*['"`](\/[^'"`\s]*)/g,
  /\bto=["'{]+["'`]?(\/[^'"`}\s]*)/g,
  /\bhref=["'](\/[^'"\s]*)/g,
  /\broute:\s*['"`](\/[^'"`\s]*)/g,
  /navigate\(\s*['"`](\/[^'"`\s]*)/g,
]

const links = new Map()   // path -> Set of files
const dynamic = new Map() // raw target -> Set of files (reported, not checked)

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const raw = m[1]
      // A template hole (`${id}`) means the tail is data, not a literal.
      if (raw.includes('$')) {
        if (!dynamic.has(raw)) dynamic.set(raw, new Set())
        dynamic.get(raw).add(rel)
        continue
      }
      const path = raw.split('?')[0].split('#')[0].replace(/\/$/, '') || '/'
      if (!links.has(path)) links.set(path, new Set())
      links.get(path).add(rel)
    }
  }
}

// A floor, as a backstop against the extractor silently drifting to nothing.
// It is not the defence — the existence check above is — and it cannot see a
// swapped target, so keep it well under the real count.
if (links.size < 25) {
  throw new Error(`Extracted only ${links.size} link targets from the admin surface — extractor drifted?`)
}

let failed = 0
for (const [path, sources] of [...links.entries()].sort()) {
  if (routeExists(path)) {
    console.log(`  ok  ${path}`)
  } else {
    failed++
    console.error(`FAIL  ${path} — no <Route> matches (used in ${[...sources].join(', ')})`)
  }
}

if (dynamic.size) {
  console.log(`\n  ${dynamic.size} dynamic target(s) not checkable from source:`)
  for (const [raw, sources] of [...dynamic.entries()].sort()) {
    console.log(`    skip  ${raw} (${[...sources].join(', ')})`)
  }
}

console.log(`\nadmin links: ${links.size} targets checked, ${failed} broken`)
if (failed > 0) process.exit(1)
