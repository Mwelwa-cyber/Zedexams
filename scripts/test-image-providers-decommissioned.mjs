#!/usr/bin/env node
/* global console, process */
/**
 * Regression guard — the decommissioned image providers (RECRAFT and KIE) must
 * not be bound as Cloud Functions secrets.
 *
 * Why this exists: both providers were retired and their secrets removed from
 * Secret Manager (Recraft 2026-06, Kie 2026-07) — every image request is now
 * served by gpt-image-1. But the code still declared `defineSecret("…")` and
 * bound each key to generateDiagram / redrawTestPaperDiagram / generateVisualNotes.
 * A `defineSecret()` bound to a function whose value no longer exists makes
 * `firebase deploy` HARD-FAIL in non-interactive CI:
 *
 *   Error: In non-interactive mode but have no value for the secret:
 *   RECRAFT_API_KEY
 *
 * That blocked the entire Deploy Firebase job — and therefore every functions
 * change (including the Smart Notification System backend) — from shipping. This
 * test fails the build if either dead binding is reintroduced, if the RECRAFT
 * consumers stop guarding `.value()` behind a truthiness check (what lets the
 * factories accept a `null` secret without throwing), or if the removed Kie
 * client / imports creep back.
 *
 * Plain `node`, so it runs inside `npm run test:all` (the required CI check).
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

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

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const indexJs = read('functions/index.js')
const diagramJs = read('functions/teacherTools/generateDiagram.js')
const redrawJs = read('functions/teacherTools/testPaperImport/redrawTestPaperDiagram.js')
const slideNotesJs = read('functions/teacherTools/generateSlideNotes.js')

// ── RECRAFT ───────────────────────────────────────────────────────────────
console.log('\nRECRAFT is decommissioned and must not block deploys')

test('generateDiagram.js keeps RECRAFT_ENABLED = false', () => {
  assert(
    /const\s+RECRAFT_ENABLED\s*=\s*false/.test(diagramJs),
    'RECRAFT_ENABLED is no longer false — if Recraft was genuinely re-enabled, ' +
      're-declare + re-fund the RECRAFT_API_KEY secret and update this guard.',
  )
})

test('functions/index.js does not defineSecret("RECRAFT_API_KEY")', () => {
  assert(
    !/defineSecret\(\s*["']RECRAFT_API_KEY["']\s*\)/.test(indexJs),
    'functions/index.js declares defineSecret("RECRAFT_API_KEY"). The secret was ' +
      'removed from Secret Manager when Recraft was decommissioned, so binding it ' +
      'makes `firebase deploy` hard-fail ("no value for the secret: RECRAFT_API_KEY"). ' +
      'Pass `null` for the recraft secret to the diagram/redraw/visual-notes factories instead.',
  )
})

// The RECRAFT consumers must guard `.value()` behind a truthiness check so a
// `null` recraft secret resolves to "" rather than throwing on .value().
for (const [label, src] of [
  ['generateDiagram.js', diagramJs],
  ['redrawTestPaperDiagram.js', redrawJs],
  ['generateSlideNotes.js', slideNotesJs],
]) {
  test(`${label} guards recraftApiKeySecret.value() behind a truthiness check`, () => {
    // An UNguarded `recraftApiKeySecret.value()` is one not immediately preceded
    // by the `recraftApiKeySecret ?` ternary test. Strip the guarded form first;
    // any remaining `.value()` on the secret is the unsafe pattern.
    const withoutGuarded = src.replace(
      /recraftApiKeySecret\s*\?\s*\n?\s*\(recraftApiKeySecret\.value\(\)/g,
      '',
    )
    assert(
      !/recraftApiKeySecret\.value\(\)/.test(withoutGuarded),
      `${label} calls recraftApiKeySecret.value() without a preceding ` +
        '`recraftApiKeySecret ? ...` guard — a null secret (Recraft is disabled) ' +
        'would throw at runtime. Guard it like the other decommissioned providers.',
    )
  })
}

// ── KIE ─────────────────────────────────────────────────────────────────────
console.log('\nKIE is decommissioned — no secret binding, no client, no imports')

test('functions/index.js does not defineSecret("KIE_API_KEY")', () => {
  assert(
    !/defineSecret\(\s*["']KIE_API_KEY["']\s*\)/.test(indexJs),
    'functions/index.js declares defineSecret("KIE_API_KEY"). Kie was decommissioned ' +
      'and its secret removed from Secret Manager, so binding it makes `firebase deploy` ' +
      'hard-fail. The "colour illustration" style now renders via gpt-image-1 — do not ' +
      'bind a Kie secret.',
  )
})

test('functions/kieClient.js was removed', () => {
  assert(
    !existsSync(join(ROOT, 'functions/kieClient.js')),
    'functions/kieClient.js is back. Kie was decommissioned; the client should not ' +
      'exist. If you are genuinely re-enabling Kie, update this guard.',
  )
})

for (const [label, rel] of [
  ['generateDiagram.js', 'functions/teacherTools/generateDiagram.js'],
  ['redrawTestPaperDiagram.js', 'functions/teacherTools/testPaperImport/redrawTestPaperDiagram.js'],
]) {
  const src = read(rel)
  test(`${label} does not import the removed kieClient`, () => {
    assert(
      !/require\(\s*["'][^"']*kieClient["']\s*\)/.test(src) &&
        !/generateKieImage|KieError/.test(src),
      `${label} still references kieClient/generateKieImage/KieError — the Kie client ` +
        'was removed. Route colour illustrations through gpt-image-1 instead.',
    )
  })
}

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
