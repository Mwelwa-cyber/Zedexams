#!/usr/bin/env node
/**
 * Dashboard V2 link integrity — every hard-coded navigation target in the
 * dashboard surface must resolve to a route declared in App.jsx.
 *
 * Why: the V2 dashboard shipped with links to /teacher/settings, a route
 * that does not exist (teacher settings live under /settings/*), so half
 * the Settings surface 404'd in production. Like test-public-routes.mjs,
 * this is a text-level parse of App.jsx — cheap, deterministic, and enough
 * to catch a dead link before deploy.
 *
 * ## The surface is TWO directories, and forgetting the second one is how
 * ## this guard went quiet
 *
 * #2247 split the area: the app shell stays in `src/components/teacher/
 * dashboardV2/` beside TeacherLayout, and the dashboard PAGE moved to
 * `src/features/dashboardV2/`. This scanner named only the first, so it
 * silently stopped checking `HelpSupportPage` and the pages that went with
 * it — 37 targets became 32, and `/status`, `/company`, `/privacy`, `/terms`
 * and the generated library-detail path stopped being validated at all.
 *
 * It still printed `0 broken`, which is the failure mode worth naming: a
 * guard that reports green for a question it is no longer asking. Caught in
 * review by Codex, after the migration merged.
 *
 * Two changes came out of that:
 *
 *   • DIRS, not DIR — both halves are scanned, and a target is reported with
 *     the directory it came from so a message names a real file.
 *   • **A missing directory is a FAILURE, not zero files.** The whole reason
 *     the loss was silent is that a scanner pointed at a directory happily
 *     scans whatever is left. If either half is moved or renamed again, this
 *     now says so instead of quietly checking less.
 *
 * The floor below is a backstop and deliberately not the real defence: it was
 * set at 10 while the true count was 37, so losing five targets could never
 * have tripped it. A count cannot see a swap either (#2239 records the same
 * lesson on the functions manifest) — which is why the directory assertion,
 * not the number, is what protects this.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { makeRouteMatcher } from './lib/declaredRoutes.mjs'

const ROOT = new URL('..', import.meta.url).pathname

// ── Declared routes → matcher ───────────────────────────────────────
// Both files, via the shared helper: the /teacher/* routes live in their own
// table, so parsing App.jsx alone would quietly mark every teacher link dead.
const routeExists = makeRouteMatcher()

// ── Link targets used by the dashboard ──────────────────────────────
// Both halves of the surface (#2247). Each MUST exist — see the note above.
const DIRS = [
  'src/components/teacher/dashboardV2', // the app shell: sidebar, mobile chrome, nav config
  'src/features/dashboardV2',           // the dashboard pages, launcher, Help & Support
]

for (const d of DIRS) {
  if (!existsSync(join(ROOT, d))) {
    throw new Error(
      `test:dashboard-v2-links scans "${d}", which does not exist.\n` +
      'If that half of the dashboard moved, point this list at its new home in the SAME commit — ' +
      'a scanner aimed at a missing directory reports "0 broken" for files it never opened.',
    )
  }
}

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
const files = DIRS.flatMap((d) => collect(join(ROOT, d)))

const links = new Map() // path -> Set of files
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  // Relative to the repo root, so a message names a file that can be opened —
  // two directories are scanned and a bare basename would be ambiguous.
  const rel = relative(ROOT, file)
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
