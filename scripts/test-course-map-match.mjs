#!/usr/bin/env node
/**
 * Tests for the practice Course Map fuzzy matcher
 * (src/utils/courseMapMatch.js).
 *
 * Regression guard for the bug where quizzes whose author-entered topic/title
 * carried a section number, a leading "The", or a "— Practice Quiz" suffix
 * never matched their subtopic and all spilled into "Other quizzes" while the
 * real subtopic showed "No quizzes yet — coming soon".
 *
 * Run: npm run test:course-map-match
 */

import { normalizeForMatch, matchName } from '../src/utils/courseMapMatch.js'

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

function eq(actual, expected, msg) {
  assert(actual === expected, `${msg || ''} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// Grade 7 Science subtopics, exactly as in src/config/curriculum.js
const SCIENCE_SUBTOPICS = [
  'Digestive System',
  'Diseases', 'Fruits',
  'Separating Substances', 'Water Supply Systems',
  'The Flower', 'Pollination and Fertilisation in Flowering Plants', 'Fruits and Seeds', 'Seed Dispersal', 'Propagation',
  'Energy', 'Electric Current and Circuits', 'Lightning', 'The Solar System', 'Metals and Non-metals', 'Mining',
]

// ── normalizeForMatch ─────────────────────────────────────────────
test('normalize strips leading section number', () => {
  eq(normalizeForMatch('5.6 Mining'), 'mining')
  eq(normalizeForMatch('2.1 Diseases'), 'diseases')
  eq(normalizeForMatch('12. Energy'), 'energy')
})

test('normalize strips Practice Quiz suffix and dashes', () => {
  eq(normalizeForMatch('5.6 Mining — Practice Quiz'), 'mining')
  eq(normalizeForMatch('Metals and Non-metals — Practice Quiz'), 'metals and non metals')
})

test('normalize strips a leading article', () => {
  eq(normalizeForMatch('1.1 The Digestive System'), 'digestive system')
  eq(normalizeForMatch('The Solar System'), 'solar system')
})

test('normalize is idempotent on a clean subtopic name', () => {
  eq(normalizeForMatch('Digestive System'), 'digestive system')
})

// ── matchName: the exact cases from the reported screenshots ───────
const CASES = [
  ['1.1 The Digestive System — Practice Quiz', 'Digestive System'],
  ['2.1 Diseases — Practice Quiz',             'Diseases'],
  ['2.2 Fruits — Practice Quiz',               'Fruits'],
  ['3.1 Separating Substances — Practice Quiz','Separating Substances'],
  ['3.2 Water Supply Systems — Practice Quiz', 'Water Supply Systems'],
  ['4.1 The Flower — Practice Quiz',           'The Flower'],
  ['4.2 Pollination and Fertilisation — Practice Quiz', 'Pollination and Fertilisation in Flowering Plants'],
  ['4.3 Fruits and Seeds — Practice Quiz',     'Fruits and Seeds'],
  ['4.4 Seed Dispersal — Practice Quiz',       'Seed Dispersal'],
  ['4.5 Propagation — Practice Quiz',          'Propagation'],
  ['5.1 Energy — Practice Quiz',               'Energy'],
  ['5.2 Electric Current and Circuits — Practice Quiz', 'Electric Current and Circuits'],
  ['5.4 The Solar System — Practice Quiz',     'The Solar System'],
  ['5.5 Metals and Non-metals — Practice Quiz','Metals and Non-metals'],
  ['5.6 Mining — Practice Quiz',               'Mining'],
]

for (const [title, expected] of CASES) {
  test(`matches title "${title}" → "${expected}"`, () => {
    // topic blank → falls back to the title (mirrors real quiz docs)
    eq(matchName({ topic: '', title }, SCIENCE_SUBTOPICS), expected)
  })
}

test('prefers the exact subtopic over a longer one sharing a prefix', () => {
  // "Fruits" must not be swallowed by "Fruits and Seeds"
  eq(matchName({ title: '2.2 Fruits — Practice Quiz' }, SCIENCE_SUBTOPICS), 'Fruits')
  eq(matchName({ title: '4.3 Fruits and Seeds — Practice Quiz' }, SCIENCE_SUBTOPICS), 'Fruits and Seeds')
})

test('matches on quiz.topic when present, before title', () => {
  eq(matchName({ topic: 'Digestive System', title: 'Anything Else' }, SCIENCE_SUBTOPICS), 'Digestive System')
})

test('truncated title matches the fuller subtopic name', () => {
  eq(matchName({ title: 'Pollination and Fertilisation' }, SCIENCE_SUBTOPICS),
     'Pollination and Fertilisation in Flowering Plants')
})

test('genuinely unrelated quizzes return null (stay in Other quizzes)', () => {
  eq(matchName({ title: 'Grade 7 Social Studies' }, SCIENCE_SUBTOPICS), null)
  eq(matchName({ title: 'Social studies Luwapula Map' }, SCIENCE_SUBTOPICS), null)
})

test('empty / missing inputs are safe', () => {
  eq(matchName({}, SCIENCE_SUBTOPICS), null)
  eq(matchName({ topic: '   ' }, SCIENCE_SUBTOPICS), null)
  eq(matchName({ title: 'Energy' }, []), null)
})

// ── summary ───────────────────────────────────────────────────────
console.log(`\ncourse-map-match: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
