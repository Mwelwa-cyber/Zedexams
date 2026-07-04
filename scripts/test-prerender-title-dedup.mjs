#!/usr/bin/env node
/* global console, process */
/**
 * Regression test for the duplicate-<title> prerender bug.
 *
 * Root cause: PlatformSettingsContext had a useEffect that called
 * `document.title = settings.siteName` (defaulting to "ZedExams"). This
 * mutated the text of the existing static <title> element from index.html
 * instead of creating a new one. React 19's mountHoistable then inserted the
 * per-route <title> BEFORE the existing static one via:
 *   head.insertBefore(newTitle, head.querySelector("head > title"))
 * — without removing the static twin. Puppeteer's snapshot captured both,
 * producing e.g.:
 *   <title>Pricing — Free, Pro and Max plans — ZedExams</title>
 *   <title>ZedExams</title>
 *
 * Fix 1: Remove the document.title side-effect from PlatformSettingsContext
 *        so no zombie static title is left for React 19 to insert before.
 * Fix 2: Add title dedup to scripts/prerender.mjs (keep FIRST, the per-route
 *        one React 19 hoists) as defense-in-depth for any future React version
 *        or edge case that produces a second <title>.
 *
 * This test covers Fix 2 by importing the real dedup helpers from
 * scripts/prerenderHeadDedup.mjs and running them over JSDOM documents that
 * simulate the two states that could arise during prerender.
 *
 * Run: npm run test:prerender-title-dedup   (also via npm run test:all)
 */
import { JSDOM } from 'jsdom'
import { dedupMetaTags, dedupTitleTags } from './prerenderHeadDedup.mjs'

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

/** Build a JSDOM document with head HTML injected, return {window, document}. */
function makeDoc(headHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head>${headHtml}</head><body></body></html>`)
  return dom.window.document
}

// ── Title dedup ──────────────────────────────────────────────────────────────
console.log('\ntitle dedup (dedupTitleTags)')

test('single title — unchanged', () => {
  const doc = makeDoc('<title>Pricing — Free, Pro and Max plans — ZedExams</title>')
  dedupTitleTags(doc)
  const titles = [...doc.head.querySelectorAll('title')]
  assert(titles.length === 1, `expected 1 title, got ${titles.length}`)
  assert(
    titles[0].textContent === 'Pricing — Free, Pro and Max plans — ZedExams',
    `title text changed to "${titles[0].textContent}"`,
  )
})

test('two titles (React 19 regression): keeps first, removes second', () => {
  // This mirrors the exact DOM state Puppeteer captured:
  // React 19 insertBefore puts per-route title FIRST; static shell title SECOND.
  const doc = makeDoc(
    '<title>Pricing — Free, Pro and Max plans — ZedExams</title>' +
    '<title>ZedExams</title>',
  )
  const before = [...doc.head.querySelectorAll('title')]
  assert(before.length === 2, 'test setup: expected 2 titles before dedup')

  dedupTitleTags(doc)

  const titles = [...doc.head.querySelectorAll('title')]
  assert(titles.length === 1, `expected 1 title after dedup, got ${titles.length}`)
  assert(
    titles[0].textContent === 'Pricing — Free, Pro and Max plans — ZedExams',
    `wrong title kept: "${titles[0].textContent}" — should keep FIRST (per-route)`,
  )
})

test('three titles: keeps first, removes two later ones', () => {
  const doc = makeDoc(
    '<title>Teachers — ZedExams</title>' +
    '<title>ZedExams</title>' +
    '<title>ZedExams — Zambian CBC Exam Prep</title>',
  )
  dedupTitleTags(doc)
  const titles = [...doc.head.querySelectorAll('title')]
  assert(titles.length === 1, `expected 1 title after dedup, got ${titles.length}`)
  assert(
    titles[0].textContent === 'Teachers — ZedExams',
    `wrong title kept: "${titles[0].textContent}"`,
  )
})

test('no title elements — no-op, no throw', () => {
  const doc = makeDoc('<meta name="description" content="test">')
  dedupTitleTags(doc)
  const titles = [...doc.head.querySelectorAll('title')]
  assert(titles.length === 0, `expected 0 titles, got ${titles.length}`)
})

// ── Meta dedup ───────────────────────────────────────────────────────────────
console.log('\nmeta dedup (dedupMetaTags)')

test('single meta[name] — unchanged', () => {
  const doc = makeDoc('<meta name="description" content="per-route">')
  dedupMetaTags(doc)
  const metas = [...doc.head.querySelectorAll('meta[name="description"]')]
  assert(metas.length === 1, `expected 1, got ${metas.length}`)
  assert(metas[0].getAttribute('content') === 'per-route', 'content changed')
})

test('two meta[name="description"]: keeps LAST (per-route), removes first (static)', () => {
  // Static shell meta comes first; Helmet appends per-route after — keep last.
  const doc = makeDoc(
    '<meta name="description" content="generic static">' +
    '<meta name="description" content="per-route specific">',
  )
  dedupMetaTags(doc)
  const metas = [...doc.head.querySelectorAll('meta[name="description"]')]
  assert(metas.length === 1, `expected 1 meta[name=description], got ${metas.length}`)
  assert(
    metas[0].getAttribute('content') === 'per-route specific',
    `wrong meta kept: "${metas[0].getAttribute('content')}" — should keep LAST (per-route)`,
  )
})

test('meta[property] dedup: keeps last og:title', () => {
  const doc = makeDoc(
    '<meta property="og:title" content="ZedExams">' +
    '<meta property="og:title" content="Pricing — ZedExams">',
  )
  dedupMetaTags(doc)
  const metas = [...doc.head.querySelectorAll('meta[property="og:title"]')]
  assert(metas.length === 1, `expected 1, got ${metas.length}`)
  assert(
    metas[0].getAttribute('content') === 'Pricing — ZedExams',
    `wrong meta kept: "${metas[0].getAttribute('content')}"`,
  )
})

test('different meta names coexist after dedup', () => {
  const doc = makeDoc(
    '<meta name="description" content="static desc">' +
    '<meta name="keywords" content="quiz">' +
    '<meta name="description" content="per-route desc">',
  )
  dedupMetaTags(doc)
  const descriptions = [...doc.head.querySelectorAll('meta[name="description"]')]
  const keywords = [...doc.head.querySelectorAll('meta[name="keywords"]')]
  assert(descriptions.length === 1, `expected 1 description, got ${descriptions.length}`)
  assert(keywords.length === 1, `expected 1 keywords, got ${keywords.length}`)
  assert(
    descriptions[0].getAttribute('content') === 'per-route desc',
    `wrong description: "${descriptions[0].getAttribute('content')}"`,
  )
})

test('no meta elements — no-op, no throw', () => {
  const doc = makeDoc('<title>Test — ZedExams</title>')
  dedupMetaTags(doc)
  const metas = [...doc.head.querySelectorAll('meta[name], meta[property]')]
  assert(metas.length === 0, `expected 0, got ${metas.length}`)
})

// ── Combined: both dedups together ───────────────────────────────────────────
console.log('\ncombined dedup (both helpers together)')

test('combined: per-route title kept first; per-route description kept last', () => {
  const doc = makeDoc(
    // Static shell head:
    '<title>ZedExams — Zambian CBC Exam Prep</title>' +
    '<meta name="description" content="generic static">' +
    // React 19 inserts per-route title BEFORE static via insertBefore:
    // (simulate by placing it first — which is what the snapshot shows)
    // Actually the snapshot already has per-route first; let's use the other order too
    '<meta name="description" content="per-route specific">',
  )
  // Manually prepend the per-route title before the static one to mirror
  // exactly what React 19 produces via head.insertBefore:
  const perRouteTitle = doc.createElement('title')
  perRouteTitle.textContent = 'Pricing — Free, Pro and Max plans — ZedExams'
  doc.head.insertBefore(perRouteTitle, doc.head.querySelector('title'))

  assert(
    [...doc.head.querySelectorAll('title')].length === 2,
    'test setup: need 2 titles before dedup',
  )

  dedupTitleTags(doc)
  dedupMetaTags(doc)

  const titles = [...doc.head.querySelectorAll('title')]
  const descriptions = [...doc.head.querySelectorAll('meta[name="description"]')]
  assert(titles.length === 1, `expected 1 title, got ${titles.length}`)
  assert(
    titles[0].textContent === 'Pricing — Free, Pro and Max plans — ZedExams',
    `wrong title: "${titles[0].textContent}"`,
  )
  assert(descriptions.length === 1, `expected 1 description, got ${descriptions.length}`)
  assert(
    descriptions[0].getAttribute('content') === 'per-route specific',
    `wrong description: "${descriptions[0].getAttribute('content')}"`,
  )
})

// ── Source guard: PlatformSettingsContext no longer sets document.title ───────
console.log('\nsource guard: PlatformSettingsContext no longer mutates document.title')

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const platformSettingsSource = readFileSync(
  join(__dirname, '../src/contexts/PlatformSettingsContext.jsx'),
  'utf8',
)

test('PlatformSettingsContext does not set document.title', () => {
  assert(
    !platformSettingsSource.includes('document.title'),
    'PlatformSettingsContext still assigns document.title — this is the root cause ' +
      'of the duplicate <title> prerender bug. Remove the document.title= side-effect.',
  )
})

// ── Report ────────────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
