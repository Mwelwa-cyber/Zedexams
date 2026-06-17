/**
 * Unit tests for the syllabi-sourced Subject dropdown builder
 * (src/utils/curriculumOptions.js). Plain `node` assertions — run with:
 *   node scripts/test-curriculum-options.mjs
 */

import assert from 'node:assert/strict'
import {
  buildSubjectOptions,
  subjectValuesOf,
  subjectLabel,
} from '../src/utils/curriculumOptions.js'
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

test('syllabus subjects are grouped first under "From the syllabi"', () => {
  const out = buildSubjectOptions('G5', new Set(['mathematics']))
  assert.equal(out[0].group, 'From the syllabi')
  // mathematics must appear before the "Other subjects" header.
  const otherIdx = out.findIndex((o) => o.group === 'Other subjects')
  const mathIdx = out.findIndex((o) => o.value === 'mathematics')
  assert.ok(mathIdx > 0 && mathIdx < otherIdx, 'maths listed in the syllabi group')
})

test('curriculum-valid subjects not in the syllabi still appear under "Other subjects"', () => {
  // civic_education is valid at G5 in the taxonomy; if the syllabi only carry
  // mathematics it must still be selectable so teachers are never blocked.
  const out = buildSubjectOptions('G5', new Set(['mathematics']))
  const values = subjectValuesOf(out)
  assert.ok(values.has('civic_education'), 'civic_education still selectable')
  assert.ok(values.has('mathematics'), 'mathematics selectable')
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
  // and it sits in the syllabi group, before "Other subjects"
  const otherIdx = out.findIndex((o) => o.group === 'Other subjects')
  const bioIdx = out.findIndex((o) => o.value === 'biology')
  assert.ok(bioIdx > 0 && (otherIdx === -1 || bioIdx < otherIdx))
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
