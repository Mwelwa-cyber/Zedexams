#!/usr/bin/env node
/**
 * Cross-file regression test for the Lesson Plan Studio control wiring.
 *
 * Guards two things:
 * 1. The vanilla-JS studio (06-generate.js) still has the expected LANGUAGE_GUIDE
 *    and DETAIL_GUIDE keys, and still reads the medium-of-instruction field.
 * 2. ECE subjects in 02-syllabus-new.js are the three official ZECF learning
 *    areas — Nursery/Reception must NOT show "Numeracy" or bare "Mathematics".
 *
 * Note: the React select ↔ JS guide-key contract that previously checked
 * src/components/teacher/generate/LessonPlanStudio.jsx has been removed.
 * The new React studio (src/components/teacher/studio/) builds its prompts
 * directly from state and no longer couples to the vanilla JS guide maps.
 *
 * Run: npm run test:lesson-plan-controls  (also via npm run test:all)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const generateSrc = fs.readFileSync(
  path.join(ROOT, 'public', 'studio', '06-generate.js'), 'utf8')
const syllabusSrc = fs.readFileSync(
  path.join(ROOT, 'public', 'studio', '02-syllabus-new.js'), 'utf8')

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

function guideKeys(src, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(src)
  assert(m, `${name} object literal not found in 06-generate.js`)
  const keys = new Set()
  for (const km of m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) keys.add(km[1])
  return keys
}

const languageKeys = guideKeys(generateSrc, 'LANGUAGE_GUIDE')
const detailKeys   = guideKeys(generateSrc, 'DETAIL_GUIDE')

// ── Vanilla JS guide maps ──────────────────────────────────────────────────────

test('LANGUAGE_GUIDE has simple, professional, teacher keys', () => {
  for (const k of ['simple', 'professional', 'teacher']) {
    assert(languageKeys.has(k), `LANGUAGE_GUIDE is missing key "${k}"`)
  }
})

test('DETAIL_GUIDE has simplified and detailed keys', () => {
  for (const k of ['simplified', 'detailed']) {
    assert(detailKeys.has(k), `DETAIL_GUIDE is missing key "${k}"`)
  }
})

test('gatherInput reads the f-medium select', () => {
  assert(/\$\('#f-medium'\)/.test(generateSrc),
    'gatherInput in 06-generate.js does not read #f-medium — the teacher choice would be ignored')
})

test('the prompt passes the medium of instruction to the model', () => {
  assert(/Medium of instruction:/.test(generateSrc),
    "buildPrompt in 06-generate.js does not include a 'Medium of instruction:' line")
})

test('gatherInput reads the t-plan-in-medium toggle', () => {
  assert(/\$\('#t-plan-in-medium'\)/.test(generateSrc),
    'gatherInput in 06-generate.js does not read #t-plan-in-medium — the choice would be ignored')
})

test('the prompt has a whole-plan-in-the-medium branch', () => {
  assert(/ENTIRE lesson plan in \$\{medium\}/.test(generateSrc),
    'buildPrompt has no "write the ENTIRE lesson plan in {medium}" directive for the toggle')
})

// ── ECE subject correctness (the Nursery "Numeracy" bug) ──────────────────────
function eceSubjects() {
  const m = /ece:\s*\[([^\]]*)\]/.exec(syllabusSrc)
  assert(m, 'subjectsByLevel.ece array not found in 02-syllabus-new.js')
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
}

test('ECE offers the three official ZECF learning areas', () => {
  const subs = eceSubjects()
  for (const want of ['Pre-Literacy and Language', 'Pre-Mathematics and Science', 'Creative and Technology Studies']) {
    assert(subs.includes(want), `ECE is missing the "${want}" learning area (got ${JSON.stringify(subs)})`)
  }
})

test('ECE never offers "Numeracy" or a bare "Mathematics" (primary-only subjects)', () => {
  const subs = eceSubjects()
  assert(!subs.includes('Numeracy'), 'ECE must show "Pre-Mathematics and Science", not "Numeracy"')
  assert(!subs.includes('Mathematics'), 'ECE must show "Pre-Mathematics and Science", not "Mathematics"')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
