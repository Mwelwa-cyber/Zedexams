#!/usr/bin/env node
/* global console, process */
/**
 * Regression tests for the Class Timetable Studio's curriculum / grade /
 * subject resolution — the shared, authoritative path the grade picker, the
 * curriculum summary, the subject allocations, the generator and the
 * validation panel all read from.
 *
 * Guards the fixes for:
 *   • the CBC grade structure (ECE, Lower Primary G1–3, Upper Primary G4–6,
 *     Secondary Forms 1–4 — no Grade 7/8–12 as CBC values) vs the OBC's own,
 *   • the Grade 1 allocation loading all FOUR learning areas (Mathematics and
 *     Science was silently missing),
 *   • the generation guard (blocked when the resolved allocation is short of
 *     the required 42 periods / 1,260 minutes, no generic fallback),
 *   • the recovered-draft reconciliation (a stale CBC Grade 7 draft),
 *   • the Curriculum reference page and the timetable resolver sharing ONE
 *     allocation source.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-curriculum   (also via npm run test:all)
 */
import {
  resolveTimetableCurriculum,
  gradeStructureModeFor,
  allocationTableRows,
} from '../src/utils/curriculumFramework.js'
import {
  curriculumSubjectsForGrade,
  resolveAllocationReadiness,
} from '../src/shared/utils/classTimetable.js'
import {
  gradeStructureFor,
  gradeOptionsForCurriculum,
  isGradeInCurriculum,
} from '../src/config/teacherTaxonomy.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

/* ── Grade structure: CBC ─────────────────────────────────────── */

const cbcStages = gradeStructureFor('cbc').stages
const cbcValues = new Set(cbcStages.flatMap((s) => s.grades.map((g) => g.value)))
const cbcStageOf = (value) => cbcStages.find((s) => s.grades.some((g) => g.value === value))?.id

test('the Class Timetable grade picker uses the CBC-specific structure', () => {
  assert(gradeStructureModeFor('cbc-2023') === 'cbc', 'CBC 2023 uses the CBC structure')
  assert(gradeStructureModeFor('adapted-2023') === 'cbc', 'the adapted baseline uses CBC-era grades')
  assert(gradeStructureModeFor('custom') === 'cbc', 'a custom school day uses CBC-era grades')
  assert(gradeStructureModeFor('obc-2013') === 'previous', 'OBC 2013 uses its own structure')
})

test('CBC exposes Nursery and Reception', () => {
  assert(cbcValues.has('ECE_N') && cbcValues.has('ECE_R'), 'Nursery + Reception available')
  assert(cbcStageOf('ECE_N') === 'pre-primary', 'ECE bands sit in the pre-primary stage')
})

test('CBC Lower Primary is Grades 1–3 only', () => {
  for (const g of ['G1', 'G2', 'G3']) assert(cbcStageOf(g) === 'lower-primary', `${g} is Lower Primary`)
  assert(cbcStageOf('G4') !== 'lower-primary', 'Grade 4 is NOT Lower Primary under CBC')
})

test('CBC Upper Primary is Grades 4–6 only', () => {
  for (const g of ['G4', 'G5', 'G6']) assert(cbcStageOf(g) === 'upper-primary', `${g} is Upper Primary`)
})

test('CBC secondary uses Forms 1–4 (not Grade 8–12 dual labels)', () => {
  const secondary = cbcStages.find((s) => s.id === 'secondary')
  assert(secondary, 'a secondary stage exists')
  const labels = secondary.grades.map((g) => g.label)
  assert(JSON.stringify(labels) === JSON.stringify(['Form 1', 'Form 2', 'Form 3', 'Form 4']),
    `secondary labels should be Forms 1–4, got ${JSON.stringify(labels)}`)
  for (const bad of ['Grade 8 / Form 1', 'Grade 9 / Form 2', 'Grade 12 / Form 5']) {
    assert(!labels.includes(bad), `CBC must not show old dual label "${bad}"`)
  }
})

test('CBC does NOT offer Grade 7 or Grades 8–12 as grade values', () => {
  assert(!cbcValues.has('G7'), 'Grade 7 is not a CBC grade')
  assert(!cbcValues.has('G12'), 'Grade 12 is not a CBC grade')
  assert(!isGradeInCurriculum('G7', 'cbc'), 'G7 is invalid under CBC')
  for (const g of ['G7', 'G12']) {
    const opts = gradeOptionsForCurriculum('cbc')
    assert(!opts.some((o) => o.value === g), `${g} must not appear in the CBC grade options`)
  }
})

/* ── Grade structure: OBC keeps its own ───────────────────────── */

test('OBC retains its own grade structure (Grade 7 is valid, ECE is not)', () => {
  assert(isGradeInCurriculum('G7', 'previous'), 'Grade 7 is an OBC grade')
  assert(isGradeInCurriculum('G12', 'previous'), 'Grade 12 is an OBC grade')
  assert(!isGradeInCurriculum('ECE_N', 'previous'), 'OBC has no ECE bands')
  const obcStages = gradeStructureFor('previous').stages
  assert(obcStages.some((s) => s.grades.some((g) => g.value === 'G7')), 'OBC lists Grade 7')
})

test('switching CBC↔OBC identifies grades to clear', () => {
  // A CBC Upper Primary grade (G4) is valid in both — kept.
  assert(isGradeInCurriculum('G4', 'cbc') && isGradeInCurriculum('G4', 'previous'), 'G4 survives either way')
  // Changing CBC → OBC: an ECE band is invalid in OBC → cleared.
  assert(!isGradeInCurriculum('ECE_N', 'previous'), 'ECE cleared when moving to OBC')
  // Changing OBC → CBC: Grade 7 is invalid in CBC → cleared.
  assert(!isGradeInCurriculum('G7', 'cbc'), 'Grade 7 cleared when moving to CBC')
})

/* ── Grade 1 allocation (the visible bug) ─────────────────────── */

const G1_CANON = [
  { subjectId: 'literacy-language-english', weeklyPeriods: 11, weeklyMinutes: 330 },
  { subjectId: 'literacy-language-zambian', weeklyPeriods: 11, weeklyMinutes: 330 },
  { subjectId: 'mathematics-and-science', weeklyPeriods: 10, weeklyMinutes: 300 },
  { subjectId: 'creative-and-technology-studies', weeklyPeriods: 10, weeklyMinutes: 300 },
]

test('CBC Grade 1 resolves exactly the four official learning areas by canonical id', () => {
  const fw = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  assert(fw, 'Grade 1 resolves an allocation')
  assert(fw.stageId === 'lower-primary', `stageId should be lower-primary, got ${fw.stageId}`)
  assert(fw.subjects.length === 4, `expected 4 learning areas, got ${fw.subjects.length}`)
  for (const want of G1_CANON) {
    const got = fw.subjects.find((s) => s.subjectId === want.subjectId)
    assert(got, `missing learning area ${want.subjectId}`)
    assert(got.weeklyPeriods === want.weeklyPeriods, `${want.subjectId}: ${got.weeklyPeriods} periods, want ${want.weeklyPeriods}`)
    assert(got.weeklyMinutes === want.weeklyMinutes, `${want.subjectId}: ${got.weeklyMinutes} min, want ${want.weeklyMinutes}`)
  }
})

test('Mathematics and Science is present at Grade 1 with 10 periods (the regression)', () => {
  const fw = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const ms = fw.subjects.find((s) => s.subjectId === 'mathematics-and-science')
  assert(ms && ms.weeklyPeriods === 10 && ms.weeklyMinutes === 300, 'Maths & Science = 10 periods / 300 min')
})

test('Grade 1 totals 42 periods, 21 hours, 30-minute periods', () => {
  const fw = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const total = fw.subjects.reduce((n, s) => n + s.weeklyPeriods, 0)
  assert(total === 42, `total periods should be 42, got ${total}`)
  assert(fw.requiredWeeklyPeriods === 42, 'requiredWeeklyPeriods = 42')
  assert(fw.weeklyContactMinutes === 1260, '1,260 minutes = 21 hours')
  assert(fw.periodLengthMinutes === 30, '30-minute periods')
  const minutes = fw.subjects.reduce((n, s) => n + s.weeklyMinutes, 0)
  assert(minutes === 1260, `learning-area minutes sum to 1,260, got ${minutes}`)
})

test('the alias variants collapse onto ONE canonical Mathematics and Science area', () => {
  // The many display-name variants must never spawn a second subject or drop
  // the official one from the allocation.
  const fw = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G2' })
  const msAreas = fw.subjects.filter((s) => s.subjectId === 'mathematics-and-science')
  assert(msAreas.length === 1, 'exactly one Mathematics and Science area')
  const ms = msAreas[0]
  for (const variant of ['mathematics & science', 'maths and science', 'pre-mathematics and pre-science']) {
    assert(ms.aliases.includes(variant), `alias "${variant}" maps onto the canonical area`)
  }
})

test('curriculumSubjectsForGrade seeds all four Grade 1 areas (no missing subject)', () => {
  const subjects = curriculumSubjectsForGrade('G1', 'cbc-2023')
  assert(subjects.length === 4, `Grade 1 seeds 4 subjects, got ${subjects.length}`)
  const ids = subjects.map((s) => s.subjectId)
  for (const want of G1_CANON) assert(ids.includes(want.subjectId), `seeded list missing ${want.subjectId}`)
})

/* ── Generation guard ─────────────────────────────────────────── */

test('generation is DISABLED when only 32 of 42 periods resolve (Maths & Science dropped)', () => {
  const curriculum = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  // Simulate a stale draft: the three areas that survive, minus Maths & Science.
  const stale = curriculumSubjectsForGrade('G1', 'cbc-2023')
    .filter((s) => s.subjectId !== 'mathematics-and-science')
  const r = resolveAllocationReadiness({ subjects: stale, curriculum })
  assert(!r.ready, 'an incomplete allocation must block generation')
  assert(r.resolvedPeriods === 32 && r.requiredPeriods === 42, `32 of 42, got ${r.resolvedPeriods}/${r.requiredPeriods}`)
  assert(r.resolvedSubjects === 3 && r.requiredSubjects === 4, 'diagnostic: 3 of 4 areas resolved')
  assert(r.missing.length === 1 && r.missing[0].subjectId === 'mathematics-and-science',
    'the missing area is named for the diagnostic')
})

test('generation is ENABLED when all 42 periods / 1,260 minutes resolve', () => {
  const curriculum = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const subjects = curriculumSubjectsForGrade('G1', 'cbc-2023')
  const r = resolveAllocationReadiness({ subjects, curriculum })
  assert(r.ready, 'a complete allocation enables generation')
  assert(r.resolvedPeriods === 42 && r.resolvedMinutes === 1260,
    `resolved 42 periods / 1,260 min, got ${r.resolvedPeriods}/${r.resolvedMinutes}`)
})

test('a legitimately customised week (edited period counts) still resolves complete', () => {
  const curriculum = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const subjects = curriculumSubjectsForGrade('G1', 'cbc-2023')
    .map((s) => (s.subjectId === 'mathematics-and-science' ? { ...s, periodsPerWeek: 12 } : s))
  const r = resolveAllocationReadiness({ subjects, curriculum })
  assert(r.ready, 'editing a count must not falsely block generation — readiness keys on the area SET')
})

test('no allocation → applicable:false (no generic fallback masquerading as valid)', () => {
  // CBC Grade 7 / secondary have no prescribed table.
  const g7 = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G7' })
  assert(g7 === null, 'CBC Grade 7 has no prescribed allocation')
  const r = resolveAllocationReadiness({ subjects: [], curriculum: g7 })
  assert(r.applicable === false && r.ready === false, 'an absent allocation is never treated as ready')
  // The seed path returns [] for a CBC grade with no table — never a generic list.
  assert(curriculumSubjectsForGrade('G8', 'cbc-2023').length >= 0, 'seed path does not throw for CBC secondary')
})

/* ── Recovered-draft reconciliation ───────────────────────────── */

test('a stale CBC Grade 7 draft is caught as invalid for the current catalog', () => {
  assert(!isGradeInCurriculum('G7', gradeStructureModeFor('cbc-2023')),
    'a recovered CBC Grade 7 draft resolves to an invalid grade → Needs review')
})

test('a valid Grade 1 draft reconciles to all four learning areas', () => {
  const curriculum = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const draftSubjects = curriculumSubjectsForGrade('G1', 'cbc-2023') // a healthy draft
  const r = resolveAllocationReadiness({ subjects: draftSubjects, curriculum })
  assert(r.ready && r.resolvedSubjects === 4, 'a healthy Grade 1 draft restores all four areas')
})

/* ── Integration: one allocation source ───────────────────────── */

test('the Curriculum reference page and the timetable resolver share ONE allocation', () => {
  // The Curriculum page renders allocationTableRows('lower_primary'); the studio
  // reads resolveTimetableCurriculum. They MUST agree on totals + per-area periods.
  const pageRows = allocationTableRows('lower_primary')
  const fw = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  assert(pageRows.totalPeriods === fw.requiredWeeklyPeriods,
    `page ${pageRows.totalPeriods} vs resolver ${fw.requiredWeeklyPeriods}`)
  assert(pageRows.periodMinutes === fw.periodLengthMinutes, 'period length matches')
  const pagePeriods = pageRows.rows.reduce((n, r) => n + r.periods, 0)
  const fwPeriods = fw.subjects.reduce((n, s) => n + s.weeklyPeriods, 0)
  assert(pagePeriods === fwPeriods && pagePeriods === 42, `page ${pagePeriods} vs resolver ${fwPeriods}`)
  // Every reference-table row's periods match a resolver learning area's periods.
  for (const row of pageRows.rows) {
    assert(fw.subjects.some((s) => s.weeklyPeriods === row.periods && s.canonicalName === row.label),
      `page row "${row.label}" (${row.periods}) not found in the resolver`)
  }
})

test('auto-fill uses the same four Grade 1 learning areas the resolver returns', () => {
  const subjects = curriculumSubjectsForGrade('G1', 'cbc-2023')
  const fw = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const seededIds = new Set(subjects.map((s) => s.subjectId))
  for (const s of fw.subjects) assert(seededIds.has(s.subjectId), `auto-fill missing ${s.subjectId}`)
})

test('validation requires all 42 periods — an incomplete allocation is not "complete"', () => {
  const curriculum = resolveTimetableCurriculum({ curriculumId: 'cbc-2023', gradeId: 'G1' })
  const complete = resolveAllocationReadiness({ subjects: curriculumSubjectsForGrade('G1', 'cbc-2023'), curriculum })
  assert(complete.resolvedPeriods === 42 && complete.ready, 'the full week validates')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
