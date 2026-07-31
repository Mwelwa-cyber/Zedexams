#!/usr/bin/env node
/**
 * Library taxonomy adapter — the values come from educationLevels.js and the
 * curriculum catalogue, and the normalisers fold every spelling a migration
 * will meet.
 *
 * Run: npm run test:library-taxonomy
 */

import assert from 'node:assert/strict'
import { EDUCATION_LEVELS, LEVEL_STAGE_LABELS } from '../../config/educationLevels.js'
import {
  CURRICULA,
  LIBRARY_GRADES,
  LIBRARY_GRADE_GROUPS,
  TERMS,
  compareGrades,
  curriculumLabel,
  getGrade,
  gradeLabel,
  gradesForCurriculum,
  normalizeCurriculum,
  normalizeGrade,
  normalizeSubject,
  normalizeTerm,
  sortGradeIds,
  subjectsForGrade,
  termLabel,
} from './taxonomy.js'

let failures = 0
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`) } catch (err) {
    failures++
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('\nlibrary/taxonomy')

/* ── Pass-through from educationLevels.js ──────────────────── */

test('every grade comes from EDUCATION_LEVELS, one for one, in ladder order', () => {
  assert.equal(LIBRARY_GRADES.length, EDUCATION_LEVELS.length)
  LIBRARY_GRADES.forEach((grade, i) => {
    const level = EDUCATION_LEVELS[i]
    assert.equal(grade.id, level.id, 'id is the ladder id')
    assert.equal(grade.label, level.label, 'label is passed through, never re-formatted')
    assert.equal(grade.order, level.order)
    assert.equal(grade.value, level.value)
    assert.equal(grade.kbGrade, level.kbGrade)
  })
})

test('group is the ladder stage, with its declared label', () => {
  for (const grade of LIBRARY_GRADES) {
    const level = EDUCATION_LEVELS.find((l) => l.id === grade.id)
    assert.equal(grade.group, level.stage)
    assert.equal(grade.groupLabel, LEVEL_STAGE_LABELS[level.stage])
  }
  assert.deepEqual(LIBRARY_GRADE_GROUPS.map((g) => g.id), ['ece', 'primary', 'secondary'])
})

test('Early Childhood is exactly Nursery then Reception', () => {
  const ece = LIBRARY_GRADES.filter((g) => g.group === 'ece')
  assert.deepEqual(ece.map((g) => g.id), ['nursery', 'reception'])
  assert.deepEqual(ece.map((g) => g.label), ['Nursery', 'Reception'])
})

test('Baby Class and Middle Class are never offered as grades', () => {
  const labels = LIBRARY_GRADES.map((g) => g.label.toLowerCase())
  assert.ok(!labels.some((l) => l.includes('baby')), 'no Baby Class')
  assert.ok(!labels.some((l) => l.includes('middle')), 'no Middle Class')
})

test('ordering is the ladder, not the alphabet', () => {
  const ordered = LIBRARY_GRADES.map((g) => g.id)
  assert.equal(ordered[0], 'nursery')
  assert.equal(ordered[1], 'reception')
  assert.ok(ordered.indexOf('grade-1') < ordered.indexOf('grade-7'))
  assert.ok(ordered.indexOf('grade-7') < ordered.indexOf('form-1'))

  // The alphabetical failure mode this replaces: Form 1 before Grade 1,
  // Reception after Grade 7.
  const shuffled = ['form-1', 'grade-7', 'reception', 'grade-1', 'nursery']
  assert.deepEqual(
    sortGradeIds(shuffled),
    ['nursery', 'reception', 'grade-1', 'grade-7', 'form-1'],
  )
  assert.ok(compareGrades('nursery', 'form-4') < 0)
})

/* ── Normalisers ───────────────────────────────────────────── */

test('normalizeGrade folds every spelling a migration will meet', () => {
  for (const input of ['Grade 4', 'grade 4', '  GRADE  4 ', 'G4', 'grade four', 'gr4']) {
    assert.equal(normalizeGrade(input), 'grade-4', `${input} → grade-4`)
  }
  assert.equal(normalizeGrade('Form 2'), 'form-2')
  assert.equal(normalizeGrade('F2'), 'form-2')
  assert.equal(normalizeGrade('form two'), 'form-2')
  // "Grade 10" is the display alias some schools use for Form 3 — the ladder
  // already declares it, so both spellings reach ONE level.
  assert.equal(normalizeGrade('Grade 10'), 'form-3')
  assert.equal(normalizeGrade('G10'), 'form-3')
  assert.equal(normalizeGrade('Nursery'), 'nursery')
  assert.equal(normalizeGrade('ECE_R'), 'reception')
  // Retired spellings still resolve so old records stay reachable.
  assert.equal(normalizeGrade('Baby Class'), 'nursery')
})

test('normalizeGrade returns null rather than guessing', () => {
  for (const input of ['', null, undefined, 'Grade 99', 'banana', 'Unsorted', {}]) {
    assert.equal(normalizeGrade(input), null, `${String(input)} → null`)
  }
})

test('normalizeCurriculum folds spellings and refuses to default', () => {
  for (const input of ['cbc', 'CBC', ' Cbc ', '2023', 'new']) {
    assert.equal(normalizeCurriculum(input), 'cbc')
  }
  for (const input of ['obc', 'OBC', 'previous', '2013', 'old', 'CDC']) {
    assert.equal(normalizeCurriculum(input), 'obc', `${input} → obc`)
  }
  // Unlike paperTerminology's normaliser, filing has no safe default.
  assert.equal(normalizeCurriculum('Secondary'), null)
  assert.equal(normalizeCurriculum('Unsorted'), null)
  assert.equal(normalizeCurriculum(''), null)
  assert.equal(normalizeCurriculum(null), null)
})

test('normalizeTerm folds to 1 | 2 | 3', () => {
  assert.equal(normalizeTerm(2), 2)
  assert.equal(normalizeTerm('2'), 2)
  assert.equal(normalizeTerm('Term 2'), 2)
  assert.equal(normalizeTerm('term two'), 2)
  assert.equal(normalizeTerm('T3'), 3)
  assert.equal(normalizeTerm('II'), 2)
  assert.equal(normalizeTerm(0), null)
  assert.equal(normalizeTerm(4), null)
  assert.equal(normalizeTerm('Term 4'), null)
  assert.equal(normalizeTerm(''), null)
  assert.equal(normalizeTerm(null), null)
})

test('normalizeSubject delegates to the catalogue', () => {
  assert.equal(normalizeSubject('Mathematics'), 'mathematics')
  assert.equal(normalizeSubject('mathematics'), 'mathematics')
  assert.equal(normalizeSubject(''), null)
  assert.equal(normalizeSubject(null), null)
})

/* ── Curriculum-scoped candidates ──────────────────────────── */

test('CURRICULA comes from the curriculum catalogue', () => {
  assert.deepEqual(CURRICULA.map((c) => c.id), ['cbc', 'obc'])
  assert.equal(CURRICULA.find((c) => c.id === 'cbc').framework, '2023')
  assert.equal(CURRICULA.find((c) => c.id === 'obc').framework, '2013')
  assert.ok(curriculumLabel('cbc').length > 0)
})

test('grade candidates narrow to the curriculum that declares them', () => {
  const cbc = gradesForCurriculum('cbc').map((g) => g.id)
  const obc = gradesForCurriculum('obc').map((g) => g.id)
  // CBC abolished Grade 7 and stops at Form 4.
  assert.ok(!cbc.includes('grade-7'), 'CBC has no Grade 7')
  assert.ok(!cbc.includes('form-5'), 'CBC stops at Form 4')
  assert.ok(cbc.includes('nursery'), 'CBC declares the ECE bands')
  // The previous syllabus runs Grade 1–7 / Form 1–5 and has no ECE.
  assert.ok(obc.includes('grade-7'))
  assert.ok(obc.includes('form-5'))
  assert.ok(!obc.includes('nursery'), 'the previous syllabus has no ECE bands')
})

test('an unknown curriculum enumerates the whole ladder rather than nothing', () => {
  // Counting a document filed under no curriculum must still be possible.
  assert.equal(gradesForCurriculum(null).length, LIBRARY_GRADES.length)
})

test('subject candidates come from the syllabus catalogue and fail closed', () => {
  const subjects = subjectsForGrade('cbc', 'grade-4')
  assert.ok(subjects.length > 0, 'CBC Grade 4 offers subjects')
  assert.ok(subjects.every((s) => s.id && s.label), 'every candidate has an id and a label')
  assert.deepEqual(subjectsForGrade(null, 'grade-4'), [])
  assert.deepEqual(subjectsForGrade('cbc', null), [])
  assert.deepEqual(subjectsForGrade('cbc', 'grade-99'), [])
})

/* ── Labels ────────────────────────────────────────────────── */

test('labels never come back blank', () => {
  assert.equal(gradeLabel('grade-4'), 'Grade 4')
  assert.equal(gradeLabel('form-2'), 'Form 2')
  assert.equal(gradeLabel('nursery'), 'Nursery')
  assert.equal(gradeLabel('mystery'), 'mystery')
  assert.equal(termLabel(2), 'Term 2')
  assert.equal(termLabel('Term 2'), 'Term 2')
  assert.equal(termLabel(9), '')
  assert.equal(getGrade('grade-4').kbGrade, 'G4')
  assert.equal(getGrade('nope'), null)
})

if (failures) {
  console.error(`\n${failures} test(s) failed\n`)
  process.exit(1)
}
console.log('\nAll library/taxonomy tests passed\n')
