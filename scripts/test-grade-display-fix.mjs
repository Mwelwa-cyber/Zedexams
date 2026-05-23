#!/usr/bin/env node
/**
 * Grade-display + normalization fixes — unit tests.
 *
 * Three bugs surfaced by a real screenshot from production
 * (TaskDetailPage rendered "GGrade 4 · Integrated Science ..."):
 *
 *   1. The Live Monitor's "Run test quiz generation" button
 *      (PR #566) wrote `grade: 'Grade 4'` + `term: 'Term 2'` as
 *      human-readable strings. Other writers use bare digits or
 *      the "G4" form. The mix produced KB-lookup misses + UI
 *      duplications.
 *
 *   2. TaskDetailPage rendered `G{task.grade}` — when
 *      task.grade === 'Grade 4', the output was "GGrade 4".
 *      Fixed by formatGrade() / formatTerm() defensive normalisers
 *      that handle every observed format.
 *
 *   3. `normalizeGrade()` in cbcKnowledge.js didn't recognise the
 *      "Grade 4" form — only "4" and "G4". A task queued with
 *      the human-readable form silently failed the KB lookup
 *      even when the entry existed. Extended the regex to also
 *      accept "GRADE\d+" (whitespace already stripped before the
 *      pattern match).
 *
 * Run: npm run test:grade-display  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Module from 'node:module'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const TEST_BUTTON_TEXT = readFileSync(
  join(ROOT, 'src/components/admin/learnerAi/RunTestQuizGenerationButton.jsx'),
  'utf8',
)
const TASK_DETAIL_TEXT = readFileSync(
  join(ROOT, 'src/components/admin/learnerAi/TaskDetailPage.jsx'),
  'utf8',
)

// Mock firebase-admin so cbcKnowledge.js loads under the unit test.
const fakeAdmin = {
  firestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) }),
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
  }),
}
fakeAdmin.firestore.FieldValue = {
  serverTimestamp: () => '__ts__',
  increment: (n) => ({ __increment: n }),
}
const origLoad = Module._load
Module._load = function(request, parent, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin
  return origLoad.call(this, request, parent, ...rest)
}
const { normalizeGrade } = await import(
  join(ROOT, 'functions/teacherTools/cbcKnowledge.js')
)
Module._load = origLoad

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── Fix #1 — Test button writes the schema-expected format ─────

console.log('\nFix #1 — RunTestQuizGenerationButton writes bare digits, not human strings')

test('test button payload uses grade: "4" (not "Grade 4")', () => {
  // The regression: PR #566 shipped `grade: 'Grade 4'`. Re-shipping
  // that would silently break KB lookups.
  assert(/grade:\s*['"]4['"]/.test(TEST_BUTTON_TEXT),
    'must use grade: "4"')
  assert(!/grade:\s*['"]Grade 4['"]/.test(TEST_BUTTON_TEXT),
    'must NOT use grade: "Grade 4" (the regressed value)')
})

test('test button payload uses term: "2" (not "Term 2")', () => {
  assert(/term:\s*['"]2['"]/.test(TEST_BUTTON_TEXT),
    'must use term: "2"')
  assert(!/term:\s*['"]Term 2['"]/.test(TEST_BUTTON_TEXT),
    'must NOT use term: "Term 2"')
})

// ── Fix #2 — TaskDetailPage uses formatGrade / formatTerm ─────

console.log('\nFix #2 — TaskDetailPage normalises any grade format')

test('TaskDetailPage defines formatGrade + formatTerm helpers', () => {
  assert(/function formatGrade\s*\(/.test(TASK_DETAIL_TEXT),
    'formatGrade helper must exist')
  assert(/function formatTerm\s*\(/.test(TASK_DETAIL_TEXT),
    'formatTerm helper must exist')
})

test('header renders {formatGrade(task.grade)}, NOT raw "G{task.grade}"', () => {
  // The regression: header was `G{task.grade}` — "GGrade 4" when
  // task.grade === "Grade 4".
  assert(/formatGrade\(task\.grade\)/.test(TASK_DETAIL_TEXT),
    'header must call formatGrade(task.grade)')
  // Explicit defence against the old "G{task.grade}" pattern.
  // Find the header render block + check it does NOT contain the
  // raw concatenation.
  const headerStart = TASK_DETAIL_TEXT.indexOf('text-slate-600 mt-1')
  const headerEnd = TASK_DETAIL_TEXT.indexOf('errorMessage', headerStart)
  const headerBlock = TASK_DETAIL_TEXT.slice(headerStart, headerEnd)
  assert(!/\bG\{task\.grade\}/.test(headerBlock),
    'header must not embed G{task.grade} (the old bug pattern)')
})

test('header also renders the term when present', () => {
  assert(/formatTerm\(task\.term\)/.test(TASK_DETAIL_TEXT),
    'header must call formatTerm(task.term)')
})

// ── Fix #3 — normalizeGrade handles every observed format ─────

console.log('\nFix #3 — normalizeGrade accepts "Grade 4" form')

test('"Grade 4" → "G4"', () => {
  assert(normalizeGrade('Grade 4') === 'G4',
    `got: '${normalizeGrade('Grade 4')}'`)
})

test('"GRADE 4" → "G4" (uppercase tolerant)', () => {
  assert(normalizeGrade('GRADE 4') === 'G4')
})

test('"grade 4" → "G4" (lowercase tolerant)', () => {
  assert(normalizeGrade('grade 4') === 'G4')
})

test('" Grade 4 " → "G4" (whitespace tolerant)', () => {
  assert(normalizeGrade(' Grade 4 ') === 'G4')
})

test('"Grade 12" → "G12" (two-digit)', () => {
  assert(normalizeGrade('Grade 12') === 'G12')
})

// ── Regression — existing normalizeGrade contracts unchanged ──

console.log('\nDefence — existing normalizeGrade contracts still hold')

test('"4" → "G4" (digit form still works)', () => {
  assert(normalizeGrade('4') === 'G4')
})

test('"G4" → "G4" (idempotent)', () => {
  assert(normalizeGrade('G4') === 'G4')
})

test('null → ""', () => {
  assert(normalizeGrade(null) === '')
})

test('"ECE" → "ECE" (non-numeric pass-through preserved)', () => {
  assert(normalizeGrade('ECE') === 'ECE')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}
