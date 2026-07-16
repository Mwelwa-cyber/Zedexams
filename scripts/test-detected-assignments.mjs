#!/usr/bin/env node
/**
 * Tests for the detected-teaching-assignments normalisation + dedup layer
 * (src/utils/detectedAssignments.js) and its wiring through the migration
 * inference (src/utils/teachingProfileMigration.js).
 * Run: npm run test:detected-assignments
 */

import {
  canonicalGradeId,
  cleanSubjectText,
  resolveSubject,
  normalizeDetectedAssignment,
  normalizeDetectedAssignments,
  detectedAssignmentKey,
  filterDetectedAssignments,
  gradeFilterOptions,
  curriculumFilterOptions,
  CURRICULUM_NOT_CONFIRMED_LABEL,
} from '../src/utils/detectedAssignments.js'
import { inferAssignments, buildMigrationPlan, sourceTypeLabel } from '../src/utils/teachingProfileMigration.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}
function eq(a, b, msg) {
  assert(a === b, `${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

// ── grade canonicalisation ───────────────────────────────────────────────────
console.log('\ngrade canonicalisation')
test('bare numbers, "Grade N" and G-codes fold to the canonical code', () => {
  eq(canonicalGradeId('4'), 'G4')
  eq(canonicalGradeId('Grade 4'), 'G4')
  eq(canonicalGradeId('grade4'), 'G4')
  eq(canonicalGradeId('G4'), 'G4')
  eq(canonicalGradeId('g12'), 'G12')
  eq(canonicalGradeId(' G7 '), 'G7')
})
test('ECE band codes pass through; junk returns empty', () => {
  eq(canonicalGradeId('ECE_N'), 'ECE_N')
  eq(canonicalGradeId('ece_r'), 'ECE_R')
  eq(canonicalGradeId('Grade 99'), '')
  eq(canonicalGradeId('banana'), '')
  eq(canonicalGradeId(''), '')
})

// ── subject cleaning + resolution ────────────────────────────────────────────
console.log('\nsubject cleaning')
test('"Mathematics Syllabus (Grades 4–6)" displays as "Mathematics"', () => {
  eq(cleanSubjectText('Mathematics Syllabus (Grades 4–6)'), 'Mathematics')
  const r = resolveSubject('Mathematics Syllabus (Grades 4–6)')
  eq(r.subjectId, 'mathematics')
  eq(r.subjectLabel, 'Mathematics')
  eq(r.matched, true)
})
test('year inside a grade-range parenthetical is stripped with it', () => {
  const r = resolveSubject('Social Studies Syllabus (Grades 1–7, 2013)')
  eq(r.subjectId, 'social_studies')
  eq(r.subjectLabel, 'Social Studies')
})
test('a leading grade prefix inside the subject cell is stripped', () => {
  eq(resolveSubject('4 · Integrated Science').subjectId, 'integrated_science')
  eq(resolveSubject('Grade 4 · Integrated Science').subjectId, 'integrated_science')
})
test('slugs and labels resolve case-insensitively', () => {
  eq(resolveSubject('integrated_science').subjectLabel, 'Integrated Science')
  eq(resolveSubject('MATHEMATICS').subjectId, 'mathematics')
  eq(resolveSubject('maths').subjectId, 'mathematics')
})
test('unknown subjects keep their cleaned display text (never renamed)', () => {
  const r = resolveSubject('Robotics Club Syllabus (Grades 4–6)')
  eq(r.matched, false)
  eq(r.subjectLabel, 'Robotics Club')
  eq(r.subjectId, 'robotics_club')
})
test('duplicated punctuation and whitespace are trimmed', () => {
  eq(cleanSubjectText('  Mathematics ·  · Syllabus  '), 'Mathematics')
})

// ── normalisation shape ──────────────────────────────────────────────────────
console.log('\nnormalised shape')
test('normalizeDetectedAssignment produces the full canonical shape', () => {
  const n = normalizeDetectedAssignment({
    grade: '4',
    subject: 'Mathematics Syllabus (Grades 4–6)',
    className: ' 4A ',
    curriculumType: 'CBC',
    curriculumSource: 'structured',
    sources: [{ id: 'doc1', title: 'Grade 4 Maths Lesson Plan', typeLabel: 'Lesson Plan', dateMs: 1 }],
  })
  eq(n.gradeId, 'G4')
  eq(n.gradeLabel, 'Grade 4')
  eq(n.subjectId, 'mathematics')
  eq(n.subjectLabel, 'Mathematics')
  eq(n.curriculumId, 'cbc')
  assert(n.curriculumLabel.includes('CBC'))
  eq(n.curriculumConfirmed, true)
  eq(n.className, '4A')
  eq(n.sourceCount, 1)
  eq(n.sourceDocumentIds.length, 1)
})
test('no structured curriculum → "Curriculum not confirmed", never a guess from the title', () => {
  const n = normalizeDetectedAssignment({
    grade: 'G7',
    subject: 'Social Studies Syllabus (Grades 1–7, 2013)', // 2013 in the TITLE must not set OBC
    curriculumSource: '',
  })
  eq(n.curriculumConfirmed, false)
  eq(n.curriculumId, '')
  eq(n.curriculumLabel, CURRICULUM_NOT_CONFIRMED_LABEL)
})

// ── dedup + merging ──────────────────────────────────────────────────────────
console.log('\ndedup + merging')
const cbc = (over = {}) => ({
  grade: 'G4',
  subject: 'Mathematics',
  className: '',
  curriculumType: 'cbc',
  curriculumSource: 'structured',
  sources: [],
  ...over,
})
test('duplicate syllabus + lesson-plan assignments merge into one', () => {
  const list = normalizeDetectedAssignments([
    cbc({ subject: 'Mathematics Syllabus (Grades 4–6)', sources: [{ id: 'a' }] }),
    cbc({ grade: '4', sources: [{ id: 'b' }] }),
    cbc({ grade: 'Grade 4', sources: [{ id: 'c' }] }),
  ])
  eq(list.length, 1)
  eq(list[0].subjectLabel, 'Mathematics')
  eq(list[0].gradeLabel, 'Grade 4')
  eq(list[0].sourceCount, 3, 'source counts combine')
  eq(list[0].sourceDocumentIds.length, 3)
})
test('CBC and OBC assignments never merge', () => {
  const list = normalizeDetectedAssignments([
    cbc({ sources: [{ id: 'a' }] }),
    cbc({ curriculumType: 'previous', sources: [{ id: 'b' }] }),
  ])
  eq(list.length, 2)
  assert(list.some((n) => n.curriculumId === 'cbc'))
  assert(list.some((n) => n.curriculumId === 'previous'))
})
test('different grades never merge', () => {
  const list = normalizeDetectedAssignments([
    cbc({ sources: [{ id: 'a' }] }),
    cbc({ grade: 'G5', sources: [{ id: 'b' }] }),
  ])
  eq(list.length, 2)
})
test('different class names never merge; class match is case-insensitive', () => {
  const list = normalizeDetectedAssignments([
    cbc({ className: '4A', sources: [{ id: 'a' }] }),
    cbc({ className: '4a', sources: [{ id: 'b' }] }),
    cbc({ className: '4B', sources: [{ id: 'c' }] }),
  ])
  eq(list.length, 2)
})
test('an unconfirmed-curriculum bucket folds into the single confirmed sibling', () => {
  const list = normalizeDetectedAssignments([
    cbc({ sources: [{ id: 'a' }, { id: 'b' }] }),
    cbc({ curriculumSource: '', subject: 'Mathematics Syllabus (Grades 4–6)', sources: [{ id: 'c' }, { id: 'd' }] }),
  ])
  eq(list.length, 1)
  eq(list[0].curriculumId, 'cbc')
  eq(list[0].sourceCount, 4, 'merged example: "From 4 documents"')
})
test('an unconfirmed bucket stays separate when BOTH curricula are present (ambiguous)', () => {
  const list = normalizeDetectedAssignments([
    cbc({ sources: [{ id: 'a' }] }),
    cbc({ curriculumType: 'previous', sources: [{ id: 'b' }] }),
    cbc({ curriculumSource: '', sources: [{ id: 'c' }] }),
  ])
  eq(list.length, 3)
  const unconfirmed = list.find((n) => n.curriculumId === '')
  eq(unconfirmed.curriculumLabel, CURRICULUM_NOT_CONFIRMED_LABEL)
})
test('merged document ids never double-count', () => {
  const list = normalizeDetectedAssignments([
    cbc({ sources: [{ id: 'a' }] }),
    cbc({ sources: [{ id: 'a' }] }), // same doc seen twice
  ])
  eq(list.length, 1)
  eq(list[0].sourceDocumentIds.length, 1)
})
test('strongest signal sorts first and each entry carries its dedup key', () => {
  const list = normalizeDetectedAssignments([
    cbc({ grade: 'G5', sources: [{ id: 'a' }] }),
    cbc({ sources: [{ id: 'b' }] }),
    cbc({ sources: [{ id: 'c' }] }),
  ])
  eq(list[0].gradeId, 'G4')
  eq(list[0].key, detectedAssignmentKey(list[0]))
})

// ── search + filters (operate on NORMALISED values) ──────────────────────────
console.log('\nsearch + filters')
const FILTER_LIST = normalizeDetectedAssignments([
  cbc({ sources: [{ id: 'a' }] }),
  cbc({ grade: 'G5', subject: 'Integrated Science', className: '5B', sources: [{ id: 'b' }] }),
  cbc({ grade: 'G7', subject: 'Social Studies', curriculumType: 'previous', sources: [{ id: 'c' }] }),
  cbc({ grade: 'G7', subject: 'English', curriculumSource: '', sources: [{ id: 'd' }] }),
])
test('search matches the NORMALISED subject, not the raw title', () => {
  // Raw was "Integrated Science" under grade "G5" — search by normalised label.
  eq(filterDetectedAssignments(FILTER_LIST, { query: 'integrated' }).length, 1)
  eq(filterDetectedAssignments(FILTER_LIST, { query: 'grade 5' }).length, 1)
  eq(filterDetectedAssignments(FILTER_LIST, { query: '5b' }).length, 1, 'matches class name')
  eq(filterDetectedAssignments(FILTER_LIST, { query: 'OBC' }).length, 1, 'matches curriculum label')
  eq(filterDetectedAssignments(FILTER_LIST, { query: 'zzz' }).length, 0)
})
test('grade + curriculum filters are exact and composable', () => {
  eq(filterDetectedAssignments(FILTER_LIST, { gradeId: 'G7' }).length, 2)
  eq(filterDetectedAssignments(FILTER_LIST, { gradeId: 'G7', curriculumId: 'previous' }).length, 1)
  eq(filterDetectedAssignments(FILTER_LIST, { curriculumId: 'unconfirmed' }).length, 1)
})
test('filter options are derived from the normalised list', () => {
  const grades = gradeFilterOptions(FILTER_LIST)
  eq(grades[0].value, 'G4', 'taxonomy order')
  eq(grades.length, 3)
  const curricula = curriculumFilterOptions(FILTER_LIST)
  assert(curricula.some((o) => o.value === 'unconfirmed'))
  assert(curricula.some((o) => o.value === 'cbc'))
  assert(curricula.some((o) => o.value === 'previous'))
})

// ── wiring through the migration inference ───────────────────────────────────
console.log('\nmigration inference wiring')
test('inferAssignments dedupes messy real-world doc shapes into one suggestion', () => {
  const suggestions = inferAssignments({
    generations: [
      { id: 'g1', tool: 'lesson_plan', inputs: { grade: 'G4', subject: 'Mathematics', curriculum: 'cbc' }, createdAt: 1752451200000 },
      { id: 'g2', tool: 'scheme_of_work', inputs: { grade: '4', subject: 'Mathematics Syllabus (Grades 4–6)', curriculum: 'CBC' } },
    ],
    assessments: [{ id: 't1', targetGrade: 'Grade 4', subject: 'mathematics', curriculumType: 'cbc' }],
  })
  eq(suggestions.length, 1)
  const s = suggestions[0]
  eq(s.grade, 'G4', 'save shape uses the canonical grade code')
  eq(s.subject, 'mathematics', 'save shape uses the canonical subject slug')
  eq(s.count, 3)
  eq(s.sourceCount, 3)
  eq(s.subjectLabel, 'Mathematics')
  eq(s.source, 'generation')
  eq(s.sources.length, 3)
  assert(s.sources.every((src) => src.typeLabel && !/^[A-Za-z0-9]{15,}$/.test(src.title)), 'source titles are human, not ids')
})
test('saving shape falls back to the default curriculum when unconfirmed (UI still shows "not confirmed")', () => {
  const suggestions = inferAssignments({
    generations: [{ id: 'g1', inputs: { grade: 'G4', subject: 'English' } }],
  })
  eq(suggestions[0].curriculumConfirmed, false)
  eq(suggestions[0].curriculumLabel, CURRICULUM_NOT_CONFIRMED_LABEL)
  eq(suggestions[0].curriculumType, 'cbc')
})
test('buildMigrationPlan still drops suggestions the teacher already saved', () => {
  const plan = buildMigrationPlan({
    generations: [{ id: 'g1', inputs: { grade: '4', subject: 'Mathematics Syllabus (Grades 4–6)', curriculum: 'cbc' } }],
    existingAssignments: [{ grade: 'G4', subject: 'mathematics', className: '' }],
  })
  eq(plan.suggestions.length, 0, 'canonicalised suggestion matches the saved assignment')
})
test('sourceTypeLabel maps tool ids to human names', () => {
  eq(sourceTypeLabel('lesson_plan'), 'Lesson Plan')
  eq(sourceTypeLabel('scheme_of_work'), 'Scheme of Work')
  eq(sourceTypeLabel('assessment'), 'Test Paper')
  eq(sourceTypeLabel('some_new_tool'), 'Some New Tool')
})

// ── report ───────────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
