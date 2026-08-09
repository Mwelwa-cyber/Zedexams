#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Class Timetable studio's deterministic core
 * (src/shared/utils/classTimetable.js): period/time construction, capacity,
 * round-robin token spreading, the balanced auto-fill, and the XLSX
 * workbook parts (src/engines/export-engine/classTimetableToXlsx.js).
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:class-timetable   (also via npm run test:all)
 */
import {
  buildPeriods,
  lessonPeriods,
  lessonCapacity,
  curriculumSubjectsForGrade,
  defaultPeriodsPerWeek,
  recommendedLessonPeriods,
  roundRobinTokens,
  autoFillTimetable,
  validateTimetable,
  totalAllocated,
  filledCount,
  buildTimetableArtifact,
  dayEndTime,
  lastLessonEndTime,
  DEFAULT_DAYS,
} from '../src/shared/utils/classTimetable.js'
import {
  autoFillBlocks,
  validateTimetableBlocks,
  normalizeTimetableArtifact,
  distributePeriodsPerDay,
  slotCountForDay,
  weeklyCapacity,
  SCHOOL_DAY_TEMPLATES,
  SCHEMA_VERSION,
  DAY_TYPES,
  dayTypeLabel,
  templatesForDayType,
  periodsForDay,
  dayScheduleOverride,
  withDaySchedule,
  reportingTimeForDay,
  knockOffTimeForDay,
  resolveCapacityFit,
  weekdayNameForDate,
  withCalendarOverride,
  removeCalendarOverride,
  calendarOverrideForDate,
  effectiveDayScheduleForDate,
} from '../src/shared/utils/classTimetable.js'
import {
  getFrameworkForGrade,
  resolveTimetableCurriculum,
  bandForGrade,
  subjectLoad,
  CURRICULA,
} from '../src/utils/curriculumFramework.js'
import { BLOCK_TYPES, makeBlock, segmentsOf, fitsInOneSegment } from '../src/shared/utils/timetableBlocks.js'
import { buildTimetableGridModel, cellState, dayRowForSlot } from '../src/shared/utils/timetableGridModel.js'
import { buildClassTimetableWorkbookFiles } from '../src/engines/export-engine/classTimetableToXlsx.js'
import { buildPrintableHtml } from '../src/engines/export-engine/classTimetableToPdf.js'

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

/* ── buildPeriods ─────────────────────────────────────────────── */

test('buildPeriods computes lesson times and inserts breaks at the right spot', () => {
  const periods = buildPeriods({
    startTime: '07:30',
    periodMinutes: 40,
    lessonPeriods: 4,
    breaks: [{ afterPeriod: 2, minutes: 20, name: 'BREAK' }],
  })
  const lessons = lessonPeriods(periods)
  assert(lessons.length === 4, `expected 4 lesson rows, got ${lessons.length}`)
  assert(periods.length === 5, `expected 5 rows (4 lessons + 1 break), got ${periods.length}`)

  assert(lessons[0].start === '07:30' && lessons[0].end === '08:10', `p1 times wrong: ${lessons[0].start}-${lessons[0].end}`)
  assert(lessons[1].end === '08:50', `p2 end wrong: ${lessons[1].end}`)

  const brk = periods.find((p) => p.kind === 'break')
  assert(brk, 'no break row produced')
  assert(brk.start === '08:50' && brk.end === '09:10', `break times wrong: ${brk.start}-${brk.end}`)
  // The lesson after the break starts when the break ends.
  assert(lessons[2].start === '09:10', `p3 should follow the break: ${lessons[2].start}`)
})

test('buildPeriods honours disabled breaks and clamps the lesson count', () => {
  const periods = buildPeriods({
    lessonPeriods: 3,
    breaks: [{ afterPeriod: 1, minutes: 15, name: 'BREAK', enabled: false }],
  })
  assert(periods.every((p) => p.kind === 'lesson'), 'disabled break should not appear')
  assert(lessonPeriods(periods).length === 3, 'lesson count mismatch')
})

/* ── capacity / curriculum ────────────────────────────────────── */

test('lessonCapacity = lesson rows × teaching days', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] })
  assert(lessonCapacity(periods, DEFAULT_DAYS) === 30, 'expected 6×5 = 30')
})

test('curriculumSubjectsForGrade pulls the CBC upper-primary list for G5', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  assert(subjects.length === 8, `expected 8 CBC upper-primary subjects, got ${subjects.length}`)
  assert(subjects.every((s) => s.id && s.label && Number.isFinite(s.periodsPerWeek)),
    'each seeded subject needs id/label/periodsPerWeek')
  const maths = subjects.find((s) => /math/i.test(s.label))
  assert(maths && maths.periodsPerWeek === defaultPeriodsPerWeek(maths.label), 'maths default allocation mismatch')
})

/* ── round robin ──────────────────────────────────────────────── */

test('roundRobinTokens interleaves subjects and preserves counts', () => {
  const tokens = roundRobinTokens([
    { id: 'a', label: 'A', periodsPerWeek: 3 },
    { id: 'b', label: 'B', periodsPerWeek: 2 },
  ])
  assert(tokens.length === 5, `expected 5 tokens, got ${tokens.length}`)
  assert(tokens.map((t) => t.id).join('') === 'ababa', `bad interleave: ${tokens.map((t) => t.id).join('')}`)
})

/* ── auto-fill ────────────────────────────────────────────────── */

const SUBJECTS = [
  { id: 'm', label: 'Mathematics', periodsPerWeek: 5 },
  { id: 'e', label: 'English', periodsPerWeek: 5 },
  { id: 's', label: 'Science', periodsPerWeek: 4 },
  { id: 'o', label: 'Social Studies', periodsPerWeek: 3 },
]

test('autoFill places exactly the allocated number of lessons when under capacity', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] }) // 6×5 = 30 slots
  const slots = autoFillTimetable({ subjects: SUBJECTS, days: DEFAULT_DAYS, periods })
  assert(filledCount(slots, periods, DEFAULT_DAYS) === totalAllocated(SUBJECTS),
    `placed ${filledCount(slots, periods, DEFAULT_DAYS)} but allocated ${totalAllocated(SUBJECTS)}`)
})

test('autoFill never puts a subject twice in one day while capacity allows', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] })
  const slots = autoFillTimetable({ subjects: SUBJECTS, days: DEFAULT_DAYS, periods })
  for (const day of DEFAULT_DAYS) {
    const seen = new Set()
    for (const p of lessonPeriods(periods)) {
      const subj = slots?.[p.id]?.[day]
      if (!subj) continue
      assert(!seen.has(subj), `subject "${subj}" appears twice on ${day}`)
      seen.add(subj)
    }
  }
})

test('autoFill caps at grid capacity when over-allocated', () => {
  const periods = buildPeriods({ lessonPeriods: 2, breaks: [] }) // 2×5 = 10 slots
  const heavy = [{ id: 'x', label: 'X', periodsPerWeek: 40 }]
  const slots = autoFillTimetable({ subjects: heavy, days: DEFAULT_DAYS, periods })
  assert(filledCount(slots, periods, DEFAULT_DAYS) === 10, 'should fill exactly the 10 available slots')
})

/* ── artifact + xlsx ──────────────────────────────────────────── */

test('buildClassTimetableWorkbookFiles emits a valid single-sheet workbook', () => {
  const periods = buildPeriods({ lessonPeriods: 3, breaks: [{ afterPeriod: 2, minutes: 20, name: 'BREAK' }] })
  const slots = autoFillTimetable({ subjects: SUBJECTS, days: DEFAULT_DAYS, periods })
  const artifact = buildTimetableArtifact({
    header: { school: 'Demo Primary', grade: 'G5', className: 'Grade 5 Blue', term: 1, year: '2026' },
    days: DEFAULT_DAYS,
    periods,
    slots,
  })
  const files = buildClassTimetableWorkbookFiles(artifact)
  assert(files['[Content_Types].xml'], 'missing content types part')
  assert(files['xl/workbook.xml'].includes('Timetable'), 'sheet not named Timetable')
  const sheet = files['xl/worksheets/sheet1.xml']
  assert(sheet.includes('MONDAY') && sheet.includes('FRIDAY'), 'day headers missing')
  assert(sheet.includes('CLASS TIMETABLE'), 'title missing')
  assert(sheet.includes('<mergeCells'), 'expected merged title/break cells')
  assert(sheet.includes('Mathematics'), 'a placed subject should appear in the sheet')
})

/* ── 2023 framework allocations ───────────────────────────────── */

test('bandForGrade maps grades to the framework bands', () => {
  assert(bandForGrade('G2') === 'lower_primary', 'G2 should be lower primary')
  assert(bandForGrade('Grade 5') === 'upper_primary', 'Grade 5 should be upper primary')
  assert(bandForGrade('G9') === null, 'secondary grades have no framework band yet')
})

test('getFrameworkForGrade returns the official upper-primary allocation (42/wk)', () => {
  const fw = getFrameworkForGrade('G5')
  assert(fw, 'expected a framework for G5')
  assert(fw.periodMinutes === 40, `upper primary periods are 40 min, got ${fw.periodMinutes}`)
  assert(fw.totalPeriods === 42, `expected 42 periods/week, got ${fw.totalPeriods}`)
  const maths = fw.subjects.find((s) => s.label === 'Mathematics')
  assert(maths && maths.periodsPerWeek === 6, 'Mathematics should be 6 periods/week')
  const tech = fw.subjects.find((s) => s.label === 'Technology Studies')
  assert(tech && tech.periodsPerWeek === 7, 'Technology Studies should be 7 periods/week')
  // Expressive Arts OR Home Economics — the alternative is seeded at 0.
  const he = fw.subjects.find((s) => s.label === 'Home Economics')
  assert(he && he.periodsPerWeek === 0 && he.choiceGroup === 'practical', 'Home Economics is the seeded-0 choice alternative')
})

test('getFrameworkForGrade returns the lower-primary allocation (42/wk, 30-min)', () => {
  const fw = getFrameworkForGrade('G2')
  assert(fw && fw.periodMinutes === 30, 'lower primary periods are 30 min')
  assert(fw.totalPeriods === 42, `expected 42 periods/week, got ${fw.totalPeriods}`)
  assert(fw.subjects.length === 4, `expected 4 combined learning areas, got ${fw.subjects.length}`)
})

test('curriculumSubjectsForGrade seeds the framework period counts for primary', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  assert(totalAllocated(subjects) === 42, `seeded week should total 42, got ${totalAllocated(subjects)}`)
  assert(subjects.every((s) => s.load), 'every seeded subject carries a cognitive load')
})

test('subjectLoad classifies core academic subjects as heavy', () => {
  assert(subjectLoad('Mathematics') === 'heavy', 'Maths is heavy')
  assert(subjectLoad('Integrated Science') === 'heavy', 'Science is heavy')
  assert(subjectLoad('Expressive Arts') === 'light', 'Expressive Arts is light')
  assert(subjectLoad('Social Studies') === 'medium', 'Social Studies is medium')
})

test('recommendedLessonPeriods right-sizes the grid for the weekly load', () => {
  assert(recommendedLessonPeriods(42, DEFAULT_DAYS) === 9, '42 over 5 days → 9 periods/day')
  assert(recommendedLessonPeriods(42, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) === 7, '42 over 6 days → 7/day')
})

/* ── assembly / closing rows ──────────────────────────────────── */

test('buildPeriods emits assembly before Period 1 and closing after the last lesson', () => {
  const periods = buildPeriods({
    startTime: '07:30',
    periodMinutes: 40,
    lessonPeriods: 3,
    breaks: [
      { afterPeriod: 0, minutes: 15, name: 'ASSEMBLY', event: 'assembly' },
      { afterPeriod: 'end', minutes: 10, name: 'CLOSING', event: 'closing' },
    ],
  })
  assert(periods[0].event === 'assembly' && periods[0].start === '07:30', 'assembly should be the first row, at the start time')
  assert(periods[1].kind === 'lesson' && periods[1].start === '07:45', 'Period 1 starts after the 15-min assembly')
  const last = periods[periods.length - 1]
  assert(last.event === 'closing', 'closing should be the final row')
  assert(lessonPeriods(periods).length === 3, 'still three lesson rows')
})

/* ── fit-to-knock-off mode ────────────────────────────────────── */

test('fit mode fills the day exactly between report and knock-off times', () => {
  const periods = buildPeriods({
    fitToEndTime: true,
    startTime: '07:00',
    endTime: '13:00',
    lessonPeriods: 8,
    breaks: [],
  })
  const lessons = lessonPeriods(periods)
  assert(lessons.length === 8, `expected 8 lesson rows, got ${lessons.length}`)
  assert(lessons[0].start === '07:00', `first lesson should start at report time: ${lessons[0].start}`)
  assert(dayEndTime(periods) === '13:00', `day should end at the knock-off time: ${dayEndTime(periods)}`)
  // 6 hours / 8 periods = 45-minute periods, every cell contiguous.
  assert(lessons[0].end === '07:45' && lessons[1].start === '07:45', `periods should be contiguous 45-min: ${lessons[0].end}/${lessons[1].start}`)
})

test('fit mode drops each break in at the exact clock time the teacher set', () => {
  const periods = buildPeriods({
    fitToEndTime: true,
    startTime: '07:00',
    endTime: '13:00',
    lessonPeriods: 6,
    breaks: [
      { event: 'break', name: 'BREAK', time: '09:00', minutes: 20 },
      { event: 'lunch', name: 'LUNCH', time: '11:00', minutes: 40 },
    ],
  })
  const brk = periods.find((p) => p.event === 'break')
  const lunch = periods.find((p) => p.event === 'lunch')
  assert(brk && brk.start === '09:00' && brk.end === '09:20', `break should be 09:00–09:20: ${brk?.start}–${brk?.end}`)
  assert(lunch && lunch.start === '11:00' && lunch.end === '11:40', `lunch should be 11:00–11:40: ${lunch?.start}–${lunch?.end}`)
  assert(lessonPeriods(periods).length === 6, 'should still place all 6 lesson periods')
  assert(dayEndTime(periods) === '13:00', `day should still knock off at 13:00: ${dayEndTime(periods)}`)
})

test('fit mode honours a break-only day (lunch unticked) — government school case', () => {
  const periods = buildPeriods({
    fitToEndTime: true,
    startTime: '07:30',
    endTime: '12:30',
    lessonPeriods: 7,
    breaks: [
      { event: 'break', name: 'BREAK', time: '10:00', minutes: 30, enabled: true },
      { event: 'lunch', name: 'LUNCH', time: '12:00', minutes: 40, enabled: false },
    ],
  })
  assert(periods.some((p) => p.event === 'break'), 'the break should appear')
  assert(!periods.some((p) => p.event === 'lunch'), 'the disabled lunch should be gone')
  assert(lessonPeriods(periods).length === 7, 'all 7 lesson periods placed')
  assert(dayEndTime(periods) === '12:30', `day should knock off at 12:30: ${dayEndTime(periods)}`)
})

test('fit mode keeps assembly and closing as bookends around the knock-off', () => {
  const periods = buildPeriods({
    fitToEndTime: true,
    startTime: '07:00',
    endTime: '13:00',
    lessonPeriods: 5,
    breaks: [
      { event: 'assembly', name: 'ASSEMBLY', minutes: 15 },
      { event: 'closing', name: 'CLOSING', minutes: 10 },
    ],
  })
  assert(periods[0].event === 'assembly' && periods[0].start === '07:00' && periods[0].end === '07:15',
    `assembly should fill 07:00–07:15: ${periods[0].start}–${periods[0].end}`)
  assert(lessonPeriods(periods)[0].start === '07:15', 'first lesson follows assembly')
  assert(lastLessonEndTime(periods) === '13:00', `last lesson should end at the 13:00 knock-off: ${lastLessonEndTime(periods)}`)
  const last = periods[periods.length - 1]
  assert(last.event === 'closing' && last.start === '13:00' && last.end === '13:10',
    `closing should trail the knock-off 13:00–13:10: ${last.start}–${last.end}`)
})

test('fit mode falls back to the fixed builder when the window is degenerate', () => {
  const periods = buildPeriods({
    fitToEndTime: true,
    startTime: '13:00',
    endTime: '07:00', // knock-off before report — impossible
    periodMinutes: 40,
    lessonPeriods: 3,
    breaks: [],
  })
  // Falls back to the fixed forward build from the start time.
  assert(lessonPeriods(periods).length === 3, 'fixed fallback still produces the lesson rows')
  assert(lessonPeriods(periods)[0].start === '13:00', 'fixed fallback starts at the report time')
})

/* ── balanced distribution ────────────────────────────────────── */

test('autoFill spreads heavy subjects so no day is overloaded', () => {
  const periods = buildPeriods({ lessonPeriods: 9, breaks: [] }) // 9×5 = 45 slots
  const subjects = curriculumSubjectsForGrade('G5')               // 42 framework periods
  const slots = autoFillTimetable({ subjects, days: DEFAULT_DAYS, periods })
  // Count heavy lessons per day; the spread should keep them within the limit.
  for (const day of DEFAULT_DAYS) {
    let heavy = 0
    for (const p of lessonPeriods(periods)) {
      const subj = slots?.[p.id]?.[day]
      if (subj && subjectLoad(subj) === 'heavy') heavy += 1
    }
    assert(heavy <= 4, `${day} carries ${heavy} heavy subjects — should be ≤ 4`)
  }
})

/* ── validation ───────────────────────────────────────────────── */

test('validateTimetable flags a missing subject and counts placements', () => {
  const periods = buildPeriods({ lessonPeriods: 6, breaks: [] })
  const subjects = [
    { id: 'm', label: 'Mathematics', periodsPerWeek: 5, load: 'heavy' },
    { id: 'e', label: 'English', periodsPerWeek: 5, load: 'heavy' },
  ]
  // Place only Mathematics, leave English empty.
  const slots = autoFillTimetable({ subjects: [subjects[0]], days: DEFAULT_DAYS, periods })
  const report = validateTimetable({ slots, subjects, periods, days: DEFAULT_DAYS })
  assert(!report.ok, 'report should not be ok when English is missing')
  assert(report.errors.some((m) => /English/.test(m)), 'English should be flagged missing')
  const maths = report.bySubject.find((r) => r.label === 'Mathematics')
  assert(maths && maths.placed === 5 && maths.status === 'ok', 'Mathematics should be fully placed')
})

test('validateTimetable passes a correctly-allocated week', () => {
  const periods = buildPeriods({ lessonPeriods: 9, breaks: [] })
  const subjects = curriculumSubjectsForGrade('G5')
  const slots = autoFillTimetable({ subjects, days: DEFAULT_DAYS, periods })
  const report = validateTimetable({ slots, subjects, periods, days: DEFAULT_DAYS })
  assert(report.totalPlaced === 42, `expected all 42 framework periods placed, got ${report.totalPlaced}`)
  assert(report.errors.length === 0, `expected no errors, got: ${report.errors.join('; ')}`)
})

/* ══ Central curriculum configuration ═════════════════════════ */

test('ECE totals 30 periods of 30 minutes (15 hours)', () => {
  const fw = resolveTimetableCurriculum({ grade: 'ECE_N' })
  assert(fw && fw.level === 'ece', 'ECE_N resolves to the ECE band')
  assert(fw.periodMinutes === 30 && fw.totalPeriods === 30, `30×30min expected, got ${fw.totalPeriods}×${fw.periodMinutes}`)
  assert(fw.weeklyContactMinutes === 900, '15 hours contact time')
  // One language provision only — the alternatives sit at 0.
  const langs = fw.subjects.filter((s) => s.optionGroupId === 'ece-language')
  assert(langs.length === 3, 'three alternative language provisions')
  assert(langs.filter((s) => s.periodsPerWeek > 0).length === 1, 'exactly one provision selected')
  const active = fw.subjects.filter((s) => s.periodsPerWeek > 0)
  assert(active.reduce((n, s) => n + s.periodsPerWeek, 0) === 30, 'selected subjects sum to 30')
})

test('Lower Primary (G1–3) is 42 × 30-min periods with the two integrated learning areas', () => {
  for (const g of ['G1', 'G2', 'G3']) {
    const fw = resolveTimetableCurriculum({ grade: g })
    assert(fw && fw.level === 'lower_primary', `${g} is lower primary`)
    assert(fw.periodMinutes === 30 && fw.totalPeriods === 42, `${g}: 42×30min`)
  }
  const fw = resolveTimetableCurriculum({ grade: 'G2' })
  const maths = fw.subjects.find((s) => s.label === 'Mathematics and Science')
  assert(maths && maths.periodsPerWeek === 10, 'Mathematics and Science is ONE integrated area at 10 periods')
  assert(!fw.subjects.some((s) => s.label === 'Mathematics'), 'no separate Mathematics in Lower Primary')
  assert(!fw.subjects.some((s) => s.label === 'Science'), 'no separate Science in Lower Primary')
  const cts = fw.subjects.find((s) => s.label === 'Creative and Technology Studies')
  assert(cts && cts.periodsPerWeek === 10, 'Creative and Technology Studies is ONE integrated area at 10')
  const english = fw.subjects.find((s) => /English/.test(s.label))
  assert(english && english.periodsPerWeek === 11, 'English literacy strand gets 11 periods')
})

test('Upper Primary covers Grades 4–6 with 42 × 40-min periods and canonical "Science"', () => {
  for (const g of ['G4', 'G5', 'G6']) {
    const fw = resolveTimetableCurriculum({ grade: g })
    assert(fw && fw.level === 'upper_primary', `${g} is upper primary`)
    assert(fw.periodMinutes === 40 && fw.totalPeriods === 42, `${g}: 42×40min`)
  }
  const fw = resolveTimetableCurriculum({ grade: 'G5' })
  const sci = fw.subjects.find((s) => s.label === 'Science')
  assert(sci && sci.periodsPerWeek === 6, 'canonical subject name is Science (6/wk)')
  assert(!fw.subjects.some((s) => s.label === 'Integrated Science'), 'not renamed to Integrated Science')
  assert(!fw.subjects.some((s) => s.label === 'Agricultural Science'), 'Agricultural Science is not an extra subject')
  assert(fw.bandLabel.includes('4–6'), `band label says Grades 4–6: ${fw.bandLabel}`)
})

test('Grade 7 does NOT inherit the Grades 4–6 allocation', () => {
  assert(bandForGrade('G7') === null, 'G7 has no framework band')
  assert(getFrameworkForGrade('G7') === null, 'no automatic allocation for G7')
  // The studio falls back to a manual list with heuristic counts.
  const subjects = curriculumSubjectsForGrade('G7')
  assert(Array.isArray(subjects), 'G7 still gets a subject list to edit')
})

test('Expressive Arts / Home Economics is a strict choose-one group', () => {
  const ea = resolveTimetableCurriculum({ grade: 'G5', selectedOptions: { practical: 'expressive-arts' } })
  const he = resolveTimetableCurriculum({ grade: 'G5', selectedOptions: { practical: 'home-economics' } })
  const get = (fw, label) => fw.subjects.find((s) => s.label === label)
  assert(get(ea, 'Expressive Arts').periodsPerWeek === 7 && get(ea, 'Home Economics').periodsPerWeek === 0,
    'EA selected → EA 7, HE 0')
  assert(get(he, 'Home Economics').periodsPerWeek === 7 && get(he, 'Expressive Arts').periodsPerWeek === 0,
    'HE selected → HE 7, EA 0')
  for (const fw of [ea, he]) {
    const total = fw.subjects.reduce((n, s) => n + s.periodsPerWeek, 0)
    assert(total === 42, `weekly total stays 42 whichever option is chosen, got ${total}`)
  }
})

test('the adapted curriculum baseline is 22 periods / 14 h 40 min with a language choice', () => {
  const fw = resolveTimetableCurriculum({ curriculumId: 'adapted-2023', grade: 'G5' })
  assert(fw && fw.level === 'adapted', 'adapted band resolves for any grade')
  assert(fw.totalPeriods === 22 && fw.weeklyContactMinutes === 880, `22 periods / 880 min, got ${fw.totalPeriods}/${fw.weeklyContactMinutes}`)
  const active = fw.subjects.filter((s) => s.periodsPerWeek > 0)
  assert(active.reduce((n, s) => n + s.periodsPerWeek, 0) === 22, 'selected subjects sum to 22')
  const cts = active.find((s) => s.label === 'Creative and Technology Studies')
  assert(cts && cts.periodsPerWeek === 10, 'CTS carries 10 periods (6 h 40 min)')
  const langGroup = fw.optionGroups.find((g) => g.id === 'adapted-language')
  assert(langGroup && langGroup.options.length === 2, 'English Language OR Sign Language')
})

test('OBC primary (Grades 1–7) resolves its official 2013 allocation', () => {
  assert(CURRICULA.some((c) => c.id === 'obc-2013'), '2013 OBC is offered')
  // Upper Primary (Grades 5–7): Table 5 — 42/wk · 40-min periods · 28 h.
  const up = resolveTimetableCurriculum({ curriculumId: 'obc-2013', grade: 'G7' })
  assert(up && up.band === 'obc_upper_primary', 'G7 is OBC Upper Primary (unlike CBC, where G7 has no table)')
  assert(up.totalPeriods === 42 && up.periodMinutes === 40 && up.weeklyContactMinutes === 1680,
    `OBC upper primary = 42/wk · 40-min · 28 h, got ${up.totalPeriods}/${up.periodMinutes}/${up.weeklyContactMinutes}`)
  assert(up.subjects.reduce((n, s) => n + s.periodsPerWeek, 0) === 42, 'upper-primary areas sum to 42')
  const sci = up.subjects.find((s) => s.label === 'Integrated Science')
  assert(sci && sci.periodsPerWeek === 6, 'Integrated Science = 6 periods/week under OBC Grade 7')
  // Lower Primary (Grades 1–4): Table 4 — 42/wk · 30-min periods · 21 h.
  const lp = resolveTimetableCurriculum({ curriculumId: 'obc-2013', grade: 'G2' })
  assert(lp && lp.band === 'obc_lower_primary', 'G2 is OBC Lower Primary')
  assert(lp.totalPeriods === 42 && lp.periodMinutes === 30 && lp.weeklyContactMinutes === 1260,
    `OBC lower primary = 42/wk · 30-min · 21 h, got ${lp.totalPeriods}/${lp.periodMinutes}/${lp.weeklyContactMinutes}`)
  assert(lp.subjects.reduce((n, s) => n + s.periodsPerWeek, 0) === 42, 'lower-primary areas sum to 42')
})

test('curricula without a catalogued table fall back to the manual path', () => {
  // OBC secondary (Grades 8–12) is not catalogued → manual subject list.
  assert(resolveTimetableCurriculum({ curriculumId: 'obc-2013', grade: 'G9' }) === null,
    'OBC secondary has no prescribed table → manual subject list')
  assert(resolveTimetableCurriculum({ curriculumId: 'custom', grade: 'G5' }) === null,
    'custom school curriculum is fully manual')
})

/* ══ Day structure (Mode A) + school-day templates ═════════════ */

test('distributePeriodsPerDay spreads 42 over 5 days as 9/9/8/8/8', () => {
  const counts = distributePeriodsPerDay(42, DEFAULT_DAYS)
  assert(JSON.stringify(Object.values(counts)) === JSON.stringify([9, 9, 8, 8, 8]),
    `bad spread: ${JSON.stringify(counts)}`)
  const periods = buildPeriods({ lessonPeriods: 9, breaks: [] })
  const structure = { periodsPerDay: counts }
  assert(slotCountForDay('Wednesday', periods, structure) === 8, 'Wednesday holds 8 lesson slots')
  assert(weeklyCapacity(periods, DEFAULT_DAYS, structure) === 42, 'weekly capacity is exactly 42')
})

test('school-day templates cover government, full-day, shift and custom days', () => {
  const ids = SCHOOL_DAY_TEMPLATES.map((t) => t.id)
  for (const wanted of ['full-day-break-lunch', 'full-day-break-only', 'government-break-only', 'morning-shift', 'afternoon-shift', 'double-session', 'custom']) {
    assert(ids.includes(wanted), `missing template ${wanted}`)
  }
  const gov = SCHOOL_DAY_TEMPLATES.find((t) => t.id === 'government-break-only')
  assert(gov.timing.breaks.find((b) => b.event === 'lunch').enabled === false, 'government day has no lunch')
})

test('every school-day template is tagged full, half or custom; a half-day template exists', () => {
  for (const t of SCHOOL_DAY_TEMPLATES) {
    assert(DAY_TYPES.some((d) => d.id === t.dayType), `${t.id} carries an unknown dayType ${t.dayType}`)
  }
  assert(templatesForDayType('full').length >= 5, 'several full-day templates exist')
  assert(templatesForDayType('half').length >= 1, 'at least one half-day template exists')
  assert(templatesForDayType('custom').length === 1, 'exactly one custom template')
  assert(dayTypeLabel('half') === 'Half day', 'half day label')
})

/* ══ Day-specific school structures (independent per-day timing) ══ */

test('a day with its own school-day structure ignores the base timing entirely', () => {
  const base = buildPeriods({ startTime: '07:30', periodMinutes: 40, lessonPeriods: 9, breaks: [] })
  const fridayHalf = withDaySchedule(null, 'Friday', {
    dayType: 'half', templateId: 'half-day',
    timing: { startTime: '07:30', endTime: '12:30', fitToEndTime: true, lessonPeriods: 6, breaks: [] },
  })
  assert(dayScheduleOverride('Friday', fridayHalf)?.dayType === 'half', 'Friday carries its own override')
  assert(dayScheduleOverride('Monday', fridayHalf) === null, 'Monday has no override — inherits the base')

  assert(slotCountForDay('Monday', base, fridayHalf) === 9, 'Monday keeps the base 9 lessons')
  assert(slotCountForDay('Friday', base, fridayHalf) === 6, 'Friday holds its own 6 lessons')

  const fridayPeriods = periodsForDay('Friday', base, fridayHalf)
  assert(lastLessonEndTime(fridayPeriods) === '12:30', 'Friday knocks off exactly at 12:30')
  assert(knockOffTimeForDay('Friday', base, fridayHalf) === '12:30', 'knockOffTimeForDay agrees')
  assert(knockOffTimeForDay('Monday', base, fridayHalf) === lastLessonEndTime(base), 'Monday keeps the base knock-off')
  assert(reportingTimeForDay('Friday', base, fridayHalf) === '07:30', 'Friday still reports at 07:30')
})

test('withDaySchedule clears an override back to the base timing', () => {
  const withFriday = withDaySchedule(null, 'Friday', { dayType: 'half', timing: { startTime: '07:30', endTime: '12:30', fitToEndTime: true, lessonPeriods: 6, breaks: [] } })
  const cleared = withDaySchedule(withFriday, 'Friday', null)
  assert(dayScheduleOverride('Friday', cleared) === null, 'clearing removes the override')
})

test('resolveCapacityFit blocks generation when the weekly curriculum cannot fit per-day capacity', () => {
  const subjects = curriculumSubjectsForGrade('G5', 'cbc-2023', { practical: 'home-economics' })
  const base = buildPeriods({ startTime: '07:30', periodMinutes: 40, lessonPeriods: 9, breaks: [] })
  const roomy = resolveCapacityFit({ subjects, days: DEFAULT_DAYS, periods: base, dayStructure: null })
  assert(roomy.fits, `42 periods should fit a 45-slot week: ${JSON.stringify(roomy)}`)
  assert(roomy.required === 42 && roomy.capacity === 45, `required/capacity: ${JSON.stringify(roomy)}`)

  // Shrink Friday to a 2-lesson half day — the 42-period week no longer fits.
  const tightFriday = withDaySchedule(null, 'Friday', {
    dayType: 'half', timing: { startTime: '07:30', endTime: '09:00', fitToEndTime: true, lessonPeriods: 2, breaks: [] },
  })
  const tight = resolveCapacityFit({ subjects, days: DEFAULT_DAYS, periods: base, dayStructure: tightFriday })
  assert(!tight.fits, 'a shrunk Friday must fail the capacity check rather than silently truncate')
  assert(tight.shortfall === tight.required - tight.capacity && tight.shortfall > 0, `shortfall reported: ${JSON.stringify(tight)}`)
  assert(tight.perDay.Friday === 2, 'per-day capacity reports Friday at 2')
})

test('autoFillBlocks never schedules a lesson after a half day\'s own knock-off, and redistributes across the week', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  const base = buildPeriods({
    startTime: '07:30', periodMinutes: 40, lessonPeriods: 9,
    breaks: [
      { afterPeriod: 3, minutes: 20, name: 'BREAK', event: 'break' },
      { afterPeriod: 6, minutes: 40, name: 'LUNCH', event: 'lunch' },
    ],
  })
  // Friday becomes a half day (own knock-off well before the base week's).
  const fridayHalf = withDaySchedule(null, 'Friday', {
    dayType: 'half', templateId: 'half-day',
    timing: { startTime: '07:30', endTime: '10:30', fitToEndTime: true, lessonPeriods: 4, breaks: [] },
  })
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: base, dayStructure: fridayHalf })
  const fridayBlocks = blocks.filter((b) => b.day === 'Friday')
  const fridayCap = slotCountForDay('Friday', base, fridayHalf)
  for (const b of fridayBlocks) {
    assert(b.startSlot + b.length - 1 <= fridayCap, `${b.label} on Friday spills past the half day's own ${fridayCap} lessons`)
  }
  // Other days pick up the periods Friday's shorter week can no longer hold.
  const mondayCount = blocks.filter((b) => b.day === 'Monday' && b.type === BLOCK_TYPES.CURRICULUM).length
  assert(mondayCount >= 1, 'Monday absorbs some of the redistributed load')
})

/* ══ School Calendar date-specific overrides ═══════════════════ */

test('weekdayNameForDate resolves a YYYY-MM-DD date to its weekday', () => {
  assert(weekdayNameForDate('2026-07-17') === 'Friday', '17 Jul 2026 is a Friday')
  assert(weekdayNameForDate('not-a-date') === null, 'bad input resolves to null')
})

test('a calendar override applies to its exact date only, never the recurring weekly pattern', () => {
  const base = buildPeriods({ startTime: '07:30', periodMinutes: 40, lessonPeriods: 9, breaks: [] })
  // Friday is a normal full day every week — no weekly override.
  const dayStructure = null
  let overrides = withCalendarOverride([], {
    date: '2026-07-17', dayType: 'half', reason: 'Staff meeting',
    timing: { startTime: '07:30', endTime: '12:00', fitToEndTime: true, lessonPeriods: 5, breaks: [] },
  })
  assert(calendarOverrideForDate(overrides, '2026-07-17')?.reason === 'Staff meeting', 'override recorded for the exact date')

  const onThatFriday = effectiveDayScheduleForDate({
    date: '2026-07-17', periods: base, dayStructure, calendarOverrides: overrides,
  })
  assert(onThatFriday.source === 'calendar-override', 'the specific date resolves to the calendar override')
  assert(lastLessonEndTime(onThatFriday.periods) === '12:00', 'that Friday knocks off at noon')

  // A different Friday (no override recorded) is unaffected — still a full day.
  const otherFriday = effectiveDayScheduleForDate({
    date: '2026-07-24', periods: base, dayStructure, calendarOverrides: overrides,
  })
  assert(otherFriday.source === 'base', 'every other Friday stays the normal saved structure')
  assert(lastLessonEndTime(otherFriday.periods) === lastLessonEndTime(base), 'unaffected Friday keeps the base knock-off')

  overrides = removeCalendarOverride(overrides, '2026-07-17')
  assert(calendarOverrideForDate(overrides, '2026-07-17') === null, 'removing the override clears it')
})

test('effectiveDayScheduleForDate prefers a calendar override over the recurring weekly half day', () => {
  const base = buildPeriods({ startTime: '07:30', periodMinutes: 40, lessonPeriods: 9, breaks: [] })
  // Friday is NORMALLY a half day (recurring, saved in the weekly structure).
  const dayStructure = withDaySchedule(null, 'Friday', {
    dayType: 'half', timing: { startTime: '07:30', endTime: '12:30', fitToEndTime: true, lessonPeriods: 6, breaks: [] },
  })
  // This one Friday there's an even shorter, occasional half day.
  const overrides = withCalendarOverride([], {
    date: '2026-07-17', dayType: 'half', reason: 'Sports day',
    timing: { startTime: '07:30', endTime: '10:00', fitToEndTime: true, lessonPeriods: 3, breaks: [] },
  })
  const resolved = effectiveDayScheduleForDate({ date: '2026-07-17', periods: base, dayStructure, calendarOverrides: overrides })
  assert(resolved.source === 'calendar-override', 'the one-off override wins over the recurring weekly half day')
  assert(lastLessonEndTime(resolved.periods) === '10:00', 'the occasional override time applies')

  // The recurring weekly structure itself must be untouched by the override.
  assert(dayScheduleOverride('Friday', dayStructure)?.timing?.endTime === '12:30',
    'the saved weekly Friday half-day structure is not mutated by a calendar override')
})

/* ══ Block-aware auto-fill ═════════════════════════════════════ */

const G5_PERIODS = buildPeriods({
  startTime: '07:30', periodMinutes: 40, lessonPeriods: 9,
  breaks: [
    { afterPeriod: 3, minutes: 20, name: 'BREAK', event: 'break' },
    { afterPeriod: 6, minutes: 40, name: 'LUNCH', event: 'lunch' },
  ],
})

test('autoFillBlocks places every official period — nothing missing, nothing over', () => {
  const subjects = curriculumSubjectsForGrade('G5', 'cbc-2023', { practical: 'home-economics' })
  const { blocks, unplaced } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: G5_PERIODS })
  assert(unplaced.length === 0, `nothing should be unplaced: ${JSON.stringify(unplaced)}`)
  const placed = new Map()
  for (const b of blocks.filter((x) => x.type === BLOCK_TYPES.CURRICULUM)) {
    placed.set(b.label, (placed.get(b.label) || 0) + b.length)
  }
  for (const s of subjects) {
    assert((placed.get(s.label) || 0) === s.periodsPerWeek,
      `${s.label}: placed ${placed.get(s.label) || 0}, wanted ${s.periodsPerWeek}`)
  }
  assert(!placed.has('Expressive Arts'), 'the unselected option never appears in auto-fill')
})

test('autoFillBlocks produces preferred double periods inside one segment', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: G5_PERIODS })
  const segments = segmentsOf(G5_PERIODS)
  const doubles = blocks.filter((b) => b.length === 2)
  assert(doubles.length >= 3, `practical subjects should earn doubles, got ${doubles.length}`)
  for (const d of doubles) {
    assert(fitsInOneSegment(segments, d.startSlot, d.length), `double ${d.label} must not cross a break`)
  }
  assert(doubles.some((d) => d.label === 'Technology Studies'), 'Technology Studies prefers doubles')
})

test('autoFillBlocks keeps locked blocks exactly where they are', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  const locked = makeBlock({ day: 'Friday', startSlot: 1, length: 2, label: 'Technology Studies', locked: true })
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: G5_PERIODS, lockedBlocks: [locked] })
  const kept = blocks.find((b) => b.day === 'Friday' && b.startSlot === 1)
  assert(kept && kept.label === 'Technology Studies' && kept.length === 2 && kept.locked,
    'the locked double survives auto-fill untouched')
  const total = blocks.filter((b) => b.type === BLOCK_TYPES.CURRICULUM && b.label === 'Technology Studies')
    .reduce((n, b) => n + b.length, 0)
  assert(total === 7, `locked periods count toward the allocation: ${total}`)
})

test('autoFillBlocks honours per-day lesson counts (exact 42-period week)', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  const structure = { periodsPerDay: distributePeriodsPerDay(42, DEFAULT_DAYS) }
  const { blocks, unplaced } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: G5_PERIODS, dayStructure: structure })
  assert(unplaced.length === 0, 'the 42-period week fits exactly')
  for (const b of blocks) {
    const cap = structure.periodsPerDay[b.day]
    assert(b.startSlot + b.length - 1 <= cap, `${b.label} on ${b.day} exceeds that day's ${cap} lessons`)
  }
  const total = blocks.reduce((n, b) => n + b.length, 0)
  assert(total === 42, `exactly 42 periods placed, got ${total}`)
})

test('autoFillBlocks fills the 3 spare slots of a 45-slot week with school activities (Mode B)', () => {
  const subjects = curriculumSubjectsForGrade('G5')
  const { blocks } = autoFillBlocks({
    subjects, days: DEFAULT_DAYS, periods: G5_PERIODS,
    activities: ['Remedial work', 'Library', 'Clubs'],
  })
  const acts = blocks.filter((b) => b.type === BLOCK_TYPES.ACTIVITY)
  assert(acts.reduce((n, b) => n + b.length, 0) === 3, `45 − 42 = 3 activity slots, got ${acts.length}`)
  const total = blocks.reduce((n, b) => n + b.length, 0)
  assert(total === 45, 'every slot is used — no unexplained dashes')
})

test('autoFillBlocks reports what cannot fit instead of failing silently', () => {
  const tiny = buildPeriods({ lessonPeriods: 2, breaks: [] }) // 10 slots
  const subjects = curriculumSubjectsForGrade('G5')          // needs 42
  const { unplaced } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: tiny })
  assert(unplaced.length > 0, 'over-allocation must be reported')
  assert(unplaced.every((u) => u.label && u.missing > 0 && u.reason), 'each report says what, how many and why')
})

/* ══ Detailed validation ═══════════════════════════════════════ */

test('validateTimetableBlocks passes a complete G5 week and reports exact counts', () => {
  const curriculum = resolveTimetableCurriculum({ grade: 'G5' })
  const subjects = curriculumSubjectsForGrade('G5')
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: G5_PERIODS, activities: ['Clubs'] })
  const v = validateTimetableBlocks({ blocks, subjects, periods: G5_PERIODS, days: DEFAULT_DAYS, curriculum })
  assert(v.status === 'passed', `expected passed, got ${v.status}: ${[...v.errors, ...v.warnings].join(' | ')}`)
  assert(!v.customised, 'an untouched official week is not customised')
  assert(v.summary.curriculumPeriods === 42 && v.summary.requiredPeriods === 42, 'exact period counts reported')
  assert(v.summary.contactMinutes === 42 * 40, 'contact time computed from curriculum periods only')
  assert(v.summary.activityPeriods === 3, 'activity slots counted separately')
  const eng = v.bySubject.find((r) => r.label === 'English Language')
  assert(eng && eng.placed === 6 && eng.target === 6, 'per-subject counts are exact')
})

test('validateTimetableBlocks fails a short week and flags a stray unselected option', () => {
  const curriculum = resolveTimetableCurriculum({ grade: 'G5' }) // EA selected by default
  const subjects = curriculumSubjectsForGrade('G5')
  const blocks = [
    makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Mathematics' }),
    makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'Home Economics' }), // not the selected option
  ]
  const v = validateTimetableBlocks({ blocks, subjects, periods: G5_PERIODS, days: DEFAULT_DAYS, curriculum })
  assert(v.status === 'failed', 'a short week fails, not warns')
  assert(v.errors.some((e) => /Home Economics.*not the selected option/.test(e)),
    `stray option flagged: ${v.errors.join(' | ')}`)
  assert(v.errors.some((e) => /English Language/.test(e)), 'missing subjects are named')
})

test('validateTimetableBlocks marks changed allocations as customised and finds mid-day gaps', () => {
  const curriculum = resolveTimetableCurriculum({ grade: 'G5' })
  const subjects = curriculumSubjectsForGrade('G5').map((s) =>
    s.label === 'Mathematics' ? { ...s, periodsPerWeek: 8 } : s)
  const blocks = [
    makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'Mathematics' }),
    makeBlock({ day: 'Monday', startSlot: 3, length: 1, label: 'Science' }), // slot 2 is an unexplained gap
  ]
  const v = validateTimetableBlocks({ blocks, subjects, periods: G5_PERIODS, days: DEFAULT_DAYS, curriculum })
  assert(v.customised, 'edited allocations are marked customised from the curriculum baseline')
  assert(v.warnings.some((w) => /unexplained empty period/.test(w)), 'the mid-day gap is called out')
})

test('validation notes distinguish joinable neighbours from separated repeats', () => {
  const curriculum = resolveTimetableCurriculum({ grade: 'G5' })
  const subjects = curriculumSubjectsForGrade('G5')
  const blocks = [
    makeBlock({ day: 'Monday', startSlot: 1, length: 1, label: 'English Language' }),
    makeBlock({ day: 'Monday', startSlot: 2, length: 1, label: 'English Language' }), // adjacent → joinable
    makeBlock({ day: 'Tuesday', startSlot: 1, length: 1, label: 'Mathematics' }),
    makeBlock({ day: 'Tuesday', startSlot: 2, length: 1, label: 'Science' }),
    makeBlock({ day: 'Tuesday', startSlot: 3, length: 1, label: 'Mathematics' }),      // separated → two singles
  ]
  const v = validateTimetableBlocks({ blocks, subjects, periods: G5_PERIODS, days: DEFAULT_DAYS, curriculum })
  assert(v.notes.some((n) => /English Language.*join them into a double/.test(n)), 'join suggestion offered')
  assert(v.notes.some((n) => /Mathematics.*not consecutive.*not a double/i.test(n) || /Mathematics appears more than once/.test(n)),
    `separated repeats explicitly called two singles: ${v.notes.join(' | ')}`)
})

/* ══ Layouts + grid model ══════════════════════════════════════ */

function sampleArtifact(layout) {
  const subjects = curriculumSubjectsForGrade('G5')
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: G5_PERIODS, activities: ['Clubs'] })
  return buildTimetableArtifact({
    header: { school: 'Demo Primary', grade: 'G5', className: '5B', term: 1, year: '2026', teacherName: 'Ms Zulu' },
    days: DEFAULT_DAYS,
    periods: G5_PERIODS,
    blocks,
    // `layout` seeds BOTH the on-screen and the print orientation so the
    // existing assertions keep addressing one grid. Print orientation is a
    // separate preference now (it defaults to days-left, per the Ministry
    // format) — see the dedicated test below.
    displayPreferences: layout ? { timetableLayout: layout, printLayout: layout } : null,
    curriculumId: 'cbc-2023',
    selectedOptions: { practical: 'expressive-arts' },
    subjectAllocations: subjects,
  })
}

test('switching layouts never changes the schedule content', () => {
  const artifact = sampleArtifact()
  const cols = buildTimetableGridModel(artifact, { layout: 'days-as-columns' })
  const rows = buildTimetableGridModel(artifact, { layout: 'days-as-rows' })
  for (const day of DEFAULT_DAYS) {
    for (let s = 1; s <= cols.maxSlot; s += 1) {
      const a = cellState(cols, day, s)
      const b = cellState(rows, day, s)
      assert((a.block?.label || null) === (b.block?.label || null),
        `cell ${day}/${s} differs between layouts`)
      assert((a.block?.length || 0) === (b.block?.length || 0), 'double periods stay intact across layouts')
    }
  }
})

test('the grid model marks doubles for vertical/horizontal merging and keeps breaks in both layouts', () => {
  const artifact = sampleArtifact()
  const model = buildTimetableGridModel(artifact)
  const dbl = artifact.blocks.find((b) => b.length === 2)
  assert(dbl, 'the sample week contains a double period')
  const start = cellState(model, dbl.day, dbl.startSlot)
  const covered = cellState(model, dbl.day, dbl.startSlot + 1)
  assert(start.state === 'start' && covered.state === 'covered', 'start + covered states drive the merge')
  assert(model.rows.some((r) => r.kind === 'break' && r.label === 'BREAK'), 'break rows survive')
  assert(model.rows.some((r) => r.kind === 'break' && r.label === 'LUNCH'), 'lunch rows survive')
})

test('artifacts default to "Days across the top" and persist the chosen layout', () => {
  const def = sampleArtifact()
  assert(def.displayPreferences.timetableLayout === 'days-as-columns', 'default layout')
  const rowsFirst = sampleArtifact('days-as-rows')
  assert(buildTimetableGridModel(rowsFirst).layout === 'days-as-rows', 'saved preference wins')
})

test('the grid model exposes each day\'s OWN rows when it has its own school-day structure', () => {
  const fridayHalf = withDaySchedule(null, 'Friday', {
    dayType: 'half',
    timing: { startTime: '07:30', endTime: '10:30', fitToEndTime: true, lessonPeriods: 4, breaks: [] },
  })
  const half = buildTimetableArtifact({
    header: { school: 'Demo Primary', grade: 'G5' },
    days: DEFAULT_DAYS,
    periods: G5_PERIODS,
    blocks: [],
    dayStructure: fridayHalf,
  })
  const model = buildTimetableGridModel(half)

  // Monday (no override) keeps the base week's slot count; Friday holds its own.
  assert(model.slotCount.Monday === lessonPeriods(G5_PERIODS).length, 'Monday keeps the base lesson count')
  assert(model.slotCount.Friday === 4, 'Friday holds only its own 4 lessons')

  // Slot 5+ on Friday is now "off" — the day ended.
  const offCell = cellState(model, 'Friday', 5)
  assert(offCell.state === 'off', 'Friday has nothing beyond its own 4 lessons')

  // Friday's own row 4 knocks off at 10:30 — its own clock time, independent
  // of whatever the shared reference row list shows for slot 4.
  const fridayRow4 = dayRowForSlot(model, 'Friday', 4)
  assert(fridayRow4?.end === '10:30', `Friday's own last lesson ends at 10:30, got ${fridayRow4?.end}`)
})

/* ══ Migration (legacy v1 artifacts) ═══════════════════════════ */

test('a legacy v1 artifact loads: cells become singles, layout defaults, nothing is lost', () => {
  const legacy = {
    schemaVersion: 'class-timetable-1.0',
    header: { grade: 'G5', school: 'Old School' },
    days: DEFAULT_DAYS,
    periods: G5_PERIODS,
    slots: {
      p1: { Monday: 'English Language', Tuesday: 'Mathematics' },
      p2: { Monday: 'English Language' },  // adjacent repeat — may be suggested, never auto-joined
      p4: { Monday: 'English Language' },  // separated repeat — stays a single
    },
  }
  const norm = normalizeTimetableArtifact(legacy)
  assert(norm.schemaVersion === SCHEMA_VERSION, 'normalised to v2')
  assert(norm.blocks.length === 4 && norm.blocks.every((b) => b.length === 1),
    'every legacy cell survives as a single block')
  assert(norm.displayPreferences.timetableLayout === 'days-as-columns', 'existing timetables default to days-as-columns')
  assert(norm.slots.p1.Monday === 'English Language', 'the original slots map is preserved')
  const model = buildTimetableGridModel(legacy)
  assert(cellState(model, 'Monday', 4).block.label === 'English Language', 'separated repeat renders as its own single')
})

/* ══ Exports ═══════════════════════════════════════════════════ */

test('the PDF HTML is A4 landscape with full times, all days and the last period, in both layouts', () => {
  for (const layout of ['days-as-columns', 'days-as-rows']) {
    const html = buildPrintableHtml(sampleArtifact(layout), false)
    assert(html.includes('size: A4 landscape'), 'A4 landscape page')
    assert(html.includes('table-layout: fixed'), 'fixed table layout prevents column clipping')
    for (const day of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']) {
      assert(html.includes(day), `${day} present in ${layout}`)
    }
    assert(html.includes('07:30'), 'full start time present (not clipped to a final digit)')
    const lastLesson = lessonPeriods(G5_PERIODS).at(-1)
    assert(html.includes(lastLesson.end), `the final period's end time ${lastLesson.end} appears`)
    assert(html.includes('Technology Studies'), 'long subject names are kept whole')
  }
})

test('the PDF HTML merges double periods with rowspan / colspan per layout', () => {
  const colsHtml = buildPrintableHtml(sampleArtifact('days-as-columns'), false)
  const rowsHtml = buildPrintableHtml(sampleArtifact('days-as-rows'), false)
  assert(/rowspan="2"/.test(colsHtml), 'days-as-columns merges doubles vertically')
  assert(/colspan="2"/.test(rowsHtml), 'days-as-rows merges doubles horizontally')
})

test('the XLSX workbook carries both sheets, merges, frozen panes and the details audit', () => {
  const artifact = sampleArtifact()
  const files = buildClassTimetableWorkbookFiles(artifact, {
    validation: validateTimetableBlocks({
      blocks: artifact.blocks,
      subjects: artifact.subjectAllocations.map((s) => ({ ...s, id: s.subjectId || s.label })),
      periods: G5_PERIODS, days: DEFAULT_DAYS,
      curriculum: resolveTimetableCurriculum({ grade: 'G5' }),
    }),
  })
  const sheet1 = files['xl/worksheets/sheet1.xml']
  const sheet2 = files['xl/worksheets/sheet2.xml']
  assert(files['xl/workbook.xml'].includes('Timetable') && files['xl/workbook.xml'].includes('Details'),
    'two worksheets declared')
  assert(sheet1.includes('MONDAY') && sheet1.includes('FRIDAY'), 'all days present')
  assert(sheet1.includes('state="frozen"') && sheet1.includes('xSplit="1"'), 'header row + first column frozen')
  assert(sheet1.includes('<mergeCells'), 'double periods / titles merged')
  assert(sheet1.includes('orientation="landscape"'), 'printable landscape setup')
  assert(sheet2.includes('Official weekly allocations') && sheet2.includes('Actual placed periods'),
    'details sheet carries official vs actual allocations')
  assert(sheet2.includes('Validation'), 'validation results included')
  // Days-as-rows variant renders too.
  const rowsFiles = buildClassTimetableWorkbookFiles(sampleArtifact('days-as-rows'))
  assert(rowsFiles['xl/worksheets/sheet1.xml'].includes('DAY'), 'days-as-rows sheet renders')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
