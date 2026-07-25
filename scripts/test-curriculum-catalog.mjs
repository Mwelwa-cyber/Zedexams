/**
 * Contract, regression + cross-studio parity tests for the canonical curriculum
 * catalogue (src/config/curriculumCatalog.js).
 *
 * Plain `node` script — throws on the first failed assertion. Imports the pure
 * catalogue + the taxonomy authority directly (no firebase/config).
 *
 * Covers the acceptance criteria:
 *   • CBC Nursery has a dedicated regression test whose EXPECTED subjects come
 *     from the canonical taxonomy fixture, not a duplicated array.
 *   • CBC and OBC subject sets never combine.
 *   • The same curriculum + grade produces the SAME subject-id list in every
 *     studio (parity), equal to getSubjectsForGrade().
 *   • Invalid saved subjects are detected (validateCurriculumSelection).
 *   • A curriculum-scoped query never falls back to a global "all subjects" list.
 *
 * Run: node scripts/test-curriculum-catalog.mjs  (or `npm run test:curriculum-catalog`)
 */

import assert from 'node:assert/strict'
import {
  CATALOGUE_SCHEMA_VERSION,
  getCurricula,
  getGradesForCurriculum,
  getSubjectsForGrade,
  getStudioSubjectIds,
  getTopicsForSubject,
  registerTopicProvider,
  normalizeCurriculumId,
  normalizeGradeId,
  normalizeSubjectId,
  isSubjectValidForSelection,
  validateCurriculumSelection,
} from '../src/config/curriculumCatalog.js'
import {
  getSubjectsForGrade as taxonomySubjectsForGrade,
} from '../src/config/teacherTaxonomy.js'

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`) }
const idsOf = (subjects) => subjects.map((s) => s.id)

console.log('curriculum catalogue — curricula + normalization')

check('exactly CBC and OBC are offered, with stable ids', () => {
  const ids = getCurricula().map((c) => c.id)
  assert.deepEqual(ids, ['cbc', 'obc'])
})

check('normalizeCurriculumId folds every known spelling; unknown → ""', () => {
  for (const v of ['cbc', 'CBC', 'new', '2023', 'cbc-2023', 'Competency-Based']) {
    assert.equal(normalizeCurriculumId(v), 'cbc', `${v} → cbc`)
  }
  for (const v of ['obc', 'OBC', 'old', 'previous', '2013', 'outcome-based']) {
    assert.equal(normalizeCurriculumId(v), 'obc', `${v} → obc`)
  }
  for (const v of ['', 'zzz', null, undefined, 'igcse']) {
    assert.equal(normalizeCurriculumId(v), '', `${v} → ""`)
  }
})

check('normalizeGradeId folds labels/numbers/forms to canonical G-codes', () => {
  assert.equal(normalizeGradeId('Nursery'), 'ECE_N')
  assert.equal(normalizeGradeId('Reception'), 'ECE_R')
  assert.equal(normalizeGradeId('ECE'), 'ECE_N')
  assert.equal(normalizeGradeId('4'), 'G4')
  assert.equal(normalizeGradeId('Grade 4'), 'G4')
  assert.equal(normalizeGradeId('G4'), 'G4')
  assert.equal(normalizeGradeId('Form 1'), 'G8')
  assert.equal(normalizeGradeId('form 4'), 'G11')
  assert.equal(normalizeGradeId('nonsense'), '')
})

check('normalizeSubjectId folds labels + parentheticals to canonical slugs', () => {
  assert.equal(normalizeSubjectId('Integrated Science'), 'integrated_science')
  assert.equal(normalizeSubjectId('Science'), 'integrated_science')
  assert.equal(normalizeSubjectId('Numeracy (Maths & Science)'), 'numeracy')
  assert.equal(normalizeSubjectId('Zambian Language (Cinyanja etc.)'), 'zambian_language')
  assert.equal(normalizeSubjectId('Expressive Arts'), 'expressive_arts')
  assert.equal(normalizeSubjectId('english'), 'english')
})

console.log('curriculum catalogue — CBC Nursery regression (the reported bug)')

check('CBC Nursery subjects EXACTLY match the canonical taxonomy fixture', () => {
  // Expected comes from the authority, NOT a duplicated literal array.
  const expected = taxonomySubjectsForGrade('ECE_N', 'cbc')
    .filter((o) => o.value !== undefined)
    .map((o) => o.value)
  const actual = idsOf(getSubjectsForGrade('cbc', 'ECE_N'))
  assert.deepEqual(actual, expected, 'CBC Nursery subject ids')
  // And it must NOT leak the upper-grade subjects the bug showed (Integrated
  // Science / Mathematics / Social Studies etc.).
  for (const wrong of ['integrated_science', 'mathematics', 'social_studies', 'technology_studies', 'home_economics']) {
    assert.ok(!actual.includes(wrong), `Nursery must not offer ${wrong}`)
  }
})

check('an invalid saved subject for CBC Nursery is detected + rejected', () => {
  // "Integrated Science" left over from a default is NOT valid for Nursery.
  assert.equal(isSubjectValidForSelection('cbc', 'ECE_N', 'Integrated Science'), false)
  const v = validateCurriculumSelection({ curriculumId: 'cbc', gradeId: 'Nursery', subjectId: 'Integrated Science' })
  assert.equal(v.valid, false)
  assert.equal(v.reason, 'subject_not_valid_for_grade')
  // A real ECE subject validates.
  assert.equal(isSubjectValidForSelection('cbc', 'ECE_N', 'English'), true)
})

console.log('curriculum catalogue — CBC and OBC never mix')

check('OBC has no ECE bands (Nursery scoped to OBC is empty, not the CBC set)', () => {
  assert.deepEqual(getSubjectsForGrade('obc', 'ECE_N'), [])
  assert.deepEqual(getSubjectsForGrade('obc', 'Reception'), [])
})

check('a CBC-only subject never appears under OBC and vice-versa', () => {
  const cbcG10 = idsOf(getSubjectsForGrade('cbc', 'G10'))
  const obcG10 = idsOf(getSubjectsForGrade('obc', 'G10'))
  // Commerce is CBC-only. Principles of Accounts runs in both eras, so it is not
  // the discriminator any more — Home Management (OBC-only) is.
  assert.ok(cbcG10.includes('commerce') && !cbcG10.includes('home_management'))
  assert.ok(obcG10.includes('home_management') && !obcG10.includes('commerce'))
  // The retired combined key is offered by neither.
  assert.ok(!cbcG10.includes('commerce_and_principles_of_accounts'))
  assert.ok(!obcG10.includes('commerce_and_principles_of_accounts'))
  // The two id sets must genuinely differ.
  assert.notDeepEqual(cbcG10.slice().sort(), obcG10.slice().sort())
})

check('CBC Grade 4 differs from OBC Grade 4 (combined Maths & Science is CBC-only)', () => {
  const cbc = idsOf(getSubjectsForGrade('cbc', 'G4'))
  const obc = idsOf(getSubjectsForGrade('obc', 'G4'))
  assert.ok(cbc.includes('numeracy'), 'CBC G4 has combined Mathematics and Science')
  assert.ok(!obc.includes('numeracy'), 'OBC G4 has no combined area')
})

console.log('curriculum catalogue — fail closed (no global fallback)')

check('unknown/invalid curriculum+grade returns [] — never every subject', () => {
  assert.deepEqual(getSubjectsForGrade('cbc', 'G7'), [], 'CBC abolished Grade 7')
  assert.deepEqual(getSubjectsForGrade('cbc', 'G12'), [], 'CBC ends at Form 4')
  assert.deepEqual(getSubjectsForGrade('cbc', 'G99'), [])
  assert.deepEqual(getSubjectsForGrade('igcse', 'G4'), [], 'unknown curriculum')
  assert.deepEqual(getSubjectsForGrade('cbc', ''), [])
  assert.deepEqual(getSubjectsForGrade('', 'G4'), [])
})

console.log('curriculum catalogue — cross-studio parity')

check('every studio resolves the IDENTICAL subject-id list for a curriculum + grade', () => {
  const STUDIOS = ['exam', 'test-paper', 'lesson-plan', 'worksheet', 'scheme-of-work', 'notes', 'homework', 'flashcards', 'rubric', 'mark-schedule', 'weekly-focus', 'record-of-work', 'quiz']
  const cases = [
    ['cbc', 'ECE_N'], ['cbc', 'G4'], ['cbc', 'G9'], ['obc', 'G7'], ['obc', 'G12'],
  ]
  for (const [cid, gid] of cases) {
    const canonical = idsOf(getSubjectsForGrade(cid, gid))
    for (const studio of STUDIOS) {
      assert.deepEqual(
        getStudioSubjectIds(studio, cid, gid),
        canonical,
        `${studio} @ ${cid}/${gid} must equal getSubjectsForGrade`,
      )
    }
    // And the explicit example from the spec: exam == test-paper == lesson-plan.
    assert.deepEqual(getStudioSubjectIds('exam', cid, gid), getStudioSubjectIds('test-paper', cid, gid))
    assert.deepEqual(getStudioSubjectIds('test-paper', cid, gid), getStudioSubjectIds('lesson-plan', cid, gid))
  }
})

console.log('curriculum catalogue — grades + reset semantics')

check('getGradesForCurriculum carries stable ids + stages; unknown → []', () => {
  const cbcGrades = getGradesForCurriculum('cbc')
  const ids = cbcGrades.map((g) => g.id)
  assert.ok(ids.includes('ECE_N') && ids.includes('G4') && ids.includes('G8'))
  assert.ok(!ids.includes('G7'), 'CBC has no Grade 7')
  assert.ok(cbcGrades.every((g) => g.curriculumId === 'cbc' && g.stageId))
  assert.deepEqual(getGradesForCurriculum('igcse'), [])
})

check('validateCurriculumSelection flags a grade not in the chosen curriculum', () => {
  // Grade 7 exists in OBC but not CBC.
  assert.equal(validateCurriculumSelection({ curriculumId: 'cbc', gradeId: 'G7' }).reason, 'grade_not_in_curriculum')
  assert.equal(validateCurriculumSelection({ curriculumId: 'obc', gradeId: 'G7' }).valid, true)
  // Empty selection is valid (nothing chosen yet).
  assert.equal(validateCurriculumSelection({}).valid, true)
  // catalogueVersion is stamped on the normalized selection.
  assert.equal(validateCurriculumSelection({}).normalized.catalogueVersion, CATALOGUE_SCHEMA_VERSION)
})

console.log('curriculum catalogue — topic provider (fail closed + provider path)')

check('topics fail closed to [] when no provider is registered', async () => {
  registerTopicProvider(null)
  assert.deepEqual(await getTopicsForSubject('cbc', 'ECE_N', 'english'), [])
})

check('topics come from the registered provider, and only for a valid subject', async () => {
  registerTopicProvider({
    source: 'test-fixture',
    getTopics: (c, g, s) => (c === 'cbc' && g === 'ECE_N' && s === 'english' ? ['Listening', 'Speaking'] : []),
    getSubtopics: () => [],
  })
  assert.deepEqual(await getTopicsForSubject('cbc', 'ECE_N', 'English'), ['Listening', 'Speaking'])
  // An invalid subject for the grade yields [] even with a provider attached
  // (the subject picker and topic lookup can never disagree).
  assert.deepEqual(await getTopicsForSubject('cbc', 'ECE_N', 'Integrated Science'), [])
  registerTopicProvider(null)
})

console.log(`\n✅ curriculum-catalog: ${passed} checks passed`)
