#!/usr/bin/env node
/**
 * Dashboard V2 link integrity — every hard-coded navigation target in
 * src/components/teacher/dashboardV2/ must resolve to a route declared in
 * App.jsx.
 *
 * Why: the V2 dashboard shipped with links to /teacher/settings, a route
 * that does not exist (teacher settings live under /settings/*), so half
 * the Settings surface 404'd in production. Like test-public-routes.mjs,
 * this is a text-level parse of App.jsx — cheap, deterministic, and enough
 * to catch a dead link before deploy.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRouteMatcher } from './lib/declaredRoutes.mjs'

const ROOT = new URL('..', import.meta.url).pathname

// ── Declared routes → matcher ───────────────────────────────────────
// Both files, via the shared helper: the /teacher/* routes live in their own
// table, so parsing App.jsx alone would quietly mark every teacher link dead.
const routeExists = makeRouteMatcher()

// ── Link targets used by the dashboard ──────────────────────────────
const DIR = join(ROOT, 'src/components/teacher/dashboardV2')

// Collect .js/.jsx recursively (the launcher/ subfolder holds the studio
// registry), skipping tests.
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
const files = collect(DIR)

const links = new Map() // path -> Set of files
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(DIR.length + 1)
  // to: '/x' | to="/x" | to={'/x'} | href="/x" | route: '/x' |
  // savedWorkTo: '/x' | navigate('/x'
  const patterns = [
    /\bto:\s*['"`](\/[^'"`\s]*)/g,
    /\bto=["'{]+["'`]?(\/[^'"`}\s]*)/g,
    /\bhref=["'](\/[^'"\s]*)/g,
    /\broute:\s*['"`](\/[^'"`\s]*)/g,
    /\bsavedWorkTo:\s*['"`](\/[^'"`\s]*)/g,
    /navigate\(\s*['"`](\/[^'"`\s]*)/g,
  ]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const path = m[1].split('?')[0].replace(/\/$/, '') || '/'
      if (!links.has(path)) links.set(path, new Set())
      links.get(path).add(rel)
    }
  }
}

if (links.size < 10) {
  throw new Error(`Extracted only ${links.size} link targets from dashboardV2 — extractor drifted?`)
}

// ── Assert every target resolves ────────────────────────────────────
let failed = 0
for (const [path, sources] of [...links.entries()].sort()) {
  if (routeExists(path)) {
    console.log(`  ok  ${path}`)
  } else {
    failed++
    console.error(`FAIL  ${path} — no <Route> in App.jsx matches (used in ${[...sources].join(', ')})`)
  }
}

// The known-bad path from the production 404 must never come back.
if (links.has('/teacher/settings')) {
  failed++
  console.error('FAIL  /teacher/settings is back — teacher settings live under /settings/*')
}

console.log(`\ndashboard-v2 links: ${links.size} targets checked, ${failed} broken`)
if (failed > 0) process.exit(1)
