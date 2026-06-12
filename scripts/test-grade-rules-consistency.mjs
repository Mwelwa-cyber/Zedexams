#!/usr/bin/env node
/* global console, process */
/**
 * Static-text regression test: firestore.rules _validGrade allowlist must
 * cover every grade currently marked active in the curriculum.
 *
 * Background (the outage this guards against): the learner-facing collections
 * (quizzes/lessons/results) gate `grade` through the rules helper
 *
 *     function _validGrade(value) { return value is string && value in ['4','5','6','7']; }
 *
 * while src/config/curriculum.js's ALL_GRADES is the source of truth for which
 * grades the product has switched on (`active: true`). Today only grades 4-7
 * are active and the rule allows 4-7, so they agree.
 *
 * The day someone flips grade 8 to `active: true` in curriculum.js WITHOUT
 * widening _validGrade, every grade-8 quiz/lesson write silently fails with an
 * opaque `permission-denied` — the exact silent-permission-denied drift this
 * test catches. We deliberately do NOT edit firestore.rules here (a rules edit
 * caused a production regression); instead we fail loudly so the rule + the
 * curriculum get widened together, intentionally.
 *
 * This mirrors the text-scraping style of scripts/test-firestore-rules-text.mjs
 * — it does NOT spin up the Firestore emulator.
 *
 * Run: npm run test:grade-rules  (also via npm run test:all)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ALL_GRADES, getActiveGrades } from '../src/config/curriculum.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')
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

// ── Locate the _validGrade allowlist literal in the rules text ──────
console.log('\n_validGrade allowlist stays in sync with active curriculum grades')

const validGradeLine = rules
  .split('\n')
  .find((l) => l.includes('function _validGrade('))

test('_validGrade helper is defined', () => {
  assert(validGradeLine, '_validGrade definition not found in firestore.rules')
})

// Extract the quoted grade values inside the helper's `in [...]` array.
const allowed = new Set(
  (validGradeLine ? validGradeLine.match(/'(\d+)'/g) || [] : []).map((q) =>
    q.replace(/'/g, ''),
  ),
)

test('_validGrade allowlist is non-empty', () => {
  assert(allowed.size > 0, `could not parse any grade from: ${validGradeLine}`)
})

// ── Every active grade must appear in the rules allowlist ───────────
const active = getActiveGrades()

test('every active curriculum grade is permitted by _validGrade', () => {
  const missing = active
    .map((g) => String(g.value))
    .filter((v) => !allowed.has(v))
  assert(
    missing.length === 0,
    `curriculum grade(s) [${missing.join(', ')}] are active in ALL_GRADES but `
      + `NOT in firestore.rules _validGrade ([${[...allowed].join(', ')}]). A learner `
      + `write for these grades would fail with permission-denied. Widen _validGrade `
      + `(and re-deploy rules via CI) together with flipping the grade active.`,
  )
})

// Document the present-day invariant so the test reads as a spec: 4-7 active.
test('sanity: exactly grades 4-7 are active today (update with intent)', () => {
  const activeValues = active.map((g) => g.value).sort((a, b) => a - b)
  assert(
    JSON.stringify(activeValues) === JSON.stringify([4, 5, 6, 7]),
    `active grades changed to [${activeValues.join(', ')}]. That's allowed — but `
      + `confirm firestore.rules _validGrade was widened to match before deploying. `
      + `(ALL_GRADES total: ${ALL_GRADES.length})`,
  )
})

// ── Report ──────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
