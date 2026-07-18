#!/usr/bin/env node
/* global console, process */
/**
 * Unit tests for the timetable duration presets + coercion helpers
 * (src/utils/durationOptions.js): preset membership, custom-input validation
 * (rejecting zero / negative / non-numeric / out-of-range), legacy-value
 * migration, break normalisation and per-event labels.
 *
 * Plain `node` script that throws on failure, per repo convention.
 * Run: npm run test:duration-options   (also via npm run test:all)
 */
import {
  DURATION_PRESETS,
  CUSTOM_DURATION,
  DEFAULT_EVENT_DURATIONS,
  isPresetDuration,
  formatDuration,
  coerceDurationMinutes,
  validateDurationInput,
  normalizeBreaksMinutes,
  normalizeTimingBreaks,
  normalizeDaySchedulesBreaks,
  durationLabelForEvent,
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

/* ── presets ──────────────────────────────────────────────────── */
test('presets are the specified 5–60 set (no 55)', () => {
  eq(JSON.stringify(DURATION_PRESETS), JSON.stringify([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60]), 'preset list')
})
test('every preset reports as a preset; 55 does not', () => {
  for (const m of DURATION_PRESETS) assert(isPresetDuration(m), `${m} should be a preset`)
  assert(!isPresetDuration(55), '55 is not a preset')
  assert(!isPresetDuration(35.5), 'fractional is not a preset')
})
test('custom sentinel is distinct from any numeric value', () => {
  assert(CUSTOM_DURATION === 'custom', 'sentinel value')
  assert(!DURATION_PRESETS.includes(CUSTOM_DURATION), 'sentinel not in presets')
})

/* ── formatDuration ───────────────────────────────────────────── */
test('formatDuration renders "35 minutes" and singular "1 minute"', () => {
  eq(formatDuration(35), '35 minutes')
  eq(formatDuration(1), '1 minute')
  eq(formatDuration(60), '60 minutes')
  eq(formatDuration('abc'), '')
})

/* ── validateDurationInput: reject zero / negative / non-numeric ── */
test('rejects zero', () => {
  const r = validateDurationInput('0', { min: 1, max: 180 })
  eq(r.value, null); assert(r.error, 'should carry an error message')
})
test('rejects negative', () => {
  const r = validateDurationInput('-5', { min: 1, max: 180 })
  eq(r.value, null); assert(r.error, 'should carry an error message')
})
test('rejects non-numeric', () => {
  for (const bad of ['abc', '', '  ', '12x', '1.5', '3e2']) {
    const r = validateDurationInput(bad, { min: 1, max: 180 })
    eq(r.value, null, `"${bad}" should be rejected`)
    assert(r.error, `"${bad}" should carry an error message`)
  }
})
test('rejects above the max', () => {
  const r = validateDurationInput('181', { min: 1, max: 180 })
  eq(r.value, null); assert(/180/.test(r.error), 'error names the max')
})
test('accepts a clean whole value in range', () => {
  const r = validateDurationInput('35', { min: 1, max: 180 })
  eq(r.value, 35); eq(r.error, null)
})
test('accepts the boundary values 1 and 180', () => {
  eq(validateDurationInput('1', { min: 1, max: 180 }).value, 1)
  eq(validateDurationInput('180', { min: 1, max: 180 }).value, 180)
})

/* ── coerceDurationMinutes: legacy migration ──────────────────── */
test('passes an existing integer through unchanged', () => {
  eq(coerceDurationMinutes(20, { fallback: 20 }), 20)
})
test('reads a legacy numeric string', () => {
  eq(coerceDurationMinutes('40', { fallback: 20 }), 40)
})
test('reads a legacy "20 min" / "45 minutes" label to an integer', () => {
  eq(coerceDurationMinutes('20 min', { fallback: 5 }), 20)
  eq(coerceDurationMinutes('45 minutes', { fallback: 5 }), 45)
})
test('clamps out-of-range legacy values into [min,max]', () => {
  eq(coerceDurationMinutes(500, { min: 1, max: 180, fallback: 20 }), 180)
  eq(coerceDurationMinutes(-3, { min: 1, max: 180, fallback: 20 }), 1)
})
test('falls back for null / undefined / garbage', () => {
  eq(coerceDurationMinutes(null, { fallback: 15 }), 15)
  eq(coerceDurationMinutes(undefined, { fallback: 15 }), 15)
  eq(coerceDurationMinutes('none', { fallback: 15 }), 15)
})

/* ── normalizeBreaksMinutes / timing / day schedules ──────────── */
test('normalizeBreaksMinutes coerces every break to an integer, keeping other fields', () => {
  const legacy = [
    { event: 'assembly', name: 'ASSEMBLY', minutes: '15', time: '07:30' },
    { event: 'break', name: 'BREAK', minutes: '20 min', time: '09:30' },
    { event: 'lunch', name: 'LUNCH', minutes: 40, time: '11:30' },
    { event: 'closing', name: 'CLOSING', minutes: 'oops' },
  ]
  const out = normalizeBreaksMinutes(legacy)
  eq(out[0].minutes, 15)
  eq(out[1].minutes, 20)
  eq(out[2].minutes, 40)
  // Unparseable → the per-event default.
  eq(out[3].minutes, DEFAULT_EVENT_DURATIONS.closing)
  eq(out[1].time, '09:30', 'other fields preserved')
  assert(out !== legacy && out[0] !== legacy[0], 'returns fresh objects (no mutation)')
})
test('normalizeTimingBreaks migrates nested breaks', () => {
  const out = normalizeTimingBreaks({ startTime: '07:30', breaks: [{ event: 'break', minutes: '25' }] })
  eq(out.breaks[0].minutes, 25)
  eq(out.startTime, '07:30')
})
test('normalizeDaySchedulesBreaks migrates each day independently', () => {
  const out = normalizeDaySchedulesBreaks({
    Friday: { dayType: 'half', timing: { breaks: [{ event: 'lunch', minutes: '40 minutes' }] } },
    Monday: { dayType: 'full', timing: { breaks: [{ event: 'break', minutes: 20 }] } },
  })
  eq(out.Friday.timing.breaks[0].minutes, 40)
  eq(out.Monday.timing.breaks[0].minutes, 20)
  eq(out.Friday.dayType, 'half', 'day structure preserved')
})

/* ── durationLabelForEvent ────────────────────────────────────── */
test('labels the four canonical events', () => {
  eq(durationLabelForEvent('assembly'), 'Assembly duration')
  eq(durationLabelForEvent('break'), 'Break duration')
  eq(durationLabelForEvent('lunch'), 'Lunch duration')
  eq(durationLabelForEvent('closing'), 'Closing duration')
})
test('falls back to the block name for a future block type', () => {
  eq(durationLabelForEvent('prep', 'PREP'), 'Prep duration')
  eq(durationLabelForEvent('unknown', ''), 'Duration')
})

/* ── summary ──────────────────────────────────────────────────── */
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
