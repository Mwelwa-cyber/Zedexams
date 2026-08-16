/**
 * Unit tests for the syllabi-sourced Subject dropdown builder
 * (src/curriculum/resolvers/curriculumOptions.js). Plain `node` assertions — run with:
 *   node scripts/test-curriculum-options.mjs
 */

import assert from 'node:assert/strict'
import {
  buildSubjectOptions,
  subjectValuesOf,
  subjectLabel,
} from '../src/curriculum/resolvers/curriculumOptions.js'
import { getSubjectsForGrade } from '../src/config/teacherTaxonomy.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('curriculumOptions')

test('no syllabi loaded → falls back to the plain taxonomy list', () => {
  const out = buildSubjectOptions('G5', null)
  assert.deepEqual(out, getSubjectsForGrade('G5'))
  const out2 = buildSubjectOptions('G5', new Set())
  assert.deepEqual(out2, getSubjectsForGrade('G5'))
})

test('dropdown is restricted to the subjects the syllabi cover', () => {
  // The syllabi only carry mathematics for the grade → that's all the
  // dropdown should offer. No "Other subjects" fallback group.
  const out = buildSubjectOptions('G5', new Set(['mathematics']))
  const values = subjectValuesOf(out)
  assert.deepEqual([...values], ['mathematics'], 'only the syllabus subject is listed')
  assert.ok(!out.some((o) => o.group), 'no group headers when restricted to syllabi')
})

test('curriculum-valid subjects NOT in the syllabi are dropped', () => {
  // civic_education is valid at G5 in the taxonomy, but if the syllabi don't
  // carry it the dropdown must not offer it (only syllabus subjects show).
  const out = buildSubjectOptions('G5', new Set(['mathematics']))
  const values = subjectValuesOf(out)
  assert.ok(!values.has('civic_education'), 'civic_education dropped (not in syllabi)')
  assert.ok(values.has('mathematics'), 'mathematics selectable')
})

test('subjects keep their canonical taxonomy order', () => {
  // English sorts before Mathematics in the taxonomy; the restricted list
  // preserves that order rather than alphabetising.
  const out = buildSubjectOptions('G5', new Set(['mathematics', 'english']))
  const values = [...subjectValuesOf(out)]
  assert.deepEqual(values, ['english', 'mathematics'])
})

test('a syllabus subject the grade taxonomy omits is still surfaced', () => {
  // Pretend an admin added a "biology" sheet at G6 (taxonomy filters it out
  // of getSubjectsForGrade('G6')). It must still show up so newly-added
  // syllabi subjects appear automatically.
  const taxonomyValues = subjectValuesOf(getSubjectsForGrade('G6'))
  assert.ok(!taxonomyValues.has('biology'), 'precondition: biology not in G6 taxonomy')
  const out = buildSubjectOptions('G6', new Set(['biology']))
  const values = subjectValuesOf(out)
  assert.ok(values.has('biology'), 'admin-added biology surfaced')
})

test('grade with no syllabi falls back to the full taxonomy (never empty)', () => {
  // G7 / G12 carry no syllabi sheets — the dropdown must not go empty, so it
  // falls back to the curriculum-valid taxonomy list for that grade.
  const out = buildSubjectOptions('G7', new Set())
  assert.deepEqual(out, getSubjectsForGrade('G7'))
})

test('every built option keeps a label', () => {
  const out = buildSubjectOptions('G5', new Set(['mathematics', 'integrated_science']))
  for (const o of out) {
    if (o.value !== undefined) assert.ok(o.label, `option ${o.value} has a label`)
  }
})

test('ECE grade keeps its dedicated four-area labels', () => {
  const out = buildSubjectOptions('ECE_N', new Set(['english']))
  const eng = out.find((o) => o.value === 'english')
  assert.equal(eng.label, 'English Language', 'ECE label preserved, not "English"')
})

test('subjectLabel falls back to a title-cased slug', () => {
  assert.equal(subjectLabel('mathematics'), 'Mathematics')
  assert.equal(subjectLabel('some_new_subject'), 'Some New Subject')
})

test('subjectValuesOf ignores group headers', () => {
  const values = subjectValuesOf([{ group: 'X' }, { value: 'a', label: 'A' }])
  assert.deepEqual([...values], ['a'])
})

console.log(`\n${passed} curriculum-options tests passed`)
