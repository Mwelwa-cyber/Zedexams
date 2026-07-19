/**
 * Duration presets + safe coercion for timetable duration dropdowns.
 *
 * A single source of truth for the <DurationSelect> component and every
 * non-lesson timetable block that carries a duration in minutes (assembly,
 * break, lunch, closing, and any future block). Durations are ALWAYS stored
 * as integer minutes — never as formatted strings like "20 min". The helpers
 * here migrate any legacy value (a number, a numeric string, or an old
 * "20 min" label) back to a safe integer on read.
 *
 * Pure module (no React, no DOM) so it unit-tests under plain `node`.
 */

/** The preset minute values offered in the dropdown, in order. */
export const DURATION_PRESETS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60]

/** The sentinel <option> value that reveals the custom numeric input. */
export const CUSTOM_DURATION = 'custom'

/** Hard bounds for a custom duration (whole minutes only). */
export const CUSTOM_DURATION_MIN = 1
export const CUSTOM_DURATION_MAX = 180

/** Sensible per-event default durations (minutes). */
export const DEFAULT_EVENT_DURATIONS = {
  assembly: 15,
  break: 20,
  lunch: 40,
  closing: 10,
}

/** Is `minutes` exactly one of the preset values? */
export function isPresetDuration(minutes) {
  return DURATION_PRESETS.includes(Number(minutes))
}

/** "35 minutes" / "1 minute" — the human label for a duration. */
export function formatDuration(minutes) {
  const n = Number(minutes)
  if (!Number.isFinite(n)) return ''
  const whole = Math.trunc(n)
  return `${whole} ${whole === 1 ? 'minute' : 'minutes'}`
}

/**
 * Safely coerce ANY stored/legacy duration value to an integer number of
 * minutes, clamped to [min, max]. Accepts a number, a numeric string ("20"),
 * or a legacy formatted string ("20 min", "20 minutes") by reading the first
 * integer it contains. Returns `fallback` when nothing usable is present.
 *
 * This is the read-side migration: existing saved numeric values keep loading
 * unchanged, and legacy strings convert without ever surfacing "20 min" as a
 * value.
 */
export function coerceDurationMinutes(
  raw,
  { min = CUSTOM_DURATION_MIN, max = CUSTOM_DURATION_MAX, fallback } = {},
) {
  if (raw == null) return fallback
  let n
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string') {
    const match = raw.match(/-?\d+/)
    n = match ? Number(match[0]) : NaN
  } else {
    n = Number(raw)
  }
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

/**
 * Validate a teacher-typed custom duration. Returns `{ value, error }`:
 *   - a clean whole number in range → `{ value: <int>, error: null }`
 *   - empty / non-numeric / zero / negative / out of range → `{ value: null,
 *     error: '<message>' }`
 *
 * Kept pure and message-bearing so the component can announce the error to
 * screen readers (never colour alone) and so it unit-tests without a DOM.
 */
export function validateDurationInput(
  raw,
  { min = CUSTOM_DURATION_MIN, max = CUSTOM_DURATION_MAX } = {},
) {
  const text = String(raw ?? '').trim()
  if (text === '') return { value: null, error: 'Enter a duration in minutes.' }
  // Whole minutes only — reject decimals, letters, signs and stray characters.
  if (!/^\d+$/.test(text)) return { value: null, error: 'Enter a whole number of minutes.' }
  const n = Number(text)
  if (!Number.isFinite(n)) return { value: null, error: 'Enter a whole number of minutes.' }
  if (n < min) return { value: null, error: `Duration must be at least ${min} minute${min === 1 ? '' : 's'}.` }
  if (n > max) return { value: null, error: `Duration cannot be more than ${max} minutes.` }
  return { value: n, error: null }
}

/**
 * Migrate an array of break objects so every `minutes` field is a safe
 * integer. Used when loading a saved/draft timetable so legacy string
 * durations never reach the grid builder or the dropdown.
 */
export function normalizeBreaksMinutes(breaks) {
  if (!Array.isArray(breaks)) return breaks
  return breaks.map((b) => {
    if (!b || typeof b !== 'object') return b
    const fallback = DEFAULT_EVENT_DURATIONS[b.event] ?? DEFAULT_EVENT_DURATIONS.break
    return { ...b, minutes: coerceDurationMinutes(b.minutes, { fallback }) }
  })
}

/**
 * Migrate a whole timing object's breaks. No-op when there are none.
 */
export function normalizeTimingBreaks(timing) {
  if (!timing || typeof timing !== 'object' || !Array.isArray(timing.breaks)) return timing
  return { ...timing, breaks: normalizeBreaksMinutes(timing.breaks) }
}

/**
 * Migrate every day-specific schedule's breaks. A day with no timing/breaks is
 * passed through untouched. Preserves each day's other structure verbatim.
 */
export function normalizeDaySchedulesBreaks(daySchedules) {
  if (!daySchedules || typeof daySchedules !== 'object') return daySchedules
  const next = {}
  for (const [day, schedule] of Object.entries(daySchedules)) {
    next[day] = schedule && typeof schedule === 'object' && schedule.timing
      ? { ...schedule, timing: normalizeTimingBreaks(schedule.timing) }
      : schedule
  }
  return next
}

/**
 * The dropdown label for a schedule block, from its `event`
 * (e.g. "Assembly duration"). Falls back to the block's name for any future
 * non-lesson block type.
 */
export function durationLabelForEvent(event, name) {
  const known = {
    assembly: 'Assembly duration',
    break: 'Break duration',
    lunch: 'Lunch duration',
    closing: 'Closing duration',
  }
  if (known[event]) return known[event]
  const label = String(name || '').trim()
  if (label) {
    const titled = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()
    return `${titled} duration`
  }
  return 'Duration'
}
