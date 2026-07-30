#!/usr/bin/env node
/**
 * Notification link integrity — every action url a Cloud Function attaches
 * to a notification must resolve to a route declared in App.jsx.
 *
 * Why: the subscription-expiry reminder and the payment-success notice both
 * shipped with `action.url = '/subscription'`, a route that does not exist
 * (the page lives at /my-subscription). Tapping "Renew now" in the bell
 * dropped the learner on the 404 page — on the two notifications most
 * likely to be about to take money. Nothing failed loudly; the sender and
 * the router simply disagreed.
 *
 * Like test-dashboard-v2-links.mjs, this is a text-level parse of App.jsx —
 * cheap, deterministic, and enough to catch a dead link before deploy.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRouteMatcher } from './lib/declaredRoutes.mjs'

const ROOT = new URL('..', import.meta.url).pathname

// ── Declared routes → matcher ───────────────────────────────────────
// Both files, via the shared helper: the /teacher/* routes live in their own
// table, so parsing App.jsx alone would quietly mark every teacher link dead.
const routeExists = makeRouteMatcher()

// ── Action urls emitted by the backend ──────────────────────────────
const DIR = join(ROOT, 'functions')

function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...collect(full)); continue }
    if (!entry.name.endsWith('.js')) continue
    if (entry.name.includes('.test.')) continue
    out.push(full)
  }
  return out
}
const files = collect(DIR)

// action: {label: "…", url: "/x"} — label is optional and may precede or
// follow the url, so match the url key inside an `action` object literal.
const ACTION_URL = /\baction:\s*\{[^}]*?\burl:\s*['"`](\/[^'"`\s]*)/g

const links = new Map() // path -> Set of files
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = file.slice(DIR.length + 1)
  for (const m of src.matchAll(ACTION_URL)) {
    // `/quiz/${quizId}` is a real link with a dynamic segment — normalise the
    // interpolation to a placeholder so it matches the /quiz/:quizId route.
    const path = m[1]
      .replace(/\$\{[^}]*\}/g, 'x')
      .split('?')[0]
      .replace(/\/$/, '') || '/'
    if (!links.has(path)) links.set(path, new Set())
    links.get(path).add(rel)
  }
}

if (links.size < 5) {
  throw new Error(`Extracted only ${links.size} notification action urls — extractor drifted?`)
}

// ── Assert every target resolves ────────────────────────────────────
let failed = 0
for (const [path, sources] of [...links.entries()].sort()) {
  if (routeExists(path)) {
    console.log(`  ok  ${path}`)
  } else {
    failed++
    console.error(`FAIL  ${path} — no <Route> in App.jsx matches (sent from ${[...sources].join(', ')})`)
  }
}

// /subscription resolves — but only because App.jsx keeps it as a redirect
// for notifications already sitting in learners' inboxes. A sender writing
// it afresh is the original bug coming back, so fail on it by name.
if (links.has('/subscription')) {
  failed++
  console.error(
    'FAIL  /subscription is back in a notification sender — the page is ' +
    `/my-subscription (sent from ${[...links.get('/subscription')].join(', ')})`,
  )
}

console.log(`\nnotification links: ${links.size} targets checked, ${failed} broken`)
if (failed > 0) process.exit(1)
