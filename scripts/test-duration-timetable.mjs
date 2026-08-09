#!/usr/bin/env node
/* global console, process */
/**
 * Integration tests for how duration changes drive the timetable — the schedule
 * recalculation, knock-off overflow detection, per-day independence, template
 * defaults and legacy-value loading — proving the duration dropdowns feed the
 * deterministic core (src/shared/utils/classTimetable.js) correctly.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:duration-timetable   (also via npm run test:all)
 */
import {
  buildPeriods,
  dayEndTime,
  lessonPeriods,
  timeToMinutes,
  periodsForDay,
  slotCountForDay,
  SCHOOL_DAY_TEMPLATES,
  templatesForDayType,
} from '../src/shared/utils/classTimetable.js'
import {
  normalizeTimingBreaks,
  normalizeDaySchedulesBreaks,
  isPresetDuration,
} from '../src/utils/durationOptions.js'

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
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }

const startOf = (periods, label) => periods.find((p) => p.kind === 'lesson' && p.label === label)?.start

const baseTiming = {
  fitToEndTime: false,
  startTime: '08:00',
  endTime: '11:00',
  periodMinutes: 40,
  lessonPeriods: 4,
  breaks: [
    { afterPeriod: 0, minutes: 0, name: 'ASSEMBLY', event: 'assembly', enabled: false },
    { afterPeriod: 2, minutes: 15, name: 'BREAK', event: 'break', enabled: true },
  ],
}

/* ── Recalculation of subsequent times ────────────────────────── */
test('changing a break duration shifts every following lesson start/end', () => {
  const before = buildPeriods(baseTiming)
  // Period 1 08:00–08:40, Period 2 08:40–09:20, BREAK 15m → Period 3 09:35.
  eq(startOf(before, 'Period 3'), '09:35', 'Period 3 start with a 15-min break')
  eq(dayEndTime(before), '10:55', 'day ends with a 15-min break')

  const longer = { ...baseTiming, breaks: baseTiming.breaks.map((b) => (b.event === 'break' ? { ...b, minutes: 45 } : b)) }
  const after = buildPeriods(longer)
  // A 45-min break pushes Period 3 (and the whole tail) 30 minutes later.
  eq(startOf(after, 'Period 3'), '10:05', 'Period 3 start with a 45-min break')
  eq(dayEndTime(after), '11:25', 'day ends 30 min later with a 45-min break')
})

test('the lesson-period count is unchanged by a duration change', () => {
  const a = lessonPeriods(buildPeriods(baseTiming)).length
  const b = lessonPeriods(buildPeriods({ ...baseTiming, breaks: baseTiming.breaks.map((x) => ({ ...x, minutes: 50 })) })).length
  eq(a, 4); eq(b, 4)
})

/* ── Overflow beyond the knock-off ────────────────────────────── */
test('detects a timetable that runs past the knock-off after a longer break', () => {
  const target = timeToMinutes(baseTiming.endTime) // 11:00
  const fits = timeToMinutes(dayEndTime(buildPeriods(baseTiming))) // 10:55
  assert(fits - target <= 0, 'the 15-min break fits inside the knock-off')

  const overflow = { ...baseTiming, breaks: baseTiming.breaks.map((b) => (b.event === 'break' ? { ...b, minutes: 45 } : b)) }
  const overEnd = timeToMinutes(dayEndTime(buildPeriods(overflow))) // 11:25
  assert(overEnd - target > 0, 'the 45-min break overflows the knock-off')
  eq(overEnd - target, 25, 'overflow is 25 minutes')
})

/* ── No silent deletion of lesson periods ─────────────────────── */
test('an oversized break never drops lesson rows — they are all still built', () => {
  const huge = { ...baseTiming, breaks: baseTiming.breaks.map((b) => (b.event === 'break' ? { ...b, minutes: 180 } : b)) }
  eq(lessonPeriods(buildPeriods(huge)).length, 4, 'all four lessons survive an oversized break')
})

/* ── Independent per-day duration values ──────────────────────── */
test('two days keep independent break durations', () => {
  const base = buildPeriods(baseTiming)
  const dayStructure = {
    daySchedules: {
      Monday: { dayType: 'full', timing: { ...baseTiming, breaks: baseTiming.breaks.map((b) => (b.event === 'break' ? { ...b, minutes: 10 } : b)) } },
      Friday: { dayType: 'full', timing: { ...baseTiming, breaks: baseTiming.breaks.map((b) => (b.event === 'break' ? { ...b, minutes: 45 } : b)) } },
    },
  }
  const mon = periodsForDay('Monday', base, dayStructure)
  const fri = periodsForDay('Friday', base, dayStructure)
  eq(startOf(mon, 'Period 3'), '09:30', 'Monday keeps its 10-min break')
  eq(startOf(fri, 'Period 3'), '10:05', 'Friday keeps its 45-min break')
  // Editing Friday must not have touched Monday.
  eq(slotCountForDay('Monday', base, dayStructure), 4)
  eq(slotCountForDay('Friday', base, dayStructure), 4)
})

/* ── Loading legacy duration values ───────────────────────────── */
test('a legacy timing with string / "20 min" durations loads and builds correctly', () => {
  const legacy = {
    ...baseTiming,
    breaks: [
      { afterPeriod: 0, minutes: '0', name: 'ASSEMBLY', event: 'assembly', enabled: false },
      { afterPeriod: 2, minutes: '45 min', name: 'BREAK', event: 'break', enabled: true },
    ],
  }
  const normalised = normalizeTimingBreaks(legacy)
  eq(normalised.breaks[1].minutes, 45, 'legacy "45 min" → integer 45')
  const built = buildPeriods(normalised)
  eq(startOf(built, 'Period 3'), '10:05', 'the migrated duration drives the schedule')
})

test('legacy day schedules migrate their durations per day', () => {
  const migrated = normalizeDaySchedulesBreaks({
    Friday: { dayType: 'half', timing: { ...baseTiming, breaks: [{ afterPeriod: 2, minutes: '30 minutes', name: 'BREAK', event: 'break', enabled: true }] } },
  })
  eq(migrated.Friday.timing.breaks[0].minutes, 30)
})

/* ── Full-day + half-day templates carry sensible defaults ────── */
test('full-day templates exist and seed integer break durations', () => {
  const fulls = templatesForDayType('full')
  assert(fulls.length > 0, 'at least one full-day template')
  for (const t of fulls) {
    for (const b of t.timing.breaks) {
      assert(Number.isInteger(b.minutes) && b.minutes >= 0, `${t.id} ${b.event} minutes should be a non-negative integer`)
    }
  }
})
test('half-day templates exist and seed integer break durations', () => {
  const halves = templatesForDayType('half')
  assert(halves.length > 0, 'at least one half-day template')
  for (const t of halves) {
    for (const b of t.timing.breaks) {
      assert(Number.isInteger(b.minutes) && b.minutes >= 0, `${t.id} ${b.event} minutes should be a non-negative integer`)
    }
  }
})
test('a template default duration stays editable afterwards', () => {
  const tpl = SCHOOL_DAY_TEMPLATES.find((t) => t.dayType === 'full')
  // Seed timing from the template, then lengthen its break — the day must move.
  const seeded = { ...tpl.timing, fitToEndTime: false, startTime: '08:00', periodMinutes: 40, lessonPeriods: 4 }
  const seededEnd = timeToMinutes(dayEndTime(buildPeriods(seeded)))
  const edited = {
    ...seeded,
    breaks: seeded.breaks.map((b) => (b.event === 'break' && b.enabled !== false ? { ...b, minutes: b.minutes + 30 } : b)),
  }
  const editedEnd = timeToMinutes(dayEndTime(buildPeriods(edited)))
  assert(editedEnd > seededEnd, 'lengthening the break must push the day later')
  eq(editedEnd - seededEnd, 30, 'a +30-min break moves the day exactly 30 min later')
})
test('the default event durations match the brief (assembly 15 / break 20 / lunch 40 / closing 10)', () => {
  const full = SCHOOL_DAY_TEMPLATES.find((t) => t.id === 'full-day-break-lunch')
  const byEvent = Object.fromEntries(full.timing.breaks.map((b) => [b.event, b.minutes]))
  eq(byEvent.assembly, 15); eq(byEvent.break, 20); eq(byEvent.lunch, 40); eq(byEvent.closing, 10)
  // And each preset default is one the dropdown offers directly.
  for (const m of [15, 20, 40, 10]) assert(isPresetDuration(m), `${m} is a preset`)
})

/* ── summary ──────────────────────────────────────────────────── */
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
