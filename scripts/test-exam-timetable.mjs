#!/usr/bin/env node
/**
 * Tests for the exam-timetable data + pure logic behind /timetable.
 * Run: npm run test:exam-timetable
 *
 * Covers: seed/fallback data validity (parseable +02:00 datetimes, ordering,
 * curriculum id mapping), session status boundaries, season phases, progress,
 * search, wall-clock formatting (device-timezone-proof), countdown/hms, and
 * the in-app reminder due/dismissed logic.
 */

import { PSLE_2026, FALLBACK_TIMETABLES } from '../src/config/examTimetable2026.js'
import { SUBJECT_MAP, PAPER_SUBJECTS } from '../src/config/curriculum.js'
import {
  STATUS,
  PHASE,
  lusakaDateString,
  getSessionStatus,
  getSeasonPhase,
  listSessions,
  getCurrentSession,
  getNextSession,
  computeProgress,
  filterTimetable,
  formatSessionTime,
  formatDayHeading,
  countdownParts,
  hms,
  sessionLabel,
  validateTimetable,
  REMINDER_OFFSETS,
  reminderStorageKey,
  getDueReminders,
} from '../src/utils/examTimetableLogic.js'

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
  if (!cond) throw new Error(msg)
}

const T = (iso) => Date.parse(iso)
const PAPER_SUBJECT_IDS = new Set(PAPER_SUBJECTS.map((s) => s.id))

// ── Seed / fallback data validity ──────────────────────────────────────────

test('fallback list contains the 2026 PSLE timetable', () => {
  assert(FALLBACK_TIMETABLES.includes(PSLE_2026), 'PSLE_2026 missing from FALLBACK_TIMETABLES')
  assert(PSLE_2026.id === 'g7-2026' && PSLE_2026.grade === 7 && PSLE_2026.year === 2026, 'bad identity fields')
})

test('every session datetime parses, carries +02:00, and end > start', () => {
  for (const day of PSLE_2026.days) {
    for (const s of day.sessions) {
      assert(s.start.endsWith('+02:00'), `${s.key} start missing +02:00`)
      assert(s.end.endsWith('+02:00'), `${s.key} end missing +02:00`)
      const start = T(s.start)
      const end = T(s.end)
      assert(Number.isFinite(start) && Number.isFinite(end), `${s.key} unparseable`)
      assert(end > start, `${s.key} end not after start`)
      assert(s.start.slice(0, 10) === day.date, `${s.key} start date != day.date`)
    }
  }
})

test('days and sessions are chronologically ordered', () => {
  const sessions = listSessions(PSLE_2026)
  for (let i = 1; i < sessions.length; i++) {
    assert(T(sessions[i].start) > T(sessions[i - 1].start), `session ${sessions[i].key} out of order`)
  }
  assert(T(PSLE_2026.startsAt) === T(sessions[0].start), 'startsAt != first session start')
  assert(T(PSLE_2026.endsAt) === T(sessions[sessions.length - 1].end), 'endsAt != last session end')
})

test('every non-null subjectId / paperSubjectId maps to the curriculum', () => {
  for (const s of listSessions(PSLE_2026)) {
    for (const p of s.papers) {
      if (p.subjectId != null) assert(SUBJECT_MAP[p.subjectId], `${p.name}: unknown subjectId ${p.subjectId}`)
      if (p.paperSubjectId != null) {
        assert(PAPER_SUBJECT_IDS.has(p.paperSubjectId), `${p.name}: unknown paperSubjectId ${p.paperSubjectId}`)
      }
    }
  }
})

test('validateTimetable accepts the fallback and normalizes string grades', () => {
  const ok = validateTimetable({ ...PSLE_2026, grade: '7', year: '2026' })
  assert(ok && ok.grade === 7 && ok.year === 2026 && ok.active === true, 'normalization failed')
})

test('validateTimetable rejects malformed docs', () => {
  assert(validateTimetable(null) === null, 'null accepted')
  assert(validateTimetable({}) === null, 'empty accepted')
  assert(validateTimetable({ ...PSLE_2026, days: [] }) === null, 'empty days accepted')
  const badStart = structuredClone(PSLE_2026)
  badStart.days[1].sessions[0].start = 'not-a-date'
  assert(validateTimetable(badStart) === null, 'unparseable start accepted')
  const inverted = structuredClone(PSLE_2026)
  inverted.days[1].sessions[0].end = inverted.days[1].sessions[0].start
  assert(validateTimetable(inverted) === null, 'end <= start accepted')
})

// ── Session status boundaries (eng-p1: 2026-10-27 08:00–09:30 +02:00) ─────

const ENG = PSLE_2026.days[1].sessions[0]
const ENG_START = T('2026-10-27T08:00:00+02:00')
const ENG_END = T('2026-10-27T09:30:00+02:00')

test('status: UPCOMING on an earlier Lusaka day', () => {
  // 23:30 Lusaka on the 26th — still the previous wall-clock day.
  assert(getSessionStatus(ENG, T('2026-10-26T23:30:00+02:00')) === STATUS.UPCOMING, 'expected UPCOMING')
})

test('status: TODAY once the Lusaka date matches (even just after midnight)', () => {
  assert(getSessionStatus(ENG, T('2026-10-27T00:30:00+02:00')) === STATUS.TODAY, 'expected TODAY at 00:30')
  assert(getSessionStatus(ENG, ENG_START - 1) === STATUS.TODAY, 'expected TODAY 1ms before start')
})

test('status: IN_PROGRESS from start up to (not including) end', () => {
  assert(getSessionStatus(ENG, ENG_START) === STATUS.IN_PROGRESS, 'expected IN_PROGRESS at start')
  assert(getSessionStatus(ENG, ENG_END - 1) === STATUS.IN_PROGRESS, 'expected IN_PROGRESS 1ms before end')
})

test('status: COMPLETED at end', () => {
  assert(getSessionStatus(ENG, ENG_END) === STATUS.COMPLETED, 'expected COMPLETED at end')
})

test('status: ARCHIVED overrides everything', () => {
  assert(getSessionStatus(ENG, ENG_START, { archived: true }) === STATUS.ARCHIVED, 'expected ARCHIVED')
})

test('status maths is device-timezone-proof (epoch in, status out)', () => {
  // The same absolute instant expressed in three different offsets.
  const a = T('2026-10-27T08:30:00+02:00')
  const b = T('2026-10-27T06:30:00Z')
  const c = T('2026-10-27T01:30:00-05:00')
  assert(a === b && b === c, 'instants differ')
  assert(getSessionStatus(ENG, a) === STATUS.IN_PROGRESS, 'expected IN_PROGRESS')
})

// ── Season phase ───────────────────────────────────────────────────────────

test('phase boundaries: BEFORE / DURING / AFTER', () => {
  const startsAt = T(PSLE_2026.startsAt)
  const endsAt = T(PSLE_2026.endsAt)
  assert(getSeasonPhase(PSLE_2026, startsAt - 1) === PHASE.BEFORE, 'expected BEFORE')
  assert(getSeasonPhase(PSLE_2026, startsAt) === PHASE.DURING, 'expected DURING at startsAt')
  assert(getSeasonPhase(PSLE_2026, endsAt) === PHASE.DURING, 'expected DURING at endsAt')
  assert(getSeasonPhase(PSLE_2026, endsAt + 1) === PHASE.AFTER, 'expected AFTER')
})

test('phase: an evening between exam days is DURING', () => {
  assert(getSeasonPhase(PSLE_2026, T('2026-10-27T18:00:00+02:00')) === PHASE.DURING, 'expected DURING')
})

// ── Current / next session, progress ───────────────────────────────────────

test('getCurrentSession finds the running session (else null)', () => {
  assert(getCurrentSession(PSLE_2026, T('2026-10-27T08:30:00+02:00'))?.key === 'eng-p1', 'expected eng-p1')
  assert(getCurrentSession(PSLE_2026, T('2026-10-27T10:00:00+02:00')) === null, 'expected null in the gap')
})

test('getNextSession is the earliest unstarted session', () => {
  assert(getNextSession(PSLE_2026, T(PSLE_2026.startsAt) - 1)?.key === 'briefing', 'expected briefing')
  assert(getNextSession(PSLE_2026, T('2026-10-27T09:00:00+02:00'))?.key === 'sci-p1', 'expected sci-p1')
  assert(getNextSession(PSLE_2026, T(PSLE_2026.endsAt)) === null, 'expected null after last start')
})

test('computeProgress counts only paper sessions (briefing excluded)', () => {
  assert(computeProgress(PSLE_2026, T(PSLE_2026.startsAt) - 1).total === 8, 'expected 8 paper sessions')
  assert(computeProgress(PSLE_2026, T(PSLE_2026.startsAt) - 1).completed === 0, 'expected 0 before')
  // Briefing over, no papers written yet → still 0.
  assert(computeProgress(PSLE_2026, T('2026-10-26T12:00:00+02:00')).completed === 0, 'briefing counted')
  const tueEvening = computeProgress(PSLE_2026, T('2026-10-27T18:00:00+02:00'))
  assert(tueEvening.completed === 2 && tueEvening.pct === 25, 'expected 2/8 after Tuesday')
  const done = computeProgress(PSLE_2026, T(PSLE_2026.endsAt) + 1)
  assert(done.completed === 8 && done.pct === 100, 'expected 8/8 after season')
})

// ── Search ────────────────────────────────────────────────────────────────

test('filterTimetable matches names and codes, case-insensitively', () => {
  const math = filterTimetable(PSLE_2026, 'MATH')
  assert(math.days.length === 1 && math.days[0].sessions.length === 1, 'math filter wrong shape')
  assert(math.days[0].sessions[0].key === 'math-p1', 'expected math-p1')
  const icibemba = filterTimetable(PSLE_2026, '5/2')
  assert(icibemba.days.length === 1 && icibemba.days[0].sessions[0].key === 'zl', 'code search failed')
  const guide = filterTimetable(PSLE_2026, 'guidelines')
  assert(guide.days[0]?.sessions[0]?.key === 'briefing', 'briefing title search failed')
})

test('filterTimetable: blank query is identity, no-match prunes all days', () => {
  assert(filterTimetable(PSLE_2026, '  ') === PSLE_2026, 'blank query should return input')
  assert(filterTimetable(PSLE_2026, 'zzzz').days.length === 0, 'expected no days')
})

// ── Formatting ────────────────────────────────────────────────────────────

test('formatSessionTime slices official Lusaka wall time from the ISO string', () => {
  assert(formatSessionTime(ENG) === '08:00 – 09:30', `got ${formatSessionTime(ENG)}`)
})

test('formatDayHeading names the weekday from the date string alone', () => {
  assert(formatDayHeading('2026-10-27') === 'Tuesday, 27 October', `got ${formatDayHeading('2026-10-27')}`)
  assert(formatDayHeading('2026-10-30') === 'Friday, 30 October', `got ${formatDayHeading('2026-10-30')}`)
})

test('lusakaDateString shifts the UTC instant by +02:00', () => {
  assert(lusakaDateString(T('2026-10-26T22:30:00Z')) === '2026-10-27', 'expected next Lusaka day')
  assert(lusakaDateString(T('2026-10-26T21:30:00Z')) === '2026-10-26', 'expected same Lusaka day')
})

test('sessionLabel: briefing title, single paper name, joined alternatives', () => {
  assert(sessionLabel(PSLE_2026.days[0].sessions[0]) === 'Guidelines to candidates and invigilators', 'briefing label')
  assert(sessionLabel(ENG) === 'English Language', 'single label')
  assert(sessionLabel(PSLE_2026.days[4].sessions[0]).includes(' / '), 'alternatives label')
})

test('countdownParts matches the dashboard card maths', () => {
  const now = ENG_START - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000
  const parts = countdownParts(ENG_START, now)
  assert(!parts.over, 'should not be over')
  assert(parts.days === 2 && parts.hours === 3 && parts.minutes === 4 && parts.seconds === 5, 'wrong parts')
  assert(countdownParts(ENG_START, ENG_START).over === true, 'expected over at target')
})

test('hms pads and clamps', () => {
  assert(hms(0) === '00:00:00', 'zero')
  assert(hms(-5000) === '00:00:00', 'negative clamps')
  assert(hms((1 * 3600 + 15 * 60 + 20) * 1000) === '01:15:20', 'padding')
})

// ── Reminders ─────────────────────────────────────────────────────────────

test('reminder offsets are the four product options', () => {
  assert(REMINDER_OFFSETS.map((o) => o.id).join(',') === '7d,1d,1h,30m', 'offset ids changed')
})

test('reminderStorageKey is uid + timetable scoped', () => {
  assert(reminderStorageKey('u1', 'g7-2026') === 'zx_exam_reminders_u1_g7-2026', 'key shape')
  assert(reminderStorageKey(null, 'g7-2026') === 'zx_exam_reminders_anon_g7-2026', 'anon fallback')
})

test('getDueReminders: due window, urgency order, dismissal, unselected offsets', () => {
  // 20:00 Lusaka the evening before the first papers: the 1d reminders for
  // both Tuesday sessions have fired; nothing else has.
  const now = T('2026-10-26T20:00:00+02:00')
  const due = getDueReminders(PSLE_2026, { offsets: ['1d'] }, now)
  assert(due.length === 2, `expected 2 due, got ${due.length}`)
  assert(due[0].session.key === 'eng-p1', 'soonest exam should be first')
  assert(due[0].key === 'g7-2026:eng-p1@1d', `key shape: ${due[0].key}`)

  const dismissed = getDueReminders(
    PSLE_2026,
    { offsets: ['1d'], dismissed: { 'g7-2026:eng-p1@1d': true } },
    now,
  )
  assert(dismissed.length === 1 && dismissed[0].session.key === 'sci-p1', 'dismissal not honoured')

  assert(getDueReminders(PSLE_2026, { offsets: [] }, now).length === 0, 'no offsets → none due')
  assert(getDueReminders(PSLE_2026, null, now).length === 0, 'null prefs → none due')

  // Once a session has started, its reminders stop showing.
  const started = getDueReminders(PSLE_2026, { offsets: ['1d', '1h', '30m'] }, ENG_START)
  assert(started.every((r) => r.session.key !== 'eng-p1'), 'started session still reminding')
})

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.error(`FAIL ${f.name}: ${f.message}`)
  process.exit(1)
}
