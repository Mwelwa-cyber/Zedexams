/**
 * Unit tests for the grade-aware teacher subject taxonomy, with a focus on
 * the Early Childhood Education (Nursery / Reception) subject set.
 *
 * Plain `node` script — throws on the first failed assertion. Imports the
 * pure taxonomy module directly so it never touches firebase/config.
 *
 * Run: node scripts/test-teacher-subjects.mjs   (or `npm run test:teacher-subjects`)
 */

import assert from 'node:assert/strict'
import {
  ECE_GRADE_CODES,
  ECE_SUBJECTS,
  isEceGrade,
  getSubjectsForGrade,
  defaultSubjectForGrade,
  isSubjectValidForGrade,
} from '../src/config/teacherTaxonomy.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// Helper: subject values (skip <optgroup> headers) from an option list.
const valuesOf = (opts) => opts.filter((o) => o.value !== undefined).map((o) => o.value)
const labelOf = (opts, value) => opts.find((o) => o.value === value)?.label

console.log('teacher subject taxonomy — ECE')

check('isEceGrade recognises all ECE band codes (any case)', () => {
  for (const g of ['ECE', 'ECE_N', 'ECE_R', 'ece_n', 'Ece_R']) {
    assert.equal(isEceGrade(g), true, `${g} should be ECE`)
  }
  for (const g of ['G1', 'G4', 'G7', 'G12', '', null, undefined]) {
    assert.equal(isEceGrade(g), false, `${g} should not be ECE`)
  }
})

check('Nursery & Reception expose exactly the four ECE syllabus subjects', () => {
  for (const grade of ['ECE_N', 'ECE_R']) {
    const opts = getSubjectsForGrade(grade)
    assert.deepEqual(
      valuesOf(opts),
      ['english', 'zambian_language', 'numeracy', 'expressive_arts'],
      `${grade} subject values`,
    )
    // Official syllabus labels.
    assert.equal(labelOf(opts, 'english'), 'English Language')
    assert.equal(labelOf(opts, 'zambian_language'), 'Zambian Languages')
    assert.equal(labelOf(opts, 'numeracy'), 'Pre-Maths & Science')
    assert.equal(labelOf(opts, 'expressive_arts'), 'Creative & Technology Studies')
  }
})

check('ECE menu drops the Grade-1+ subjects the user could not previously avoid', () => {
  const vals = valuesOf(getSubjectsForGrade('ECE_N'))
  for (const wrong of ['literacy', 'cinyanja', 'social_studies', 'religious_education', 'physical_education']) {
    assert.ok(!vals.includes(wrong), `${wrong} must not appear for Nursery`)
  }
})

check('ECE_SUBJECTS carries a single group header for FieldSelect optgroup rendering', () => {
  const headers = ECE_SUBJECTS.filter((o) => o.group !== undefined)
  assert.equal(headers.length, 1)
  assert.equal(headers[0].group, 'Early Childhood Education')
})

check('default subject for ECE bands is English Language', () => {
  assert.equal(defaultSubjectForGrade('ECE_N'), 'english')
  assert.equal(defaultSubjectForGrade('ECE_R'), 'english')
})

check('isSubjectValidForGrade matches the ECE menu, not the legacy grade map', () => {
  assert.equal(isSubjectValidForGrade('numeracy', 'ECE_N'), true)
  assert.equal(isSubjectValidForGrade('expressive_arts', 'ECE_R'), true)
  // Was previously "valid" for ECE via SUBJECT_GRADE_MAP — now excluded.
  assert.equal(isSubjectValidForGrade('social_studies', 'ECE_N'), false)
  assert.equal(isSubjectValidForGrade('physical_education', 'ECE_R'), false)
})

console.log('teacher subject taxonomy — non-ECE grades unchanged')

check('Grade 4 still gets the general filtered menu (not the ECE set)', () => {
  const opts = getSubjectsForGrade('G4')
  const vals = valuesOf(opts)
  assert.ok(vals.includes('mathematics'), 'G4 includes Mathematics')
  assert.ok(vals.includes('integrated_science'), 'G4 includes Integrated Science')
  assert.ok(!vals.includes('biology'), 'G4 excludes Biology')
  assert.notDeepEqual(vals, valuesOf(ECE_SUBJECTS), 'G4 is not the ECE menu')
})

check('isSubjectValidForGrade unchanged for non-ECE grades', () => {
  assert.equal(isSubjectValidForGrade('mathematics', 'G4'), true)
  assert.equal(isSubjectValidForGrade('biology', 'G4'), false)
  assert.equal(isSubjectValidForGrade('biology', 'G11'), true)
})

check('ECE_GRADE_CODES export is the expected set', () => {
  assert.deepEqual(ECE_GRADE_CODES, ['ECE', 'ECE_N', 'ECE_R'])
})

check('Lower Primary numeracy is labelled "Mathematics and Science", not "Numeracy"', () => {
  // The combined Lower-Primary "Maths & Science" sheet is stored under the
  // `numeracy` slug; the studio dropdowns must show the real learning-area
  // name. "Numeracy" is not a 2023-curriculum subject and confused authors.
  for (const grade of ['G1', 'G2', 'G3']) {
    const opts = getSubjectsForGrade(grade)
    assert.ok(valuesOf(opts).includes('numeracy'), `${grade} offers the combined maths/science area`)
    assert.equal(labelOf(opts, 'numeracy'), 'Mathematics and Science', `${grade} numeracy label`)
  }
  // The ECE bands keep their own, more age-appropriate "Pre-Maths & Science"
  // label via ECE_SUBJECTS — the relabel above must not bleed into them.
  assert.equal(labelOf(getSubjectsForGrade('ECE_N'), 'numeracy'), 'Pre-Maths & Science')
})

console.log(`\n✅ teacher-subjects: ${passed} checks passed`)
