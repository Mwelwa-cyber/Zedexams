#!/usr/bin/env node
/* global console, process */
/**
 * The acceptance test for the real-school fidelity pass: can the Class
 * Timetable Studio actually reproduce the two reference documents?
 *
 *   Government   Dudzai Primary, Grade 4A — an AFTERNOON session. Reports
 *                12:40, 40-minute periods, ends 16:50, a 10-minute break
 *                mid-afternoon, assembly occupying period 1 on Monday only.
 *                Printed on the Ministry template: MINISTRY OF EDUCATION
 *                header, "GRADE FOUR (4) A TIME TABLE", days down the left,
 *                BREAK spelled vertically, ENG/MATHS/SCIE/ZIL/TECH/SS codes
 *                with a key, signature lines and stamp space, all black and
 *                white.
 *
 *   Private      A morning full day — 60-minute lessons, assembly Monday and
 *                Friday, a 30-minute break after period 2, a 90-minute
 *                lunch, a half-day Friday, Chinyanja as the Zambian Language
 *                display name and Literacy as a school subject, doubles
 *                merged, colour cells. Coverage reads in hours with no
 *                warnings.
 *
 * Everything here goes through the SAME functions the studio uses, so a
 * passing run is a claim about the product, not about the test.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-reference-schools   (also via npm run test:all)
 */
import {
  buildPeriods,
  lessonPeriods,
  lastLessonEndTime,
  weeklyCapacity,
  weeklyLessonMinutes,
  lessonLengthProfile,
  slotCountForDay,
  autoFillBlocks,
  validateTimetableBlocks,
  buildTimetableArtifact,
  normalizeTimetableArtifact,
  curriculumSubjectsForGrade,
  newSubject,
  withLanguageName,
  withDaySchedule,
  getSchoolDayTemplate,
  DEFAULT_DAYS,
  DEFAULT_DISPLAY_PREFERENCES,
} from '../src/shared/utils/classTimetable.js'
import { resolveTimetableCurriculum } from '../src/utils/curriculumFramework.js'
import { buildTimetableGridModel, resolveDayCell } from '../src/shared/utils/timetableGridModel.js'
import { buildPrintableHtml } from '../src/engines/export-engine/classTimetableToPdf.js'
import { buildClassTimetableWorkbookFiles } from '../src/engines/export-engine/classTimetableToXlsx.js'
import {
  resolveSubjectTargets,
  resolveCoverageUnit,
  formatCoverage,
  formatDuration,
} from '../src/features/classTimetable/lib/timetableCoverage.js'
import { isShiftSession } from '../src/shared/utils/timetableSessions.js'

let pass = 0
let fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`) } catch (err) {
    fail += 1; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, message) { if (!cond) throw new Error(message) }
const eq = (a, b, message) => assert(a === b, `${message} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`)

const UPPER = resolveTimetableCurriculum({ grade: 'G4' })

/**
 * Build one timetable exactly as the studio does: seed the curriculum
 * allocation, convert its weekly TIME into this school's lessons (scaling
 * into the session's capacity when it is a shift), auto-fill and validate.
 */
function buildSchool({ timing, days = DEFAULT_DAYS, daySchedules = null, extraSubjects = [], languageName = '', strategy = 'core-first', displayPreferences = {}, header = {} }) {
  const periods = buildPeriods(timing)
  const dayStructure = daySchedules ? { daySchedules } : null
  const capacity = weeklyCapacity(periods, days, dayStructure, timing)
  const profile = lessonLengthProfile({ periods, days, dayStructure, timing })
  const seeded = withLanguageName([...curriculumSubjectsForGrade('G4'), ...extraSubjects], languageName)
  const targets = resolveSubjectTargets({
    subjects: seeded,
    lessonMinutes: profile.minutes,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    capacityLessons: isShiftSession(timing.session) ? capacity : null,
    strategy,
  })
  const byId = new Map(targets.rows.map((r) => [r.id, r.lessons]))
  const subjects = seeded.map((s) => (byId.has(s.id) ? { ...s, periodsPerWeek: byId.get(s.id) } : s))
  const { blocks, unplaced } = autoFillBlocks({ subjects, days, periods, dayStructure, timing })
  const validation = validateTimetableBlocks({
    blocks, subjects, periods, days, dayStructure, timing,
    curriculum: UPPER, allocationScaled: targets.scaled, lessonMinutes: profile.minutes,
  })
  const artifact = buildTimetableArtifact({
    header, days, periods, blocks, dayStructure, timing, languageName,
    displayPreferences: { ...DEFAULT_DISPLAY_PREFERENCES, ...displayPreferences },
    curriculumId: 'cbc-2023',
    selectedOptions: { practical: 'expressive-arts' },
    subjectAllocations: subjects,
    allocationStrategy: targets.scaled ? strategy : null,
  })
  return { periods, days, dayStructure, capacity, profile, subjects, targets, blocks, unplaced, validation, artifact }
}

console.log('\nGovernment test — Grade 4A, afternoon session\n')

const GOV_TIMING = getSchoolDayTemplate('government-afternoon-session').timing
const gov = buildSchool({
  timing: GOV_TIMING,
  header: { school: 'Dudzai Primary School', grade: 'G4', className: 'Grade 4 A', term: 2, year: '2026', teacherName: 'Mrs Banda' },
  displayPreferences: { printTemplate: 'government', cellText: 'abbrev' },
})

test('the day is the reference document’s: reports 12:40, 40-minute periods, ends 16:50', () => {
  const tuesday = buildPeriods(GOV_TIMING, { day: 'Tuesday' })
  eq(tuesday[0].start, '12:40', 'reports 12:40')
  eq(lastLessonEndTime(tuesday), '16:50', 'knocks off 16:50')
  const lessons = lessonPeriods(tuesday)
  eq(lessons.length, 6, 'six lessons')
  for (const l of lessons) {
    const mins = (Number(l.end.slice(0, 2)) * 60 + Number(l.end.slice(3)))
      - (Number(l.start.slice(0, 2)) * 60 + Number(l.start.slice(3)))
    eq(mins, 40, 'each 40 minutes')
  }
  const brk = tuesday.find((r) => r.event === 'break')
  eq(brk.start, '14:40', 'the short break lands mid-afternoon')
  eq(brk.end, '14:50', 'and runs ten minutes')
})

test('assembly occupies period 1 on Monday ONLY — every other day teaches then', () => {
  const model = buildTimetableGridModel(gov.artifact)
  const firstLessonRow = model.rows.find((r) => r.kind === 'lesson')
  eq(resolveDayCell(model, 'Monday', firstLessonRow).state, 'band',
    'Monday’s 12:40 slot is the assembly')
  eq(resolveDayCell(model, 'Monday', firstLessonRow).bandLabel, 'ASSEMBLY', 'labelled as such')
  assert(resolveDayCell(model, 'Tuesday', firstLessonRow).state !== 'band',
    'Tuesday holds a lesson in that same slot')
  eq(slotCountForDay('Monday', gov.periods, null, GOV_TIMING), 5, 'Monday fits one fewer lesson')
  eq(slotCountForDay('Tuesday', gov.periods, null, GOV_TIMING), 6, 'the rest fit six')
})

test('an afternoon session ending 16:50 produces no knock-off warning anywhere', () => {
  assert(!gov.validation.errors.some((e) => /knock/i.test(e)), 'no knock-off error')
  assert(!gov.validation.warnings.some((w) => /knock/i.test(w)), 'no knock-off warning')
})

test('the coverage target is the SESSION’S own capacity, and a full session reads ✓', () => {
  assert(isShiftSession(GOV_TIMING.session), 'the afternoon session is a shift')
  eq(gov.capacity, 29, 'the week holds 29 lessons (Monday loses one to assembly)')
  const minutes = weeklyLessonMinutes({ periods: gov.periods, days: gov.days, timing: GOV_TIMING })
  eq(formatDuration(minutes), '19h 20m', 'which is 19 h 20 m — well short of the official 28 h')
  assert(gov.targets.scaled, 'so the curriculum allocation is scaled into the session')
  eq(gov.targets.totals.targetLessons, 29, 'and the targets sum to exactly the session’s capacity')

  const unit = resolveCoverageUnit({
    lessonMinutes: gov.profile.minutes,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    uniformLessons: gov.profile.uniform,
  })
  const chip = formatCoverage({
    placedLessons: gov.validation.summary.curriculumPeriods,
    targetLessons: gov.targets.totals.targetLessons,
    placedMinutes: gov.validation.summary.contactMinutes,
    targetMinutes: gov.targets.totals.targetMinutes,
    unit,
  })
  assert(chip.complete, `a full session reads complete — got "${chip.text}"`)
  assert(chip.text.endsWith('✓'), 'with the tick')
  eq(chip.shortfall, 0, 'and nothing outstanding')
})

test('no deficit state survives: every subject reaches its target inside the session', () => {
  eq(gov.unplaced.length, 0, 'everything is placed')
  const short = gov.validation.bySubject.filter((r) => r.selected && r.status !== 'ok')
  eq(short.length, 0, `every subject reaches ✓ — short: ${short.map((r) => r.label).join(', ')}`)
  eq(gov.validation.status, 'passed', 'and the whole week passes')
  assert(!gov.validation.customised,
    'a scaled shift allocation is NOT reported as "customised from the baseline" — it is a system constraint')
})

test('core-first protected English, Mathematics and Science at their full official time', () => {
  for (const label of ['English Language', 'Mathematics', 'Science']) {
    const row = gov.subjects.find((s) => s.label === label)
    eq(row.periodsPerWeek, 6, `${label} keeps its 6 official periods`)
  }
})

test('it prints on the Ministry template: header, official title, days-left, B&W, key, signatures', () => {
  const html = buildPrintableHtml(gov.artifact, false)
  assert(html.includes('MINISTRY OF EDUCATION'), 'the Ministry header line')
  assert(html.includes('DUDZAI PRIMARY SCHOOL') || html.includes('Dudzai Primary School'), 'the school name')
  assert(html.includes('GRADE FOUR (4) A TIME TABLE'), 'the official title format')
  assert(html.includes('<th>DAY</th>'), 'days down the left')
  assert(/>MONDAY</.test(html), 'with a row per day')
  // Black and white: no palette fills reach the page.
  assert(!/background:#[0-9a-f]{6}"/i.test(html.split('<body>')[1] || ''),
    'no inline colour fills in the body — the master photocopies cleanly')
  assert(html.includes('KEY:'), 'the abbreviation key prints')
  assert(html.includes('ENG = English Language'), 'naming the codes actually used')
  assert(html.includes('Senior teacher / Head'), 'signature lines')
  assert(html.includes('School stamp'), 'and a clear space for the stamp')
})

test('the cells carry the codes the reference document uses', () => {
  const html = buildPrintableHtml(gov.artifact, false)
  for (const code of ['ENG', 'MATHS', 'SCIE', 'ZIL', 'TECH', 'SS']) {
    assert(html.includes(`>${code}<`) || html.includes(`>${code}`), `${code} appears on the grid`)
  }
  assert(!html.includes('>English Language<'), 'and the full names do not')
})

test('BREAK is spelled one letter per day-row down its own column', () => {
  const html = buildPrintableHtml(gov.artifact, false)
  const spelled = [...html.matchAll(/class="brkv spell">([A-Z]?)</g)].map((m) => m[1])
  eq(spelled.join(''), 'BREAK', 'B/R/E/A/K, one per Monday–Friday row')
})

test('Monday’s ASSEMBLY prints as a band cell, and only on Monday', () => {
  const html = buildPrintableHtml(gov.artifact, false)
  eq((html.match(/class="dayband">ASSEMBLY</g) || []).length, 1,
    'exactly one assembly band — Monday’s')
})

console.log('\nPrivate test — Grade 4, 60-minute lessons\n')

const PRIVATE_TIMING = getSchoolDayTemplate('private-full-day').timing
const FRIDAY_HALF = getSchoolDayTemplate('half-day-friday')
const priv = buildSchool({
  timing: PRIVATE_TIMING,
  daySchedules: withDaySchedule(null, 'Friday', {
    dayType: 'half', templateId: FRIDAY_HALF.id, timing: FRIDAY_HALF.timing,
  }).daySchedules,
  // Literacy is not in the official 7-subject table — the school teaches it
  // anyway, and it takes real slots out of the week.
  extraSubjects: [newSubject('Literacy', { periodsPerWeek: 2 })],
  languageName: 'Chinyanja',
  header: { school: 'Riverside Academy', grade: 'G4', className: 'Grade 4', term: 2, year: '2026' },
  displayPreferences: { printTemplate: 'modern', printLayout: 'days-as-rows', cellText: 'full' },
})

test('the day is the private reference’s: 60-min lessons, a 30-min break, a 90-min lunch', () => {
  const tuesday = buildPeriods(PRIVATE_TIMING, { day: 'Tuesday' })
  const lessons = lessonPeriods(tuesday)
  eq(lessons.length, 6, 'six 60-minute lessons')
  eq(lessons[0].start, '08:00', 'starting at 08:00')
  const brk = tuesday.find((r) => r.event === 'break')
  eq(`${brk.start}–${brk.end}`, '10:00–10:30', 'a 30-minute break at 10:00')
  const lunch = tuesday.find((r) => r.event === 'lunch')
  eq(`${lunch.start}–${lunch.end}`, '12:30–14:00', 'a 90-minute lunch at 12:30')
  eq(lastLessonEndTime(tuesday), '16:00', 'and the day ends at 16:00')
})

test('assembly is held on Monday and Friday only, without shifting anyone’s lessons', () => {
  const monday = buildPeriods(PRIVATE_TIMING, { day: 'Monday' })
  const tuesday = buildPeriods(PRIVATE_TIMING, { day: 'Tuesday' })
  eq(monday[0].event, 'assembly', 'Monday opens with assembly')
  eq(monday[0].start, '07:40', 'reporting twenty minutes early')
  assert(!tuesday.some((r) => r.event === 'assembly'), 'Tuesday has none')
  eq(lessonPeriods(monday)[0].start, lessonPeriods(tuesday)[0].start,
    'and both days start teaching at the same clock time')
})

test('coverage reads in HOURS — "English 4h00 → 4 lessons", not six periods', () => {
  eq(priv.profile.minutes, 60, 'a lesson here is 60 minutes')
  const unit = resolveCoverageUnit({
    lessonMinutes: priv.profile.minutes,
    curriculumPeriodMinutes: UPPER.periodMinutes,
    uniformLessons: priv.profile.uniform,
  })
  eq(unit, 'hours', '"38/42" would not be a true statement at this school')
  const english = priv.targets.rows.find((r) => r.label === 'English Language')
  eq(english.officialMinutes, 240, 'English owes 4h00')
  eq(english.lessons, 4, 'which is 4 of this school’s lessons')
  eq(priv.subjects.find((s) => s.label === 'English Language').periodsPerWeek, 4,
    'and that is the target the studio places against')
})

test('a full day is never scaled — the curriculum load stands', () => {
  assert(!isShiftSession(PRIVATE_TIMING.session), 'a full day is not a shift')
  assert(!priv.targets.scaled, 'so no allocation strategy is applied')
  eq(priv.targets.totals.officialMinutes, 1680, 'the full 28 hours is still owed')
  eq(priv.targets.totals.targetMinutes, 1680, 'and met — in 60-minute lessons')
})

test('the week fills cleanly: nothing unplaced, no warnings, no "customised" flag', () => {
  eq(priv.unplaced.length, 0,
    `everything fits — unplaced: ${priv.unplaced.map((u) => u.label).join(', ')}`)
  eq(priv.validation.errors.length, 0, `no errors: ${priv.validation.errors.join(' | ')}`)
  eq(priv.validation.warnings.length, 0, `no warnings: ${priv.validation.warnings.join(' | ')}`)
  eq(priv.validation.status, 'passed', 'the whole week passes')
  assert(!priv.validation.customised,
    'converting 4h00 into four 60-minute lessons is not a departure from the baseline')
})

test('Chinyanja prints as the Zambian Language, and the curriculum still counts it as one', () => {
  const zambian = priv.subjects.find((s) => s.label === 'Zambian Language')
  eq(zambian.displayLabel, 'Chinyanja', 'the display name is the language taught')
  const model = buildTimetableGridModel(priv.artifact)
  eq(model.displayLabels['Zambian Language'], 'Chinyanja', 'every renderer resolves it')
  eq(model.abbreviations['Zambian Language'], 'CHINY', 'and its code follows the language')
  // Identity is unchanged: the blocks still carry the canonical label.
  assert(priv.blocks.some((b) => b.label === 'Zambian Language'),
    'blocks keep the CANONICAL label — relabelling never rewrites the schedule')
  const row = priv.validation.bySubject.find((r) => r.label === 'Zambian Language')
  assert(row && row.target > 0, 'and it is still accounted for as the curriculum area')
})

test('Literacy is placed and printed, and never counted toward curriculum coverage', () => {
  const literacy = priv.validation.bySubject.find((r) => r.label === 'Literacy')
  assert(literacy, 'Literacy is in the subject list')
  assert(literacy.schoolSubject, 'flagged as a school subject')
  assert(literacy.placed > 0, 'and really placed on the grid')
  eq(priv.validation.summary.schoolSubjectPeriods, literacy.placed,
    'its lessons are counted apart')
  assert(priv.validation.summary.schoolSubjects.some((s) => s.label === 'Literacy'),
    'and listed as an extra')
  // The curriculum totals must not have absorbed it.
  const curriculumPlaced = priv.validation.bySubject
    .filter((r) => !r.schoolSubject).reduce((n, r) => n + r.placed, 0)
  eq(priv.validation.summary.curriculumPeriods, curriculumPlaced,
    'curriculum periods count only curriculum subjects')
})

test('a half-day Friday keeps its own shorter row', () => {
  const friday = buildPeriods(FRIDAY_HALF.timing, { day: 'Friday' })
  eq(lastLessonEndTime(friday), '12:30', 'Friday knocks off at 12:30')
  assert(lastLessonEndTime(buildPeriods(PRIVATE_TIMING, { day: 'Thursday' })) === '16:00',
    'while every other day runs to 16:00')
  // Its lessons are its own length, which is exactly why coverage cannot be
  // spoken in periods at this school.
  assert(!priv.profile.uniform, 'the week mixes lesson lengths')
  const model = buildTimetableGridModel(priv.artifact)
  assert(!model.aligned.Friday, 'Friday is not time-aligned with the rest of the week')
  eq(model.slotCount.Friday, slotCountForDay('Friday', priv.periods, priv.dayStructure, PRIVATE_TIMING),
    'and the grid model reports its own lesson count')
})

test('double periods print as ONE merged cell, not two repeated ones', () => {
  const html = buildPrintableHtml(priv.artifact, false)
  assert(/colspan="2"/.test(html), 'days-left merges a double horizontally')
  const xlsx = buildClassTimetableWorkbookFiles(priv.artifact)
  assert(xlsx['xl/worksheets/sheet1.xml'].includes('<mergeCells'), 'and Excel merges it too')
})

test('the modern template prints colour fills and full names', () => {
  const html = buildPrintableHtml(priv.artifact, false)
  const body = html.split('<body>')[1] || ''
  assert(/background:#[0-9a-f]{6}/i.test(body), 'colour-filled subject cells')
  assert(body.includes('Chinyanja'), 'printing the language the school teaches')
  assert(body.includes('Literacy'), 'and its school subject')
})

console.log('\nNothing saved before this pass changes\n')

test('a timetable with no timing, language or template loads and behaves exactly as before', () => {
  // A v2 artifact as the studio wrote it before this pass: built rows only.
  const legacyTiming = { startTime: '07:30', periodMinutes: 40, lessonPeriods: 8, breaks: [] }
  const legacyPeriods = buildPeriods(legacyTiming)
  const subjects = curriculumSubjectsForGrade('G4')
  const { blocks } = autoFillBlocks({ subjects, days: DEFAULT_DAYS, periods: legacyPeriods })
  const legacy = {
    schemaVersion: 'class-timetable-2.0',
    header: { grade: 'G4', className: '4A' },
    days: DEFAULT_DAYS,
    periods: legacyPeriods,
    blocks,
    slots: {},
    displayPreferences: { timetableLayout: 'days-as-columns', periodLabelMode: 'period-time' },
  }
  const normalised = normalizeTimetableArtifact(legacy)
  eq(normalised.timing, null, 'no timing config — every day shares the built rows, as it always did')
  eq(normalised.languageName, null, 'no language relabelling')
  const model = buildTimetableGridModel(legacy)
  for (const day of DEFAULT_DAYS) {
    eq(model.slotCount[day], 8, `${day} still holds its eight lessons`)
    assert(model.aligned[day], 'and shares the reference row times')
  }
  const firstLesson = model.rows.find((r) => r.kind === 'lesson')
  for (const day of DEFAULT_DAYS) {
    assert(resolveDayCell(model, day, firstLesson).state !== 'band',
      `${day} has no phantom assembly band`)
  }
  // Its printed shape still resolves — to the modern template, days-left.
  const html = buildPrintableHtml(legacy, false)
  assert(html.includes('Class Timetable'), 'and it still prints')
  assert(!html.includes('MINISTRY OF EDUCATION'), 'without inheriting the Ministry format')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
