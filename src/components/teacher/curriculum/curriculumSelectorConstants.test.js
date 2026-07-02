/**
 * Node test for curriculumSelectorConstants — the studio-stack → server value
 * mappers that keep the standardized curriculum selector's picks valid against
 * the teacher-tool Cloud Functions' ALLOWED_GRADES / ALLOWED_SUBJECTS checks.
 *
 * Run: node src/components/teacher/curriculum/curriculumSelectorConstants.test.js
 */

import assert from 'node:assert/strict'
import {
  studioLabelToKbGrade,
  kbGradeToStudioLabel,
  curriculumToFramework,
  normalizeSelectorSeed,
  selectorPayloadToServerInputs,
  subjectSlugOf,
  gradeListFor,
  gradeValuesFor,
} from './curriculumSelectorConstants.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// The grade codes the teacher-tool generators accept (mirrors ALLOWED_GRADES).
const ALLOWED_GRADES = new Set([
  'ECE', 'ECE_N', 'ECE_R', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7',
  'G8', 'G9', 'G10', 'G11', 'G12', 'F1', 'F2', 'F3', 'F4',
])

console.log('curriculumSelectorConstants')

ok('studioLabelToKbGrade maps every CBC grade label to an accepted code', () => {
  for (const g of gradeListFor('cbc')) {
    const code = studioLabelToKbGrade(g.value)
    assert.ok(ALLOWED_GRADES.has(code), `${g.value} → ${code} not allowed`)
  }
})

ok('studioLabelToKbGrade maps every Previous grade label to an accepted code', () => {
  for (const g of gradeListFor('previous')) {
    const code = studioLabelToKbGrade(g.value)
    assert.ok(ALLOWED_GRADES.has(code), `${g.value} → ${code} not allowed`)
  }
})

ok('studioLabelToKbGrade handles ECE + Form + Grade families', () => {
  assert.equal(studioLabelToKbGrade('Nursery'), 'ECE_N')
  assert.equal(studioLabelToKbGrade('Reception'), 'ECE_R')
  assert.equal(studioLabelToKbGrade('Form 1'), 'F1')
  assert.equal(studioLabelToKbGrade('Form 4'), 'F4')
  assert.equal(studioLabelToKbGrade('Grade 4'), 'G4')
  assert.equal(studioLabelToKbGrade('Grade 12'), 'G12')
  // Already-coded values pass through the shared helper.
  assert.equal(studioLabelToKbGrade('G7'), 'G7')
  assert.equal(studioLabelToKbGrade('ECE_N'), 'ECE_N')
  assert.equal(studioLabelToKbGrade(''), '')
})

ok('curriculumToFramework maps mode → framework code', () => {
  assert.equal(curriculumToFramework('cbc'), '2023')
  assert.equal(curriculumToFramework('previous'), '2013')
  assert.equal(curriculumToFramework(null), '2023')
})

ok('gradeValuesFor returns the right grade set per mode', () => {
  assert.ok(gradeValuesFor('cbc').has('Form 1'))
  assert.ok(!gradeValuesFor('cbc').has('Grade 8'))
  assert.ok(gradeValuesFor('previous').has('Grade 8'))
  assert.ok(!gradeValuesFor('previous').has('Form 1'))
})

ok('selectorPayloadToServerInputs maps a core CBC pick to server shapes', () => {
  const out = selectorPayloadToServerInputs({
    curriculumMode: 'cbc',
    gradeLabel: 'Grade 4',
    subjectKey: 'Mathematics Syllabus (Grades 4-6)',
    topic: 'Fractions',
    subtopic: 'Adding Fractions',
  })
  assert.equal(out.grade, 'G4')
  assert.equal(out.subject, 'mathematics')
  assert.equal(out.subjectLabel, 'Mathematics')
  assert.equal(out.topic, 'Fractions')
  assert.equal(out.subtopic, 'Adding Fractions')
  assert.equal(out.curriculum, 'cbc')
  assert.equal(out.framework, '2023')
})

ok('selectorPayloadToServerInputs maps a Previous pick to server shapes', () => {
  const out = selectorPayloadToServerInputs({
    curriculumMode: 'previous',
    gradeLabel: 'Grade 10',
    subjectKey: 'Mathematics Syllabus (Forms 1-4)',
    topic: 'Algebra',
    subtopic: '',
  })
  assert.equal(out.grade, 'G10')
  assert.equal(out.subject, 'mathematics')
  assert.equal(out.curriculum, 'previous')
  assert.equal(out.framework, '2013')
})

ok('selectorPayloadToServerInputs folds label-variant subjects to canonical slugs', () => {
  const fold = (key) => selectorPayloadToServerInputs({
    curriculumMode: 'cbc', gradeLabel: 'Grade 4', subjectKey: key,
  }).subject
  assert.equal(fold('English Language Syllabus (Grades 4-6)'), 'english')
  assert.equal(fold('Science Syllabus (Grades 4-6)'), 'integrated_science')
  assert.equal(fold('Social Studies Syllabus (Grades 4-6)'), 'social_studies')
  assert.equal(fold('Home Economics & Hospitality Syllabus (Grades 4-6)'), 'home_economics')
})

ok('selectorPayloadToServerInputs resolves ECE / Lower-Primary strand keys', () => {
  const fold = (key) => selectorPayloadToServerInputs({
    curriculumMode: 'cbc', gradeLabel: 'Grade 1', subjectKey: key,
  }).subject
  // Strand keys are `${topLevel}::${sheetName}`; cleanSubjectName strips the
  // grade/age-band prefix, then toKbSubjectKey folds the strand → canonical slug.
  assert.equal(fold('Lower Primary Syllabi (Grades 1-3)::Grade 1 - English Language'), 'english')
  assert.equal(fold('Lower Primary Syllabi (Grades 1-3)::Grade 1 - Maths & Science'), 'numeracy')
  assert.equal(fold('Early Childhood Education Syllabi (3-5 Years)::3-4 Years - Zambian Languages'), 'zambian_language')
})

ok('empty subject/grade map to empty strings (no crash)', () => {
  const out = selectorPayloadToServerInputs({})
  assert.equal(out.grade, '')
  assert.equal(out.subject, '')
  assert.equal(out.curriculum, 'cbc')
})

ok('kbGradeToStudioLabel inverts codes, numbers and passes labels through', () => {
  assert.equal(kbGradeToStudioLabel('G5'), 'Grade 5')
  assert.equal(kbGradeToStudioLabel('g12'), 'Grade 12')
  assert.equal(kbGradeToStudioLabel('F1'), 'Form 1')
  assert.equal(kbGradeToStudioLabel('ECE_N'), 'Nursery')
  assert.equal(kbGradeToStudioLabel('ECE_R'), 'Reception')
  assert.equal(kbGradeToStudioLabel('5'), 'Grade 5')
  assert.equal(kbGradeToStudioLabel('Grade 5'), 'Grade 5')
  assert.equal(kbGradeToStudioLabel('Form 2'), 'Form 2')
  assert.equal(kbGradeToStudioLabel(''), '')
  // Round-trip with the forward mapper for every offered grade.
  for (const g of [...gradeListFor('cbc'), ...gradeListFor('previous')]) {
    assert.equal(kbGradeToStudioLabel(studioLabelToKbGrade(g.value)), g.value)
  }
})

ok('normalizeSelectorSeed accepts legacy deep-link shapes', () => {
  // Old links carried KB codes + slugs, no curriculum → defaults to cbc.
  const s = normalizeSelectorSeed({ grade: 'G5', subject: 'mathematics', topic: 'Fractions' })
  assert.equal(s.curriculumMode, 'cbc')
  assert.equal(s.gradeLabel, 'Grade 5')
  assert.equal(s.subjectKey, 'mathematics')
  assert.equal(s.topic, 'Fractions')
})

ok('normalizeSelectorSeed honours explicit curriculum/framework', () => {
  assert.equal(normalizeSelectorSeed({ curriculum: 'previous', grade: 'G10' }).curriculumMode, 'previous')
  assert.equal(normalizeSelectorSeed({ framework: '2013', grade: 'G10' }).curriculumMode, 'previous')
  assert.equal(normalizeSelectorSeed({ framework: '2023' }).curriculumMode, 'cbc')
  assert.equal(normalizeSelectorSeed({ curriculumMode: 'previous' }).curriculumMode, 'previous')
  // Empty seed stays null — no seed means no preselected curriculum.
  assert.equal(normalizeSelectorSeed({}).curriculumMode, null)
  assert.equal(normalizeSelectorSeed(null).curriculumMode, null)
})

ok('subjectSlugOf folds keys, strand keys, labels and slugs alike', () => {
  assert.equal(subjectSlugOf('Mathematics Syllabus (Grades 4-6)'), 'mathematics')
  assert.equal(subjectSlugOf('mathematics'), 'mathematics')
  assert.equal(subjectSlugOf('Lower Primary Syllabi (Grades 1-3)::Grade 1 - English Language'), 'english')
  assert.equal(subjectSlugOf('English Language Syllabus (Grades 4-6)'), 'english')
})

console.log(`\ncurriculumSelectorConstants: ${passed} checks passed`)
