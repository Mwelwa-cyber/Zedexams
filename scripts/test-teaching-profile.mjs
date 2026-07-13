#!/usr/bin/env node
/**
 * Tests for the Teaching Profile pure core + migration inference.
 * Run: npm run test:teaching-profile
 */

import {
  normalizeCurriculumType,
  curriculumTypeLabel,
  gradeLabel,
  subjectLabel,
  schoolLevelForGrade,
  normalizeAssignment,
  normalizeAssignmentPartial,
  assignmentKey,
  assignmentLabel,
  validateAssignment,
  findDuplicateAssignment,
  normalizeTeachingProfile,
  normalizeTeachingProfilePartial,
  computeProfileCompletion,
  academicYearMismatch,
  resolveDefaultAssignmentId,
} from '../src/utils/teachingProfileCore.js'
import {
  inferAssignments,
  inferProfileDefaults,
} from '../src/utils/teachingProfileMigration.js'

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

// ── curriculum type folding ──────────────────────────────────────────────────
console.log('\ncurriculum type')
test('folds every CBC spelling to cbc', () => {
  for (const v of ['cbc', 'CBC', 'new', '2023', '', undefined, null, 'anything']) {
    eq(normalizeCurriculumType(v), 'cbc', `curriculum ${JSON.stringify(v)}`)
  }
})
test('folds every previous spelling to previous', () => {
  for (const v of ['previous', 'OBC', 'obc', 'old', '2013', 'Previous']) {
    eq(normalizeCurriculumType(v), 'previous', `curriculum ${JSON.stringify(v)}`)
  }
})
test('curriculumTypeLabel is human', () => {
  assert(curriculumTypeLabel('cbc').includes('CBC'))
  assert(curriculumTypeLabel('previous').includes('OBC'))
})

// ── labels + school level ────────────────────────────────────────────────────
console.log('\nlabels + school level')
test('gradeLabel / subjectLabel resolve known values', () => {
  eq(gradeLabel('G4'), 'Grade 4')
  eq(subjectLabel('integrated_science'), 'Integrated Science')
  eq(gradeLabel('ZZ'), 'ZZ') // unknown falls back to raw
})
test('schoolLevelForGrade maps bands', () => {
  eq(schoolLevelForGrade('ECE_N'), 'ece')
  eq(schoolLevelForGrade('ECE'), 'ece')
  eq(schoolLevelForGrade('G1'), 'primary')
  eq(schoolLevelForGrade('G7'), 'primary')
  eq(schoolLevelForGrade('G8'), 'secondary')
  eq(schoolLevelForGrade('G12'), 'secondary')
  eq(schoolLevelForGrade('junk'), '')
})

// ── assignment normalization ─────────────────────────────────────────────────
console.log('\nassignment normalization')
test('defaults: isActive true, isDefault false, curriculum folded', () => {
  const a = normalizeAssignment({ grade: 'G4', subject: 'mathematics', curriculumType: 'CBC' })
  eq(a.isActive, true)
  eq(a.isDefault, false)
  eq(a.curriculumType, 'cbc')
  eq(a.periodsPerWeek, null)
  eq(a.lessonDurationMinutes, null)
})
test('clamps out-of-range numerics to null', () => {
  const a = normalizeAssignment({ periodsPerWeek: 999, lessonDurationMinutes: 2 })
  eq(a.periodsPerWeek, null)
  eq(a.lessonDurationMinutes, null)
})
test('keeps in-range numerics', () => {
  const a = normalizeAssignment({ periodsPerWeek: 5, lessonDurationMinutes: 40 })
  eq(a.periodsPerWeek, 5)
  eq(a.lessonDurationMinutes, 40)
})
test('does NOT assume 5 periods (multi-subject support)', () => {
  const sci = normalizeAssignment({ grade: 'G4', subject: 'integrated_science', periodsPerWeek: 3 })
  const maths = normalizeAssignment({ grade: 'G4', subject: 'mathematics', periodsPerWeek: 5 })
  eq(sci.periodsPerWeek, 3)
  eq(maths.periodsPerWeek, 5)
})
test('normalizeAssignmentPartial only shapes present keys', () => {
  const p = normalizeAssignmentPartial({ periodsPerWeek: 4 })
  eq(Object.keys(p).length, 1)
  eq(p.periodsPerWeek, 4)
})

// ── keys, labels, duplicates ─────────────────────────────────────────────────
console.log('\nkeys + duplicates')
test('assignmentKey is stable and class-insensitive', () => {
  const a = { grade: 'G4', subject: 'mathematics', className: 'Class A' }
  const b = { grade: 'G4', subject: 'mathematics', className: 'class a' }
  eq(assignmentKey(a), assignmentKey(b))
})
test('different class → different key', () => {
  const a = { grade: 'G4', subject: 'mathematics', className: 'A' }
  const b = { grade: 'G4', subject: 'mathematics', className: 'B' }
  assert(assignmentKey(a) !== assignmentKey(b))
})
test('assignmentLabel reads nicely', () => {
  eq(assignmentLabel({ grade: 'G4', subject: 'integrated_science' }), 'Grade 4 · Integrated Science')
  eq(assignmentLabel({ grade: 'G5', subject: 'english', className: '5A' }), 'Grade 5 · English · 5A')
})
test('findDuplicateAssignment finds dup and honours exceptId', () => {
  const list = [
    { id: '1', grade: 'G4', subject: 'mathematics', className: '' },
    { id: '2', grade: 'G4', subject: 'english', className: '' },
  ]
  const dup = findDuplicateAssignment(list, { grade: 'G4', subject: 'mathematics' })
  eq(dup.id, '1')
  const none = findDuplicateAssignment(list, { grade: 'G4', subject: 'mathematics' }, '1')
  eq(none, null)
})

// ── validation ───────────────────────────────────────────────────────────────
console.log('\nvalidation')
test('requires grade + subject', () => {
  const r = validateAssignment({})
  eq(r.valid, false)
  eq(r.errors.length, 2)
})
test('valid assignment passes', () => {
  const r = validateAssignment({ grade: 'G4', subject: 'mathematics' })
  eq(r.valid, true)
  eq(r.errors.length, 0)
})
test('out-of-syllabus pairing warns but stays valid', () => {
  const r = validateAssignment({ grade: 'G1', subject: 'physics' })
  eq(r.valid, true)
  assert(r.warnings.length >= 1, 'expected a warning for G1 physics')
})

// ── profile ──────────────────────────────────────────────────────────────────
console.log('\nprofile')
test('normalizeTeachingProfile defaults calendarSource to national', () => {
  const p = normalizeTeachingProfile({})
  eq(p.calendarSource, 'national')
  eq(p.onboardingCompleted, false)
  eq(p.profileCompletion, 0)
})
test('profileStatus defaults to draft and rejects unknown values', () => {
  eq(normalizeTeachingProfile({}).profileStatus, 'draft')
  eq(normalizeTeachingProfile({ profileStatus: 'active' }).profileStatus, 'active')
  eq(normalizeTeachingProfile({ profileStatus: 'bogus' }).profileStatus, 'draft')
})
test('normalizeTeachingProfilePartial only shapes present keys', () => {
  const p = normalizeTeachingProfilePartial({ calendarId: 'moe-national' })
  eq(Object.keys(p).length, 1)
  eq(p.calendarId, 'moe-national')
})
test('rejects unknown schoolLevel / calendarSource', () => {
  const p = normalizeTeachingProfile({ schoolLevel: 'college', calendarSource: 'mars' })
  eq(p.schoolLevel, '')
  eq(p.calendarSource, 'national')
})

// ── completion (required drives %, timetable is recommended only) ────────────
console.log('\ncompletion')
test('empty profile is 0% with 5 required items and no timetable in them', () => {
  const { percent, items, recommended } = computeProfileCompletion({})
  eq(percent, 0)
  eq(items.length, 5)
  eq(items.some((i) => i.key === 'timetable'), false, 'timetable must NOT be a required item')
  eq(recommended.some((r) => r.key === 'timetable'), true, 'timetable is a recommended item')
})
test('default item needs an active id to still exist', () => {
  const profile = { calendarId: 'moe-national', academicYear: '2026', defaultAssignmentId: 'missing' }
  const assignments = [{ id: 'a1', grade: 'G4', subject: 'mathematics', isActive: true }]
  const { items } = computeProfileCompletion({ profile, assignments })
  eq(items.find((i) => i.key === 'default').done, false)
  eq(items.find((i) => i.key === 'assignments').done, true)
})
test('a complete core profile reaches 100% WITHOUT a timetable', () => {
  const profile = { calendarId: 'moe-national', academicYear: '2026', defaultAssignmentId: 'a1' }
  const assignments = [{ id: 'a1', grade: 'G4', subject: 'mathematics', isActive: true }]
  const res = computeProfileCompletion({ profile, assignments, teachingPeriodResolved: true })
  eq(res.percent, 100)
  eq(res.complete, true)
  // The timetable recommendation is still shown as not-done (optional).
  eq(res.recommended.find((r) => r.key === 'timetable').done, false)
})
test('recommended: lesson duration + additional classes reflect the assignments', () => {
  const profile = { calendarId: 'moe-national', academicYear: '2026', defaultAssignmentId: 'a1' }
  const assignments = [
    { id: 'a1', grade: 'G4', subject: 'mathematics', isActive: true, lessonDurationMinutes: 40 },
    { id: 'a2', grade: 'G4', subject: 'english', isActive: true },
  ]
  const { recommended } = computeProfileCompletion({ profile, assignments, teachingPeriodResolved: true })
  eq(recommended.find((r) => r.key === 'lessonDuration').done, true)
  eq(recommended.find((r) => r.key === 'additionalClasses').done, true)
})

// ── academic-year mismatch (non-blocking) ────────────────────────────────────
console.log('\nacademic-year mismatch')
test('flags a mismatch between stored and resolved year', () => {
  const r = academicYearMismatch({ academicYear: '2026' }, 2027)
  eq(r.mismatch, true)
  eq(r.profileYear, 2026)
  eq(r.resolvedYear, 2027)
})
test('no mismatch when years agree or data is missing', () => {
  eq(academicYearMismatch({ academicYear: '2026' }, 2026).mismatch, false)
  eq(academicYearMismatch({ academicYear: '' }, 2026).mismatch, false)
  eq(academicYearMismatch({ academicYear: '2026' }, null).mismatch, false)
})

// ── default resolution ───────────────────────────────────────────────────────
console.log('\ndefault resolution')
test('falls back to first active when stored default is gone', () => {
  const profile = { defaultAssignmentId: 'gone' }
  const assignments = [
    { id: 'a1', grade: 'G4', subject: 'mathematics', isActive: false },
    { id: 'a2', grade: 'G4', subject: 'english', isActive: true },
  ]
  eq(resolveDefaultAssignmentId(profile, assignments), 'a2')
})
test('keeps stored default when it is still active', () => {
  const profile = { defaultAssignmentId: 'a2' }
  const assignments = [
    { id: 'a1', grade: 'G4', subject: 'mathematics', isActive: true },
    { id: 'a2', grade: 'G4', subject: 'english', isActive: true },
  ]
  eq(resolveDefaultAssignmentId(profile, assignments), 'a2')
})
test('null when nothing active', () => {
  eq(resolveDefaultAssignmentId({}, [{ id: 'a1', isActive: false }]), null)
})

// ── migration inference ──────────────────────────────────────────────────────
console.log('\nmigration inference')
test('inferAssignments extracts from mixed doc shapes + dedupes + counts', () => {
  const suggestions = inferAssignments({
    generations: [
      { inputs: { grade: 'G4', subject: 'mathematics', curriculum: 'cbc' } },
      { output: { header: { grade: 'G4', subject: 'mathematics' } } }, // dup of above
    ],
    assessments: [{ targetGrade: 'G5', subject: 'english', curriculumType: 'previous' }],
    lessonPlans: [{ grade: 'G4', subject: 'integrated_science', curriculumType: 'CBC' }],
  })
  const maths = suggestions.find((s) => s.grade === 'G4' && s.subject === 'mathematics')
  eq(maths.count, 2, 'maths should be backed by 2 docs')
  const eng = suggestions.find((s) => s.subject === 'english')
  eq(eng.grade, 'G5')
  eq(eng.curriculumType, 'previous')
  // strongest signal first
  eq(suggestions[0].subject, 'mathematics')
})
test('inferAssignments skips docs missing grade or subject', () => {
  const s = inferAssignments({ generations: [{ inputs: { grade: 'G4' } }, {}] })
  eq(s.length, 0)
})
test('inferProfileDefaults votes school level from grades', () => {
  const d = inferProfileDefaults({
    teacherPreferences: { curriculum: { academicYear: '2026', curriculum: 'cbc' } },
    assignments: [
      { grade: 'G4', count: 3 },
      { grade: 'G8', count: 1 },
    ],
  })
  eq(d.schoolLevel, 'primary')
  eq(d.academicYear, '2026')
  eq(d.defaultCurriculumType, 'cbc')
})

// ── report ───────────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
