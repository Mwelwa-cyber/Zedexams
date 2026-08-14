// Import formatting sanity checks — plain `node` assertion tests.
// Run: node src/services/quizImport/importFormatChecks.test.js
// Wired into test:all via the `test:import-format-checks` npm script.

import assert from 'node:assert/strict'
import { buildImportFormatWarnings } from './importFormatChecks.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}`)
    throw err
  }
}

const standalone = (question) => ({ kind: 'standalone', question })
const passageSection = (passage, questions) => ({
  kind: 'passage',
  passage: { passageText: '', instructions: '', ...passage, questions },
})

/* ── mention vs presence ───────────────────────────────────────────────── */

test('warns when a question says “underlined” but nothing is underlined', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>What does the underlined word mean?</p>', options: ['a', 'b', 'c', 'd'] }),
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Question 1 says “underlined”/)
})

test('no warning when the underline is present in the question', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>What does the <u>underlined</u> word mean?</p>', options: ['a', 'b'] }),
  ])
  assert.deepEqual(warnings, [])
})

test('underline in the attached passage satisfies the question', () => {
  const warnings = buildImportFormatWarnings([
    passageSection(
      { passageText: '<p>The boy was <u>exhausted</u>.</p>' },
      [{ text: '<p>What does the underlined word mean?</p>', options: ['a', 'b'] }],
    ),
  ])
  assert.deepEqual(warnings, [])
})

test('warns for bold / italics / highlight mentions without the formatting', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>Study the word in bold.</p>', options: ['a', 'b'] }),
    standalone({ text: '<p>Explain the italicised expression.</p>', options: ['a', 'b'] }),
    standalone({ text: '<p>Choose the highlighted word.</p>', options: ['a', 'b'] }),
  ])
  assert.equal(warnings.length, 3)
  assert.match(warnings[0], /says “bold”/)
  assert.match(warnings[1], /says “italicised”/)
  assert.match(warnings[2], /says “highlighted”/)
})

test('bold present as <strong> or a leftover [[b]] token both count', () => {
  const withTag = buildImportFormatWarnings([
    standalone({ text: '<p>Study the word in bold: <strong>run</strong>.</p>', options: ['a', 'b'] }),
  ])
  const withToken = buildImportFormatWarnings([
    standalone({ text: 'Study the word in bold: [[b]]run[[/b]].', options: ['a', 'b'] }),
  ])
  assert.deepEqual(withTag, [])
  assert.deepEqual(withToken, [])
})

test('an imperative “Underline the correct answer” does not warn', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>Underline the correct answer in your exercise book.</p>', options: ['a', 'b'] }),
  ])
  assert.deepEqual(warnings, [])
})

/* ── passage reference ─────────────────────────────────────────────────── */

test('warns when a standalone question refers to a passage', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>According to the passage, why did the boy stop?</p>', options: ['a', 'b'] }),
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /refers to a passage, but no passage is attached/)
})

test('no passage warning when the question sits under a passage', () => {
  const warnings = buildImportFormatWarnings([
    passageSection(
      { passageText: '<p>Once upon a time…</p>' },
      [{ text: '<p>According to the passage, why did the boy stop?</p>', options: ['a', 'b'] }],
    ),
  ])
  assert.deepEqual(warnings, [])
})

/* ── empty options ─────────────────────────────────────────────────────── */

test('warns for an empty MCQ option among filled ones', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>Pick one.</p>', type: 'mcq', options: ['cat', '', 'dog', 'goat'] }),
  ])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /answer option B is empty/)
})

test('all-empty option lists (non-MCQ shells) do not warn', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>Explain photosynthesis.</p>', type: 'short_answer', options: ['', '', '', ''] }),
    standalone({ text: '<p>Describe erosion.</p>', type: 'mcq', options: ['', '', '', ''] }),
  ])
  assert.deepEqual(warnings, [])
})

/* ── numbering ─────────────────────────────────────────────────────────── */

test('uses sourceQuestionNumber for the label when present', () => {
  const warnings = buildImportFormatWarnings([
    standalone({ text: '<p>What does the underlined word mean?</p>', sourceQuestionNumber: 46, options: ['a', 'b'] }),
  ])
  assert.match(warnings[0], /^Question 46 /)
})

test('empty input yields no warnings', () => {
  assert.deepEqual(buildImportFormatWarnings([]), [])
  assert.deepEqual(buildImportFormatWarnings(null), [])
})

console.log(`✓ importFormatChecks — ${passed} tests passed`)
