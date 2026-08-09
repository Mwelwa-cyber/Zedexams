/**
 * School sessions (shifts) — the piece of Zambian school reality the Class
 * Timetable Studio was missing.
 *
 * Free education pushed government-school enrolment to 80–100 learners per
 * class, so schools split a grade into SESSIONS. A large school runs two
 * (morning ≈ 07:00–12:40, afternoon ≈ 12:40–16:00); a smaller one runs
 * three (morning, mid-morning, afternoon). A class in an afternoon session
 * reports at 12:40 and knocks off at 16:50 — perfectly normal, and the
 * studio must not warn about it.
 *
 * The consequence that matters most is arithmetic, not cosmetic: a shift
 * session CANNOT hold the official 28 h / 42-period week. An afternoon
 * session yields roughly 19–20 h. That shortfall is a system constraint the
 * teacher cannot fix, so coverage for a shift is measured against the
 * SESSION'S OWN CAPACITY (see timetableCoverage.js) — never as a deficit.
 *
 * Pure and DOM-free so `node` can unit test it
 * (scripts/test-timetable-sessions.mjs).
 */

/**
 * The sessions a school can run. `defaults` seed the School day step's
 * report/knock-off times — every value stays editable afterwards.
 *
 * `shift: true` marks a session that is, by construction, a slice of the
 * school day: its capacity is expected to fall short of the full curriculum
 * week and coverage is measured against the session instead.
 */
export const SCHOOL_SESSIONS = [
  {
    id: 'full',
    label: 'Full day',
    shift: false,
    description: 'One session for the whole day — the class reports in the morning and knocks off in the afternoon.',
    defaults: { startTime: '07:30', endTime: '15:30' },
  },
  {
    id: 'morning',
    label: 'Morning',
    shift: true,
    description: 'The morning session of a two- or three-session school.',
    defaults: { startTime: '07:00', endTime: '12:40' },
  },
  {
    id: 'mid-morning',
    label: 'Mid-morning',
    shift: true,
    description: 'The middle session of a three-session school, between the morning and afternoon shifts.',
    defaults: { startTime: '09:50', endTime: '14:30' },
  },
  {
    id: 'afternoon',
    label: 'Afternoon',
    shift: true,
    description: 'The afternoon session of a two- or three-session school.',
    defaults: { startTime: '12:40', endTime: '16:00' },
  },
  {
    id: 'custom',
    label: 'Custom',
    shift: false,
    description: 'Your own session window — set the report and knock-off times yourself.',
    defaults: null,
  },
]

export const DEFAULT_SESSION_ID = 'full'

export function getSession(sessionId) {
  return SCHOOL_SESSIONS.find((s) => s.id === sessionId) || null
}

export function sessionLabel(sessionId) {
  return getSession(sessionId)?.label || 'Full day'
}

/** The report/knock-off times a session seeds, or null for Full day/Custom
 * where the teacher's existing times are kept. */
export function sessionDefaults(sessionId) {
  return getSession(sessionId)?.defaults || null
}

/**
 * Is this a SHIFT session — one slice of a multi-session school day?
 *
 * The whole point of the flag: a shift's coverage target is its own
 * capacity, so no deficit is ever reported against the 28-hour curriculum
 * week the session physically cannot hold.
 */
export function isShiftSession(sessionId) {
  return getSession(sessionId)?.shift === true
}

/**
 * Whether the knock-off readout should warn.
 *
 * Session-aware by construction: the comparison is always against the
 * SESSION'S OWN target knock-off, never a hard-coded morning-school
 * assumption. An afternoon session ending 16:50 against a 16:50 target is
 * `ok`; the same 16:50 against a 16:00 target is `over` — the number the
 * teacher set is the only thing that decides.
 *
 * @returns {{ status:'ok'|'over'|'under'|'unknown', deltaMinutes:number|null }}
 */
export function knockOffStatus({ targetEndTime, actualEndTime, timeToMinutes }) {
  if (!targetEndTime || !actualEndTime || typeof timeToMinutes !== 'function') {
    return { status: 'unknown', deltaMinutes: null }
  }
  const delta = timeToMinutes(actualEndTime) - timeToMinutes(targetEndTime)
  if (delta > 0) return { status: 'over', deltaMinutes: delta }
  if (delta < 0) return { status: 'under', deltaMinutes: delta }
  return { status: 'ok', deltaMinutes: 0 }
}

/** The one-line note a shift session shows once, instead of a deficit
 * warning nobody can act on. */
export const SHIFT_COVERAGE_NOTE =
  'Shift sessions hold less than the full curriculum week — Auto-fill prioritises for you.'
