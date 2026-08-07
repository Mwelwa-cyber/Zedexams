#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for school SESSIONS (src/utils/timetableSessions.js) and the
 * period-building they drive in src/utils/classTimetable.js: shift windows,
 * session-aware knock-off checking, day-scoped assembly, the assembly that
 * OCCUPIES period 1, and custom period times.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:timetable-sessions   (also via npm run test:all)
 */
import {
  SCHOOL_SESSIONS,
  DEFAULT_SESSION_ID,
  getSession,
  isShiftSession,
  sessionLabel,
  sessionDefaults,
  knockOffStatus,
} from '../src/utils/timetableSessions.js'
import {
  buildPeriods,
  lessonPeriods,
  timeToMinutes,
  lastLessonEndTime,
  dayScopeMatches,
  resolveTimingMode,
  applySessionToTiming,
  weeklyLessonMinutes,
  lessonLengthProfile,
  slotCountForDay,
  weeklyCapacity,
  DEFAULT_TIMING,
  DEFAULT_DAYS,
  getSchoolDayTemplate,
} from '../src/utils/classTimetable.js'

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

console.log('\nSchool sessions\n')

test('the five sessions the brief asks for are offered, three of them shifts', () => {
  const ids = SCHOOL_SESSIONS.map((s) => s.id)
  for (const id of ['full', 'morning', 'mid-morning', 'afternoon', 'custom']) {
    assert(ids.includes(id), `session ${id} is offered`)
  }
  eq(DEFAULT_SESSION_ID, 'full', 'a new timetable starts as a full day')
  // Three-session small schools are supported: morning, mid-morning, afternoon.
  eq(SCHOOL_SESSIONS.filter((s) => s.shift).length, 3, 'three shift sessions')
  assert(isShiftSession('afternoon') && isShiftSession('mid-morning') && isShiftSession('morning'),
    'each shift session is flagged as one')
  assert(!isShiftSession('full') && !isShiftSession('custom'), 'full day and custom are not shifts')
  eq(sessionLabel('afternoon'), 'Afternoon', 'labels resolve')
  eq(getSession('nope'), null, 'an unknown id resolves to null rather than a guess')
})

test('each named session seeds its own window; Custom keeps whatever was typed', () => {
  eq(sessionDefaults('afternoon').startTime, '12:40', 'the afternoon session reports at 12:40')
  eq(sessionDefaults('morning').endTime, '12:40', 'the morning session hands over at 12:40')
  eq(sessionDefaults('full').startTime, '07:30', 'a full day reports at 07:30')
  eq(sessionDefaults('custom'), null, 'Custom is the escape hatch — it seeds nothing')
  const applied = applySessionToTiming({ startTime: '07:30', endTime: '13:10' }, 'afternoon')
  eq(applied.startTime, '12:40', 'applying the session moves the report time')
  eq(applied.session, 'afternoon', 'the session is recorded on the timing')
  const kept = applySessionToTiming({ startTime: '08:15', endTime: '15:00' }, 'custom')
  eq(kept.startTime, '08:15', 'Custom keeps the teacher’s own times')
  eq(kept.session, 'custom', 'and still records the choice')
})

test('an afternoon session ending 16:50 raises NO knock-off warning', () => {
  // The reference government Grade 4A class: reports 12:40, ends 16:50.
  const tpl = getSchoolDayTemplate('government-afternoon-session')
  const rows = buildPeriods(tpl.timing, { day: 'Tuesday' })
  eq(rows[0].start, '12:40', 'reports at 12:40')
  eq(lastLessonEndTime(rows), '16:50', 'the last lesson ends at 16:50')
  const status = knockOffStatus({
    targetEndTime: tpl.timing.endTime, actualEndTime: lastLessonEndTime(rows), timeToMinutes,
  })
  eq(status.status, 'ok', 'ending exactly on the session’s own knock-off is not a warning')
  eq(status.deltaMinutes, 0, 'no drift')
})

test('the knock-off check compares against the SESSION’S own target, not a morning school', () => {
  // The same 16:50 is "over" only when the teacher's own target is earlier.
  eq(knockOffStatus({ targetEndTime: '16:00', actualEndTime: '16:50', timeToMinutes }).status, 'over',
    'past the stated knock-off is over')
  eq(knockOffStatus({ targetEndTime: '17:30', actualEndTime: '16:50', timeToMinutes }).status, 'under',
    'before the stated knock-off is under')
  eq(knockOffStatus({ targetEndTime: '', actualEndTime: '16:50', timeToMinutes }).status, 'unknown',
    'no target means nothing is claimed')
})

console.log('\nDay-scoped bands + assembly placement\n')

test('an unscoped row applies everywhere; a scoped one is left out of the reference list', () => {
  assert(dayScopeMatches(null, 'Monday'), 'null = every day')
  assert(dayScopeMatches([], 'Monday'), 'empty = every day')
  assert(dayScopeMatches(null, null), 'unscoped rows are in the reference list')
  assert(dayScopeMatches(['Monday'], 'Monday'), 'a scoped row applies on its own day')
  assert(!dayScopeMatches(['Monday'], 'Tuesday'), 'and not on another')
  assert(!dayScopeMatches(['Monday'], null),
    'a scoped row is NOT part of the shape every day shares')
})

test('assembly occupying period 1 costs that day a lesson and keeps the knock-off', () => {
  const tpl = getSchoolDayTemplate('government-afternoon-session')
  const monday = buildPeriods(tpl.timing, { day: 'Monday' })
  const tuesday = buildPeriods(tpl.timing, { day: 'Tuesday' })

  const mondayFirst = monday[0]
  eq(mondayFirst.kind, 'break', 'Monday’s first row is a band')
  eq(mondayFirst.event, 'assembly', 'and it is the assembly')
  eq(mondayFirst.start, '12:40', 'it starts when the session reports')
  eq(mondayFirst.end, tuesday[0].end, 'it occupies exactly the period-1 slot')

  eq(tuesday[0].kind, 'lesson', 'Tuesday holds a lesson in that same slot')
  eq(lessonPeriods(monday).length, lessonPeriods(tuesday).length - 1,
    'Monday fits one fewer lesson')
  eq(lastLessonEndTime(monday), lastLessonEndTime(tuesday),
    'and still knocks off at the same time')
  // The remaining lessons renumber, so slot 1 is still the first teachable slot.
  eq(lessonPeriods(monday)[0].id, 'p1', 'lessons renumber after the band')
})

test('a day-scoped assembly is BACKDATED so no day’s lessons drift out of line', () => {
  // The private reference school holds assembly on Monday and Friday. Those
  // days report earlier — they do not push their lessons 20 minutes later
  // than every other day of the week.
  const tpl = getSchoolDayTemplate('private-full-day')
  const monday = buildPeriods(tpl.timing, { day: 'Monday' })
  const tuesday = buildPeriods(tpl.timing, { day: 'Tuesday' })
  eq(monday[0].event, 'assembly', 'Monday opens with assembly')
  eq(monday[0].start, '07:40', 'reporting 20 minutes earlier')
  eq(monday[0].end, '08:00', 'ending when the lessons start')
  eq(lessonPeriods(monday)[0].start, lessonPeriods(tuesday)[0].start,
    'both days start their first lesson at the same clock time')
  eq(lessonPeriods(monday).length, lessonPeriods(tuesday).length,
    'and hold the same number of lessons')
  assert(!tuesday.some((r) => r.event === 'assembly'), 'Tuesday holds no assembly')
})

test('an existing timetable with no day scope keeps assembly on every day', () => {
  const rows = buildPeriods(DEFAULT_TIMING, { day: 'Thursday' })
  eq(rows[0].event, 'assembly', 'the default assembly is unscoped and still runs daily')
  eq(rows[0].start, DEFAULT_TIMING.startTime, 'starting at the reporting time, as it always did')
})

console.log('\nCustom period times\n')

test('custom rows are rendered verbatim — 60-minute lessons, a 30-min break, a 90-min lunch', () => {
  // The private reference school's real day, typed out.
  const timing = {
    timingMode: 'custom',
    customRows: [
      { kind: 'lesson', start: '08:00', end: '09:00' },
      { kind: 'lesson', start: '09:00', end: '10:00' },
      { kind: 'break', name: 'BREAK', event: 'break', start: '10:00', end: '10:30' },
      { kind: 'lesson', start: '10:30', end: '11:30' },
      { kind: 'lesson', start: '11:30', end: '12:30' },
      { kind: 'break', name: 'LUNCH', event: 'lunch', start: '12:30', end: '14:00' },
      { kind: 'lesson', start: '14:00', end: '15:00' },
      { kind: 'lesson', start: '15:00', end: '16:00' },
    ],
  }
  eq(resolveTimingMode(timing), 'custom', 'the mode resolves')
  const rows = buildPeriods(timing)
  eq(lessonPeriods(rows).length, 6, 'six lessons')
  eq(rows[2].label, 'BREAK', 'the 30-minute break keeps its name')
  eq(rows[2].end, '10:30', 'and its exact end time')
  eq(rows[5].label, 'LUNCH', 'the 90-minute lunch is where it was typed')
  eq(lastLessonEndTime(rows), '16:00', 'the day ends when the last typed row ends')
  const profile = lessonLengthProfile({ periods: rows, days: ['Monday'], timing })
  eq(profile.minutes, 60, 'a lesson at this school is 60 minutes')
  assert(profile.uniform, 'every lesson is the same length here')
})

test('a malformed custom row is skipped, never silently "corrected"', () => {
  const timing = {
    timingMode: 'custom',
    customRows: [
      { kind: 'lesson', start: '08:00', end: '09:00' },
      { kind: 'lesson', start: '', end: '10:00' },          // no start
      { kind: 'lesson', start: '11:00', end: '10:00' },     // ends before it starts
      { kind: 'lesson', start: '10:00', end: '11:00', enabled: false },
      { kind: 'lesson', start: '11:00', end: '12:00' },
    ],
  }
  eq(lessonPeriods(buildPeriods(timing)).length, 2, 'only the two sound rows are built')
})

test('an empty custom list falls back to the fixed builder rather than an empty day', () => {
  const rows = buildPeriods({ ...DEFAULT_TIMING, timingMode: 'custom', customRows: [] })
  assert(lessonPeriods(rows).length > 0, 'the day still has lessons')
})

console.log('\nWeekly capacity in time\n')

test('a shift session’s weekly teaching time is measured, not derived from a period count', () => {
  const tpl = getSchoolDayTemplate('government-afternoon-session')
  const timing = tpl.timing
  const periods = buildPeriods(timing)
  const minutes = weeklyLessonMinutes({ periods, days: DEFAULT_DAYS, timing })
  // Mon 5 lessons (assembly takes period 1) + Tue–Fri 6 each = 29 × 40 min.
  eq(slotCountForDay('Monday', periods, null, timing), 5, 'Monday fits five lessons')
  eq(slotCountForDay('Tuesday', periods, null, timing), 6, 'every other day fits six')
  eq(weeklyCapacity(periods, DEFAULT_DAYS, null, timing), 29, 'the week holds 29 lessons')
  eq(minutes, 29 * 40, 'which is 19 h 20 m of teaching')
  // Well short of the official 28 h — and that is the point of the session.
  assert(minutes < 1680, 'a shift session cannot hold the 28-hour curriculum week')
})

test('lessonLengthProfile reports the modal length and flags a mixed day', () => {
  const mixed = {
    timingMode: 'custom',
    customRows: [
      { kind: 'lesson', start: '08:00', end: '09:00' },
      { kind: 'lesson', start: '09:00', end: '10:00' },
      { kind: 'lesson', start: '10:00', end: '10:35' },
    ],
  }
  const profile = lessonLengthProfile({ periods: buildPeriods(mixed), days: ['Monday'], timing: mixed })
  eq(profile.minutes, 60, 'the modal lesson is 60 minutes — one odd row does not redefine it')
  assert(!profile.uniform, 'and the day is reported as NOT uniform, so coverage speaks in hours')
})

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
