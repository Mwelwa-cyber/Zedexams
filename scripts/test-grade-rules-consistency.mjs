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
import { EDUCATION_LEVELS } from '../src/config/educationLevels.js'
import { ASSESSMENT_TYPE_VALUES } from '../src/shared/utils/paperTaxonomy.js'

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

// ── Assessments: the teacher side spans the WHOLE ladder ────────────
// Background (the second outage this guards against): _validGrade above is
// scoped to the LEARNER-facing collections, where only grades 4-7 are switched
// on. The teacher's Assessment Studio is not so limited — a teacher builds
// papers from Nursery to Form 4, and picks one of seven canonical assessment
// types.
//
// `assessments` was gated by _validGrade plus a pre-merge assessmentType list,
// so a paper saved for ANY grade outside 4-7, or of ANY type other than
// mid_term/end_of_term, failed with an opaque "Missing or insufficient
// permissions". It looked healthy in testing only because the studio's default
// form (Grade 4, End-of-Term Test) is the one combination that passed, and the
// emulator suite only ever writes grade '7'. These tests make that drift loud.
console.log('\nassessment rules cover the whole teacher-facing ladder')

const assessmentGradeLine = rules
  .split('\n')
  .find((l) => l.includes('function _validAssessmentGrade('))

test('_validAssessmentGrade helper is defined', () => {
  assert(
    assessmentGradeLine,
    '_validAssessmentGrade definition not found in firestore.rules. Teacher '
      + 'papers must NOT be gated by the learner-scoped _validGrade.',
  )
})

test('assessments are gated by _validAssessmentGrade, not _validGrade', () => {
  const start = rules.indexOf('function validAssessmentFields()')
  const end = rules.indexOf('match /assessments/{assessmentId}')
  assert(start >= 0 && end > start, 'validAssessmentFields() block not found')
  const block = rules.slice(start, end)
  assert(
    block.includes('_validAssessmentGrade(incoming().grade)'),
    'validAssessmentFields() still gates grade through the learner-scoped '
      + '_validGrade — every ECE, Grade 1-3 and Form 1-4 paper fails to save.',
  )
})

// Quoted values inside the helper body (from its `function` line to the first
// closing brace), so the surrounding comment prose is never scraped.
const assessmentGradeAllowed = new Set(
  (assessmentGradeLine
    ? rules
      .slice(rules.indexOf(assessmentGradeLine))
      .split('}')[0]
      .match(/'([A-Za-z0-9_]+)'/g) || []
    : []
  ).map((q) => q.replace(/'/g, '')),
)

test('every studio level value is permitted by _validAssessmentGrade', () => {
  const missing = EDUCATION_LEVELS
    .map((lvl) => String(lvl.value))
    .filter((v) => !assessmentGradeAllowed.has(v))
  assert(
    missing.length === 0,
    `level value(s) [${missing.join(', ')}] can be chosen in the Assessment `
      + `Studio's grade picker but are NOT in firestore.rules _validAssessmentGrade `
      + `([${[...assessmentGradeAllowed].join(', ')}]). Saving a paper at those `
      + `levels fails with permission-denied. Widen the rule and re-deploy.`,
  )
})

const assessmentTypeAllowed = new Set(
  (rules
    .slice(rules.indexOf('function _validAssessmentType('))
    .split('}')[0]
    .match(/'([a-z_]+)'/g) || []
  ).map((q) => q.replace(/'/g, '')),
)

test('every canonical assessment type is permitted by _validAssessmentType', () => {
  const missing = ASSESSMENT_TYPE_VALUES.filter(
    (t) => !assessmentTypeAllowed.has(t),
  )
  assert(
    missing.length === 0,
    `assessment type(s) [${missing.join(', ')}] are offered by the studio's `
      + `picker (paperTaxonomy.ASSESSMENT_TYPES) but are NOT in firestore.rules `
      + `_validAssessmentType ([${[...assessmentTypeAllowed].join(', ')}]). Every `
      + `save of those paper types fails with permission-denied — the same class `
      + `of regression as the question-type list. Keep the two in sync.`,
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
