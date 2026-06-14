#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the Class Timetable studio's deterministic core
 * (src/utils/classTimetable.js): period/time construction, capacity,
 * round-robin token spreading, the balanced auto-fill, and the XLSX
 * workbook parts (src/utils/classTimetableToXlsx.js).
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
  roundRobinTokens,
  autoFillTimetable,
  totalAllocated,
  filledCount,
  buildTimetableArtifact,
  DEFAULT_DAYS,
} from '../src/utils/classTimetable.js'
import { buildClassTimetableWorkbookFiles } from '../src/utils/classTimetableToXlsx.js'

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

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
