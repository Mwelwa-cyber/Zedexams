#!/usr/bin/env node
/**
 * Cross-file regression test for the Lesson Plan Studio control wiring.
 *
 * The studio's "Lesson plan type" and "Language level" <select>s live in the
 * React markup (src/components/teacher/generate/LessonPlanStudio.jsx), but the
 * option VALUES are only honoured if they are keys in the LANGUAGE_GUIDE /
 * DETAIL_GUIDE maps in public/studio/06-generate.js — otherwise the prompt
 * silently falls back to the default and the teacher's choice is ignored. This
 * test pins that contract so the two files can never drift apart.
 *
 * It also guards the curriculum correctness the studio is expected to show:
 * Early Childhood Education subjects must be the three official ZECF learning
 * areas (Pre-Literacy and Language, Pre-Mathematics and Science, Creative and
 * Technology Studies) — and Nursery/Reception must NOT offer "Numeracy" or a
 * bare "Mathematics", which are primary-grade subjects, not ECE ones.
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
const studioJsx = fs.readFileSync(
  path.join(ROOT, 'src', 'components', 'teacher', 'generate', 'LessonPlanStudio.jsx'), 'utf8')
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

// Extract the top-level keys of a `const NAME = { ... };` object literal. The
// guide values are single-line strings, so a line-anchored `key:` only ever
// matches the real keys (comments start with `//`, the close is `};`).
function guideKeys(src, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(src)
  assert(m, `${name} object literal not found in 06-generate.js`)
  const keys = new Set()
  for (const km of m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)) keys.add(km[1])
  return keys
}

// Extract a <select>'s defaultValue + option values from the JSX.
function selectBlock(jsx, id) {
  const m = new RegExp(`<select id="${id}"([^>]*)>([\\s\\S]*?)</select>`).exec(jsx)
  assert(m, `<select id="${id}"> not found in LessonPlanStudio.jsx`)
  const def = /defaultValue="([^"]*)"/.exec(m[1])
  const values = [...m[2].matchAll(/<option value="([^"]*)"/g)].map((o) => o[1])
  return { defaultValue: def ? def[1] : null, values }
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x))
}

const languageKeys = guideKeys(generateSrc, 'LANGUAGE_GUIDE')
const detailKeys = guideKeys(generateSrc, 'DETAIL_GUIDE')
const langSelect = selectBlock(studioJsx, 'f-language-level')
const typeSelect = selectBlock(studioJsx, 'f-detail-level')

// ── Language level (Simple / Professional / Detailed Teacher Language) ─────────
test('language select offers exactly the three requested levels', () => {
  assert(sameSet(langSelect.values, ['simple', 'professional', 'teacher']),
    `unexpected language options: ${JSON.stringify(langSelect.values)}`)
})

test('every language option is wired to a LANGUAGE_GUIDE entry', () => {
  for (const v of langSelect.values) {
    assert(languageKeys.has(v),
      `language option "${v}" has no LANGUAGE_GUIDE key — its choice would be ignored`)
  }
})

test('language select defaults to a valid key (professional)', () => {
  assert(langSelect.defaultValue === 'professional',
    `expected default "professional", got "${langSelect.defaultValue}"`)
  assert(languageKeys.has(langSelect.defaultValue), 'default language is not a guide key')
})

// ── Lesson plan type (Simplified / Detailed) ──────────────────────────────────
test('lesson plan type select offers exactly Simplified + Detailed', () => {
  assert(sameSet(typeSelect.values, ['simplified', 'detailed']),
    `unexpected lesson plan type options: ${JSON.stringify(typeSelect.values)}`)
})

test('every lesson plan type option is wired to a DETAIL_GUIDE entry', () => {
  for (const v of typeSelect.values) {
    assert(detailKeys.has(v),
      `lesson plan type option "${v}" has no DETAIL_GUIDE key — its choice would be ignored`)
  }
})

test('lesson plan type select defaults to a valid key (simplified)', () => {
  assert(typeSelect.defaultValue === 'simplified',
    `expected default "simplified", got "${typeSelect.defaultValue}"`)
  assert(detailKeys.has(typeSelect.defaultValue), 'default lesson plan type is not a guide key')
})

// ── Medium of instruction (English + the 7 Zambian zonal languages) ───────────
const mediumSelect = selectBlock(studioJsx, 'f-medium')

test('medium-of-instruction select offers English + the 7 zonal languages', () => {
  assert(sameSet(mediumSelect.values,
    ['English', 'Bemba', 'Nyanja', 'Tonga', 'Lozi', 'Kaonde', 'Lunda', 'Luvale']),
    `unexpected medium options: ${JSON.stringify(mediumSelect.values)}`)
})

test('medium select defaults to English', () => {
  assert(mediumSelect.defaultValue === 'English',
    `expected default "English", got "${mediumSelect.defaultValue}"`)
})

test('gatherInput reads the f-medium select', () => {
  assert(/\$\('#f-medium'\)/.test(generateSrc),
    'gatherInput in 06-generate.js does not read #f-medium — the teacher choice would be ignored')
})

test('the prompt passes the medium of instruction to the model', () => {
  assert(/Medium of instruction:/.test(generateSrc),
    "buildPrompt in 06-generate.js does not include a 'Medium of instruction:' line")
})

// ── "Write the whole plan in the local language" toggle ───────────────────────
test('studio offers the whole-plan-in-local-language toggle (default off)', () => {
  const m = /<div className="toggle-row([^"]*)" id="t-plan-in-medium" data-on="(true|false)"/.exec(studioJsx)
  assert(m, 'the t-plan-in-medium toggle-row is missing from LessonPlanStudio.jsx')
  assert(m[2] === 'false' && !/\bon\b/.test(m[1]),
    'the t-plan-in-medium toggle must default OFF (English document is the default)')
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
