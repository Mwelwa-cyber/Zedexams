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
 * change (including the Smart Notification System backend) — from shipping. Both
 * providers have since been fully removed (their secrets, HTTP clients, and
 * provider branches). This test fails the build if either dead binding is
 * reintroduced, or if the Recraft HTTP integration or the Kie client / imports
 * creep back.
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

test('functions/index.js does not defineSecret("RECRAFT_API_KEY")', () => {
  assert(
    !/defineSecret\(\s*["']RECRAFT_API_KEY["']\s*\)/.test(indexJs),
    'functions/index.js declares defineSecret("RECRAFT_API_KEY"). The secret was ' +
      'removed from Secret Manager when Recraft was decommissioned, so binding it ' +
      'makes `firebase deploy` hard-fail ("no value for the secret: RECRAFT_API_KEY"). ' +
      'Recraft was removed — every image request renders via gpt-image-1.',
  )
})

test('the Recraft HTTP integration was removed from generateDiagram.js', () => {
  assert(
    !/external\.api\.recraft\.ai/.test(diagramJs) &&
      !/RECRAFT_ENDPOINT/.test(diagramJs) &&
      !/fetchRecraftImage/.test(diagramJs),
    'generateDiagram.js still references the Recraft HTTP endpoint/client — Recraft ' +
      'was decommissioned and every "recraft" style now renders via gpt-image-1. If you ' +
      'are genuinely re-enabling Recraft, re-fund the RECRAFT_API_KEY secret and update this guard.',
  )
})

// The image consumers must not carry a Recraft secret parameter or read the key
// any more — a re-introduced `recraftApiKeySecret` binding or a
// `process.env.RECRAFT_API_KEY` read is how a bound-but-unset secret would sneak
// back and break the deploy again. (A bare mention in a "how to re-enable"
// comment is harmless, so this deliberately does not match plain RECRAFT_API_KEY.)
for (const [label, src] of [
  ['generateDiagram.js', diagramJs],
  ['redrawTestPaperDiagram.js', redrawJs],
  ['generateSlideNotes.js', slideNotesJs],
]) {
  test(`${label} no longer binds or reads a Recraft secret`, () => {
    assert(
      !/recraftApiKeySecret/.test(src) && !/process\.env\.RECRAFT_API_KEY/.test(src),
      `${label} still binds/reads a Recraft secret (recraftApiKeySecret or ` +
        'process.env.RECRAFT_API_KEY) — the Recraft provider was removed. Route ' +
        'line-art through gpt-image-1 instead.',
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
