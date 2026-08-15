/**
 * Curriculum-aware grade/form structures + teaching-assignment combination
 * validation.
 *
 * Guards the fixes for the "CBC and OBC share one generic grade/subject list"
 * bug (curriculum-aware Teaching Profile pickers):
 *   • each curriculum has its OWN stage structure (no shared Grade 1–12 list),
 *   • stage headings are non-selectable {group} entries, never values,
 *   • grade codes map to per-curriculum studio labels (CBC 'Form 1' vs
 *     2013 'Grade 8') and F-codes fold onto the stored G-code space,
 *   • an invalid curriculum-grade-subject combination cannot pass
 *     validateAssignment, and stale saved data is flagged for review.
 *
 * Plain `node` script — throws on the first failed assertion.
 * Run: node scripts/test-curriculum-structures.mjs   (npm run test:curriculum-structures)
 */

import assert from 'node:assert/strict'
import {
  CURRICULUM_GRADE_STRUCTURES,
  gradeStructureFor,
  gradeOptionsForCurriculum,
  isGradeInCurriculum,
  subjectExistsInCurriculum,
} from '../src/config/teacherTaxonomy.js'
import {
  validateAssignment,
  assignmentNeedsReview,
} from '../src/utils/teachingProfileCore.js'
import {
  foldFormCodeToGrade,
  assignmentGradeToStudioLabel,
} from '../src/shared/utils/curriculumSelectorConstants.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const gradeValuesOf = (curriculum) =>
  gradeOptionsForCurriculum(curriculum).filter((o) => o.value !== undefined).map((o) => o.value)

console.log('curriculum grade structures')

check('CBC and OBC have their OWN grade structures — not a shared generic list', () => {
  const cbc = gradeValuesOf('cbc')
  const obc = gradeValuesOf('previous')
  assert.notDeepEqual(cbc, obc, 'the two curricula must not share one grade list')
  // CBC: ECE bands + Grades 1–6 + Forms 1–4 (G8–G11). No Grade 7, no Grade 12.
  assert.deepEqual(cbc, ['ECE_N', 'ECE_R', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G8', 'G9', 'G10', 'G11'])
  // OBC (2013): Grades 1–12, no ECE bands.
  assert.deepEqual(obc, ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12'])
})

check('stage headings are non-selectable {group} entries, never option values', () => {
  for (const curriculum of ['cbc', 'previous']) {
    const opts = gradeOptionsForCurriculum(curriculum)
    const headings = opts.filter((o) => o.group !== undefined)
    assert.ok(headings.length >= 4, `${curriculum} has stage headings`)
    for (const h of headings) {
      assert.equal(h.value, undefined, `heading "${h.group}" must not carry a selectable value`)
    }
    // No stage label ever doubles as a selectable option label.
    const optionLabels = new Set(opts.filter((o) => o.value !== undefined).map((o) => o.label))
    for (const h of headings) {
      assert.ok(!optionLabels.has(h.group), `heading "${h.group}" must not appear as an option`)
    }
  }
})

check('stage structure objects expose id, label and grades per stage', () => {
  for (const key of ['cbc', 'previous']) {
    for (const stage of CURRICULUM_GRADE_STRUCTURES[key].stages) {
      assert.ok(stage.id && stage.label, `${key} stage has id + label`)
      assert.ok(Array.isArray(stage.grades) && stage.grades.length > 0, `${key}/${stage.id} carries grades`)
    }
  }
  // CBC secondary displays Forms; OBC keeps the Grade/Form dual naming.
  const cbcSecondary = CURRICULUM_GRADE_STRUCTURES.cbc.stages.find((s) => s.id === 'secondary')
  assert.equal(cbcSecondary.grades.find((g) => g.value === 'G8').label, 'Form 1')
  const obcJunior = CURRICULUM_GRADE_STRUCTURES.previous.stages.find((s) => s.id === 'junior-secondary')
  assert.equal(obcJunior.grades.find((g) => g.value === 'G8').label, 'Grade 8 / Form 1')
})

check('gradeStructureFor folds curriculum spellings and defaults to CBC', () => {
  assert.equal(gradeStructureFor('OBC').id, 'previous')
  assert.equal(gradeStructureFor('2013').id, 'previous')
  assert.equal(gradeStructureFor('CBC').id, 'cbc')
  assert.equal(gradeStructureFor('').id, 'cbc')
})

check('isGradeInCurriculum matches each structure (plus the legacy ECE band on CBC)', () => {
  assert.equal(isGradeInCurriculum('G7', 'cbc'), false)
  assert.equal(isGradeInCurriculum('G12', 'cbc'), false)
  assert.equal(isGradeInCurriculum('G7', 'previous'), true)
  assert.equal(isGradeInCurriculum('ECE_N', 'previous'), false)
  assert.equal(isGradeInCurriculum('ECE_N', 'cbc'), true)
  assert.equal(isGradeInCurriculum('ECE', 'cbc'), true, 'legacy ECE band stays valid on CBC')
  // No curriculum → union (curriculum-agnostic callers).
  assert.equal(isGradeInCurriculum('G12'), true)
  assert.equal(isGradeInCurriculum('', 'cbc'), false)
})

console.log('grade code ↔ studio label bridges')

check('foldFormCodeToGrade folds F-codes onto the stored G-code space', () => {
  assert.equal(foldFormCodeToGrade('F1'), 'G8')
  assert.equal(foldFormCodeToGrade('F4'), 'G11')
  assert.equal(foldFormCodeToGrade('F5'), 'G12')
  assert.equal(foldFormCodeToGrade('G4'), 'G4')
  assert.equal(foldFormCodeToGrade('ECE_N'), 'ECE_N')
  assert.equal(foldFormCodeToGrade(''), '')
})

check('assignmentGradeToStudioLabel maps per curriculum (CBC Forms vs 2013 Grades)', () => {
  assert.equal(assignmentGradeToStudioLabel('G8', 'cbc'), 'Form 1')
  assert.equal(assignmentGradeToStudioLabel('G11', 'cbc'), 'Form 4')
  assert.equal(assignmentGradeToStudioLabel('G8', 'previous'), 'Grade 8')
  assert.equal(assignmentGradeToStudioLabel('G12', 'previous'), 'Grade 12')
  assert.equal(assignmentGradeToStudioLabel('G4', 'cbc'), 'Grade 4')
  assert.equal(assignmentGradeToStudioLabel('ECE_N', 'cbc'), 'Nursery')
  assert.equal(assignmentGradeToStudioLabel('ECE_R', 'cbc'), 'Reception')
})

console.log('assignment combination validation')

check('a subject exclusive to the OTHER curriculum is a hard save error', () => {
  // Home Management is 2013-only — the CBC replaced it with the vocational
  // subjects — so it is invalid under the CBC…
  const cbc = validateAssignment({ grade: 'G10', subject: 'home_management', curriculumType: 'cbc' })
  assert.equal(cbc.valid, false)
  assert.ok(cbc.errors.some((e) => e.includes('does not belong to the selected curriculum')))
  // …but fine under the 2013 set.
  const obc = validateAssignment({ grade: 'G10', subject: 'home_management', curriculumType: 'previous' })
  assert.equal(obc.valid, true, obc.errors.join('; '))
  // And symmetrically for the CBC-only combined Mathematics and Science area.
  const numObc = validateAssignment({ grade: 'G4', subject: 'numeracy', curriculumType: 'previous' })
  assert.equal(numObc.valid, false)
  // Principles of Accounts is deliberately NOT the example any more: it exists
  // in BOTH eras (2013 G10-12 under the old 'accounts' key, and CBC Forms 1-4
  // inside the Commerce & Principles of Accounts workbook), so it is valid under
  // either curriculum. The legacy spelling still resolves to it.
  for (const curriculumType of ['cbc', 'previous']) {
    const poa = validateAssignment({ grade: 'G10', subject: 'accounts', curriculumType })
    assert.equal(poa.valid, true, `accounts/${curriculumType}: ${poa.errors.join('; ')}`)
  }
})

check('the pre-split combined subject asks the teacher to choose, never guesses', () => {
  const combined = validateAssignment({
    grade: 'G10', subject: 'commerce_and_principles_of_accounts', curriculumType: 'cbc',
  })
  assert.equal(combined.valid, false)
  assert.ok(
    combined.errors.some((e) => /now two separate subjects/.test(e)),
    `expected a "choose one" error, got: ${combined.errors.join('; ')}`,
  )
  // Both halves are offered by name so the teacher can act on the message.
  assert.ok(combined.errors.some((e) => e.includes('Commerce') && e.includes('Principles of Accounts')))
})

check('Home Economics at CBC Forms 1-4 asks which pathway, and only there', () => {
  // Three separate examinable syllabi at Forms 1-4, so the shared key cannot be
  // saved there — but it is a perfectly good subject at upper primary and across
  // the 2013 set, where it must save without complaint.
  const forms = validateAssignment({ grade: 'G9', subject: 'home_economics', curriculumType: 'cbc' })
  assert.equal(forms.valid, false)
  assert.ok(
    forms.errors.some((e) => /Home Economics is not one subject at .*Form 2/.test(e)),
    `expected a "choose a pathway" error, got: ${forms.errors.join('; ')}`,
  )
  // All three pathways are named so the teacher can act on the message.
  assert.ok(forms.errors.some((e) =>
    e.includes('Food & Nutrition') && e.includes('Fashion & Fabrics') && e.includes('Hospitality Management')))

  const primary = validateAssignment({ grade: 'G4', subject: 'home_economics', curriculumType: 'cbc' })
  assert.equal(primary.valid, true, primary.errors.join('; '))
  const obc = validateAssignment({ grade: 'G9', subject: 'home_economics', curriculumType: 'previous' })
  assert.equal(obc.valid, true, obc.errors.join('; '))

  // And each pathway saves cleanly on its own.
  for (const subject of ['food_and_nutrition', 'fashion_and_fabrics', 'hospitality_management']) {
    const v = validateAssignment({ grade: 'G9', subject, curriculumType: 'cbc' })
    assert.equal(v.valid, true, `${subject}: ${v.errors.join('; ')}`)
  }
  // The pre-split 'fashion_fabrics' spelling folds on read rather than erroring.
  const legacy = validateAssignment({ grade: 'G9', subject: 'fashion_fabrics', curriculumType: 'cbc' })
  assert.equal(legacy.valid, true, legacy.errors.join('; '))
})

check('a grade the curriculum does not offer is a hard save error', () => {
  const g7 = validateAssignment({ grade: 'G7', subject: 'english', curriculumType: 'cbc' })
  assert.equal(g7.valid, false)
  assert.ok(g7.errors.some((e) => e.includes('not offered')))
  const ece = validateAssignment({ grade: 'ECE_N', subject: 'english', curriculumType: 'previous' })
  assert.equal(ece.valid, false)
  // The same values are valid where the curriculum actually offers them.
  assert.equal(validateAssignment({ grade: 'G7', subject: 'english', curriculumType: 'previous' }).valid, true)
  assert.equal(validateAssignment({ grade: 'ECE_N', subject: 'english', curriculumType: 'cbc' }).valid, true)
})

check('within-curriculum grade-range mismatch stays a non-blocking warning', () => {
  // Biology at Grade 1 is wrong per the static map but not a cross-curriculum
  // mismatch — the syllabus-catalog picker is the finer-grained gate.
  const r = validateAssignment({ grade: 'G1', subject: 'biology', curriculumType: 'previous' })
  assert.equal(r.valid, true)
  assert.ok(r.warnings.length >= 1)
})

check('assignmentNeedsReview flags stale invalid saved data with reasons', () => {
  const stale = assignmentNeedsReview({ grade: 'G12', subject: 'accounts', curriculumType: 'cbc' })
  assert.equal(stale.needsReview, true)
  assert.ok(stale.reasons.length >= 1)
  const fine = assignmentNeedsReview({ grade: 'G12', subject: 'accounts', curriculumType: 'previous' })
  assert.equal(fine.needsReview, false)
})

console.log(`\n✅ curriculum-structures: ${passed} checks passed`)
