#!/usr/bin/env node
/**
 * Static-text regression tests for storage.rules.
 *
 * Companion to scripts/test-firestore-rules-text.mjs (PR #411). Same
 * approach: parse the rules file as text, assert the load-bearing
 * strings are still there. Does NOT spin up the Storage emulator.
 *
 * Why these matter:
 *   - The closest precedent (#398 + #399) silently broke Firestore
 *     writes because nobody re-checked the rules after adding a new
 *     question type. The same class of regression would land here if
 *     someone widened the Storage upload set without updating rules,
 *     or accidentally dropped a content-type from a validator.
 *   - The catch-all `match /{allPaths=**} { allow read, write: if false }`
 *     is the single thing standing between a misconfigured client and
 *     "anyone can upload anything anywhere." A bad refactor could remove
 *     it; the test pins it.
 *
 * Run: npm run test:storage-rules-text  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'storage.rules')
const rules = readFileSync(RULES_PATH, 'utf8')

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

function assertContains(needle, why) {
  assert(rules.includes(needle), `rules missing: ${needle} (${why})`)
}

// ── structural invariants ───────────────────────────────────────

console.log('\nstructural invariants')

test('rules_version is v2', () => {
  assert(/rules_version\s*=\s*'2'/.test(rules), "must declare rules_version = '2'")
})

test('catch-all deny is the last match block', () => {
  // The catch-all keeps unspecified paths closed. Removing it would
  // open every path that isn't explicitly matched.
  assertContains('match /{allPaths=**}', 'catch-all match block is missing')
  // The deny clause should follow immediately.
  const block = rules.match(/match \/\{allPaths=\*\*\}\s*\{([^}]+)\}/s)
  assert(block, 'could not isolate catch-all match block')
  assert(/allow read, write:\s*if false/.test(block[1]), 'catch-all is no longer deny-all')
})

test('invoices path is server-write-only', () => {
  // Receipts are written by the invoiceGenerator Cloud Function
  // (admin SDK bypasses rules). Anything else attempting a write
  // must be rejected.
  const block = rules.match(/match \/invoices\/\{[^}]+\}\/\{[^}]+\}\s*\{([\s\S]*?)^\s*\}/m)
  assert(block, 'invoices match block not found')
  assert(/allow write:\s*if false/.test(block[1]), 'invoices write is no longer false')
})

// ── upload content-type whitelists ──────────────────────────────

console.log('\nupload validator content-type whitelists')

test('paper uploads remain PDF-only', () => {
  // PR #383+ added past papers as PDFs. Widening this to allow other
  // types would mean a teacher could upload an HTML payload that the
  // PDF viewer renders, breaking content sandboxing.
  assertContains("request.resource.contentType == 'application/pdf'", 'validPaperUpload no longer pins to PDF')
})

test('quiz/assessment images remain jpeg|png|webp (no SVG, no gif)', () => {
  // SVG can carry script. GIFs are animated and distracting in an
  // exam UI — assessment doesn't allow them either.
  const quizImgFn = rules.match(/function validQuizImageUpload\(\)[\s\S]*?\}/)
  assert(quizImgFn, 'validQuizImageUpload not found')
  assert(/image\/\(jpeg\|png\|webp\)/.test(quizImgFn[0]), 'quiz-image whitelist no longer matches jpeg|png|webp')
  assert(!/image\/svg/.test(quizImgFn[0]), 'SVG is back in quiz uploads — script-injection risk')
  assert(!/image\/gif/.test(quizImgFn[0]), 'GIF is back in quiz uploads')
})

test('lesson presentations explicitly exclude SVG', () => {
  // The existing comment in storage.rules calls out the SVG risk
  // explicitly. Don't let the next refactor lose that.
  const presFn = rules.match(/function validLessonPresentationUpload\(\)[\s\S]*?\}/)
  assert(presFn, 'validLessonPresentationUpload not found')
  assert(!/image\/svg/.test(presFn[0]), 'SVG re-added to lesson-presentations — script-injection risk')
})

test('lesson-files whole-note uploads remain PDF or Word only', () => {
  const fileFn = rules.match(/function validLessonFileUpload\(\)[\s\S]*?\}/)
  assert(fileFn, 'validLessonFileUpload not found')
  assert(/application\/pdf/.test(fileFn[0]), 'lesson-files no longer allows PDF')
  assert(/application\/msword/.test(fileFn[0]), 'lesson-files no longer allows DOC')
  assert(/wordprocessingml/.test(fileFn[0]), 'lesson-files no longer allows DOCX')
})

// ── upload size caps ────────────────────────────────────────────

console.log('\nupload size caps')

test('paper upload cap is 50 MB (multi-image scanned papers)', () => {
  assertContains('request.resource.size < 50 * 1024 * 1024', 'validPaperUpload size cap moved')
})

test('paper upload accepts PDF + scanned-image MIME types', () => {
  assertContains("request.resource.contentType == 'application/pdf'", 'paper PDF MIME missing')
  assertContains("request.resource.contentType == 'image/jpeg'", 'paper JPEG MIME missing')
  assertContains("request.resource.contentType == 'image/png'", 'paper PNG MIME missing')
})

test('quiz/assessment image cap stays at 5 MB', () => {
  // Two functions share this cap — search for the literal so both pass.
  const matches = rules.match(/request\.resource\.size\s*[<≤=]+\s*5\s*\*\s*1024\s*\*\s*1024/g)
  assert(matches && matches.length >= 2, `expected ≥2 size caps at 5 MB, got ${matches?.length || 0}`)
})

test('lesson-files (whole-note) cap stays at 25 MB', () => {
  assertContains('request.resource.size <= 25 * 1024 * 1024', 'validLessonFileUpload cap moved')
})

test('lesson presentations cap stays at 50 MB', () => {
  assertContains('request.resource.size <= 50 * 1024 * 1024', 'validLessonPresentationUpload cap moved')
})

// ── path-segment ownership gating ───────────────────────────────

console.log('\nownership gating')

test('every per-user upload path requires ownsPath(ownerUid)', () => {
  // The pattern: `{ownerUid}` placeholder in the match path + an
  // `ownsPath(ownerUid)` check inside. If anyone removes the check,
  // a teacher could upload to /quiz-images/<some-other-teacher>/<…>.
  const userPaths = [
    'match /papers/{ownerUid}/',
    'match /quiz-images/{ownerUid}/',
    'match /assessment-images/{ownerUid}/',
    'match /lesson-images/{ownerUid}/',
    'match /lesson-presentations/{ownerUid}/',
    'match /lesson-files/{ownerUid}/',
  ]
  for (const path of userPaths) {
    const idx = rules.indexOf(path)
    assert(idx >= 0, `match path missing: ${path}`)
    // Look at the next ~600 chars (the match block body) for the
    // ownership check on a create/update.
    const slice = rules.slice(idx, idx + 600)
    assert(
      slice.includes('ownsPath(ownerUid)'),
      `${path} no longer enforces ownsPath(ownerUid) — cross-user upload possible`
    )
  }
})

test('inline lesson images rule sits before the bare lesson-files match', () => {
  // The {fileName=**} wildcard would otherwise swallow the /inline/
  // segment, applying validLessonFileUpload (PDF/DOC only) to image
  // uploads and silently rejecting every inline image.
  const inlineIdx = rules.indexOf('match /lesson-files/{ownerUid}/{assetBatchId}/inline/')
  const bareIdx = rules.indexOf('match /lesson-files/{ownerUid}/{assetBatchId}/{fileName=**}')
  assert(inlineIdx > 0, 'inline lesson-files match not found')
  assert(bareIdx > 0, 'bare lesson-files match not found')
  assert(inlineIdx < bareIdx, 'inline match must appear before the bare match — order matters for the wildcard')
})

// ── public/anonymous read surfaces ──────────────────────────────

console.log('\npublic read surfaces (intended)')

test('syllabi PDFs remain world-readable', () => {
  // The viewer iframe loads syllabi without auth tokens, so anonymous
  // reads must stay allowed. Removing this breaks the syllabi viewer.
  const block = rules.match(/match \/syllabi\/\{fileName=\*\*\}\s*\{([\s\S]*?)^\s*\}/m)
  assert(block, 'syllabi match block not found')
  assert(/allow read:\s*if true/.test(block[1]), 'syllabi is no longer world-readable — viewer iframe will break')
})

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
