// Plain-node regression test for assessmentQuestionTypes.js.
// Run with: node src/components/teacher/assessmentQuestionTypes.test.js
//
// Guards:
//  - STUDIO_QUESTION_TYPE_OPTIONS is exactly 8 entries with valid values/labels.
//  - typeSelectValue folds legacy aliases correctly.
//  - patchForTypeChange seeds the right fields for each type, never overwrites
//    existing content, and always returns type + detectedType.

import assert from 'node:assert/strict'
import {
  STUDIO_QUESTION_TYPE_OPTIONS,
  typeSelectValue,
  patchForTypeChange,
} from './assessmentQuestionTypes.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/* ── STUDIO_QUESTION_TYPE_OPTIONS ── */
console.log('STUDIO_QUESTION_TYPE_OPTIONS')

const EXPECTED_VALUES = ['mcq', 'short_answer', 'diagram', 'essay', 'numeric', 'matching', 'sequence', 'fill_blanks']
const EXPECTED_LABELS = ['Multiple choice', 'Short answer', 'Structured / diagram', 'Essay', 'Numeric / calculation', 'Matching', 'Sequence / ordering', 'Fill in the blanks']

test('exports exactly 8 options', () => {
  assert.equal(STUDIO_QUESTION_TYPE_OPTIONS.length, 8)
})

test('all expected type values are present', () => {
  const values = STUDIO_QUESTION_TYPE_OPTIONS.map(o => o.value)
  for (const v of EXPECTED_VALUES) {
    assert.ok(values.includes(v), `Missing value: ${v}`)
  }
})

test('all expected labels are present', () => {
  const labels = STUDIO_QUESTION_TYPE_OPTIONS.map(o => o.label)
  for (const l of EXPECTED_LABELS) {
    assert.ok(labels.includes(l), `Missing label: ${l}`)
  }
})

test('each option has a non-empty value and label', () => {
  for (const opt of STUDIO_QUESTION_TYPE_OPTIONS) {
    assert.ok(typeof opt.value === 'string' && opt.value.length > 0, 'Empty value')
    assert.ok(typeof opt.label === 'string' && opt.label.length > 0, 'Empty label')
  }
})

test('no duplicate values', () => {
  const values = STUDIO_QUESTION_TYPE_OPTIONS.map(o => o.value)
  const unique = new Set(values)
  assert.equal(unique.size, values.length, 'Duplicate values found')
})

/* ── typeSelectValue ── */
console.log('typeSelectValue')

test('passes through canonical types unchanged', () => {
  for (const v of EXPECTED_VALUES) {
    assert.equal(typeSelectValue(v), v)
  }
})

test('folds legacy "fill" → "fill_blanks"', () => {
  assert.equal(typeSelectValue('fill'), 'fill_blanks')
})

test('folds legacy "fill_blank" → "fill_blanks"', () => {
  assert.equal(typeSelectValue('fill_blank'), 'fill_blanks')
})

test('folds legacy "fill_in_blank" → "fill_blanks"', () => {
  assert.equal(typeSelectValue('fill_in_blank'), 'fill_blanks')
})

test('folds legacy "short" → "short_answer"', () => {
  assert.equal(typeSelectValue('short'), 'short_answer')
})

test('defaults null/undefined to "mcq"', () => {
  assert.equal(typeSelectValue(null), 'mcq')
  assert.equal(typeSelectValue(undefined), 'mcq')
  assert.equal(typeSelectValue(''), 'mcq')
})

/* ── patchForTypeChange ── */
console.log('patchForTypeChange')

test('always sets type and detectedType', () => {
  const patch = patchForTypeChange({}, 'essay')
  assert.equal(patch.type, 'essay')
  assert.equal(patch.detectedType, 'essay')
})

test('mcq: seeds options + correctAnswer when missing', () => {
  const patch = patchForTypeChange({}, 'mcq')
  assert.deepEqual(patch.options, ['', '', '', ''])
  assert.equal(patch.correctAnswer, 0)
})

test('mcq: does NOT overwrite existing options', () => {
  const patch = patchForTypeChange({ options: ['A', 'B'] }, 'mcq')
  assert.equal(patch.options, undefined)
})

test('mcq: does NOT overwrite existing correctAnswer index', () => {
  const patch = patchForTypeChange({ correctAnswer: 2 }, 'mcq')
  assert.equal(patch.correctAnswer, undefined)
})

test('short_answer: coerces numeric correctAnswer to string', () => {
  const patch = patchForTypeChange({ correctAnswer: 5 }, 'short_answer')
  assert.equal(patch.correctAnswer, '5')
})

test('short_answer: keeps existing string correctAnswer', () => {
  const patch = patchForTypeChange({ correctAnswer: 'Paris' }, 'short_answer')
  assert.equal(patch.correctAnswer, undefined)
})

test('numeric: seeds tolerance and unit when missing', () => {
  const patch = patchForTypeChange({}, 'numeric')
  assert.equal(patch.numericTolerance, 0)
  assert.equal(patch.numericUnit, '')
})

test('numeric: does NOT overwrite existing tolerance', () => {
  const patch = patchForTypeChange({ numericTolerance: 0.5, numericUnit: 'kg' }, 'numeric')
  assert.equal(patch.numericTolerance, undefined)
  assert.equal(patch.numericUnit, undefined)
})

test('matching: seeds left/right/answer arrays when missing', () => {
  const patch = patchForTypeChange({}, 'matching')
  assert.deepEqual(patch.matchingLeft, ['', '', ''])
  assert.deepEqual(patch.matchingRight, ['', '', ''])
  assert.deepEqual(patch.matchingAnswer, [-1, -1, -1])
})

test('matching: does NOT overwrite existing arrays', () => {
  const patch = patchForTypeChange({
    matchingLeft: ['X'], matchingRight: ['Y'], matchingAnswer: [0],
  }, 'matching')
  assert.equal(patch.matchingLeft, undefined)
  assert.equal(patch.matchingRight, undefined)
  assert.equal(patch.matchingAnswer, undefined)
})

test('sequence: seeds items and answer when missing', () => {
  const patch = patchForTypeChange({}, 'sequence')
  assert.deepEqual(patch.sequenceItems, ['', '', '', ''])
  assert.deepEqual(patch.sequenceAnswer, [0, 0, 0, 0])
})

test('fill_blanks: seeds statements and wordBank when missing', () => {
  const patch = patchForTypeChange({}, 'fill_blanks')
  assert.equal(patch.statements.length, 4)
  assert.deepEqual(patch.wordBank, [])
})

test('fill_blanks: does NOT overwrite existing statements', () => {
  const patch = patchForTypeChange({ statements: [{ text: 'X', answers: ['Y'] }] }, 'fill_blanks')
  assert.equal(patch.statements, undefined)
})

/* ── done ── */
console.log(`\nAll ${passed} tests passed.`)
