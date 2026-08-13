/**
 * examTimetableLogic — pure helpers behind the /timetable exam hub.
 *
 * No React, no Firebase: everything here runs under plain `node` in
 * scripts/test-exam-timetable.mjs. The page (features/examTimetable/) supplies
 * `nowMs` from a ticking clock and renders whatever these functions return.
 *
 * Timezone contract: timetable datetimes are ISO strings with an explicit
 * +02:00 offset (Africa/Lusaka, no DST — see config/examTimetable2026.js).
 *   - Anything COMPARED (status, phase, countdowns) uses Date.parse epochs,
 *     which are absolute instants and therefore device-timezone-proof.
 *   - Anything DISPLAYED as a wall-clock time slices the ISO string
 *     directly (start.slice(11, 16)) so a learner whose phone is set to
 *     another timezone still sees the official Lusaka session times.
 */

export const STATUS = {
  UPCOMING: 'upcoming',
  NEXT: 'next',
  TODAY: 'today',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
}

export const PHASE = {
  BEFORE: 'before',
  DURING: 'during',
  AFTER: 'after',
}

const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000

// "YYYY-MM-DD" for the given instant as seen on a Lusaka wall clock.
export function lusakaDateString(nowMs) {
  return new Date(nowMs + LUSAKA_OFFSET_MS).toISOString().slice(0, 10)
}

// Status of one session at one instant. `archived` marks every session of a
// non-active-year timetable regardless of its times. Pass `nextKey` (the key
// of the next paper session, from getNextPaperSession) to have that one
// session read NEXT instead of UPCOMING — TODAY still wins, so an exam later
// today never demotes to a plain "Next".
export function getSessionStatus(session, nowMs, { archived = false, nextKey = null } = {}) {
  if (archived) return STATUS.ARCHIVED
  const start = Date.parse(session.start)
  const end = Date.parse(session.end)
  if (nowMs >= end) return STATUS.COMPLETED
  if (nowMs >= start) return STATUS.IN_PROGRESS
  if (session.start.slice(0, 10) === lusakaDateString(nowMs)) return STATUS.TODAY
  if (nextKey && session.key === nextKey) return STATUS.NEXT
  return STATUS.UPCOMING
}

// Where the whole season sits: BEFORE the first moment, AFTER the last paper
// ends, DURING everything in between (including evenings between exam days).
export function getSeasonPhase(timetable, nowMs) {
  if (nowMs < Date.parse(timetable.startsAt)) return PHASE.BEFORE
  if (nowMs > Date.parse(timetable.endsAt)) return PHASE.AFTER
  return PHASE.DURING
}

// All sessions in chronological order (the stored days/sessions are already
// ordered; this just flattens them).
export function listSessions(timetable) {
  return (timetable?.days || []).flatMap((day) => day.sessions || [])
}

// The session running right now, or null.
export function getCurrentSession(timetable, nowMs) {
  return (
    listSessions(timetable).find(
      (s) => Date.parse(s.start) <= nowMs && nowMs < Date.parse(s.end),
    ) || null
  )
}

// The earliest session that has not started yet, or null once all have.
export function getNextSession(timetable, nowMs) {
  return listSessions(timetable).find((s) => Date.parse(s.start) > nowMs) || null
}

// The earliest PAPER session that has not started yet (the briefing day is
// shown in the list but is never "the next exam"), or null once all have.
export function getNextPaperSession(timetable, nowMs) {
  return (
    listSessions(timetable).find(
      (s) => (s.papers || []).length > 0 && Date.parse(s.start) > nowMs,
    ) || null
  )
}

// Which day groups start expanded: today's exam day (if any) plus the day of
// the next upcoming paper. Every other day collapses to one tappable row —
// during the season a learner sees at most two open days instead of five.
export function getDefaultExpandedDates(timetable, nowMs) {
  const dates = new Set()
  const today = lusakaDateString(nowMs)
  if ((timetable?.days || []).some((d) => d.date === today)) dates.add(today)
  const next = getNextPaperSession(timetable, nowMs)
  if (next) dates.add(next.start.slice(0, 10))
  return dates
}

// Paper-writing progress. The briefing day carries no papers, so it counts
// toward neither total nor completed — "3 of 8 papers written".
export function computeProgress(timetable, nowMs) {
  const paperSessions = listSessions(timetable).filter((s) => (s.papers || []).length > 0)
  const completed = paperSessions.filter((s) => nowMs >= Date.parse(s.end)).length
  const total = paperSessions.length
  return { completed, total, pct: total ? Math.round((completed / total) * 100) : 0 }
}

// Case-insensitive search across the timetable. Matches paper names, paper
// codes, the briefing title, AND the day's date (ISO "2026-10-27" or the
// human "Tuesday, 27 October" heading) — so a learner can search a subject,
// a paper number, a Zambian language, a special paper, or a date. Returns a
// copy of the timetable with non-matching sessions (and then empty days)
// pruned; a day whose date matches keeps all of its sessions. An empty/blank
// query returns the input as-is.
export function filterTimetable(timetable, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q || !timetable) return timetable
  const dayMatches = (day) =>
    (day.date || '').toLowerCase().includes(q) ||
    formatDayHeading(day.date).toLowerCase().includes(q)
  const sessionMatches = (session) =>
    (session.title || '').toLowerCase().includes(q) ||
    (session.papers || []).some(
      (p) => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q),
    )
  const days = (timetable.days || [])
    .map((day) =>
      dayMatches(day) ? day : { ...day, sessions: (day.sessions || []).filter(sessionMatches) },
    )
    .filter((day) => day.sessions.length > 0)
  return { ...timetable, days }
}

// The three status buckets the timeline filter chips offer. A session's live
// status collapses to one of them (or null for a briefing, which no chip
// claims): NEXT reads as "upcoming", IN_PROGRESS as "today".
export const STATUS_BUCKET = { TODAY: 'today', UPCOMING: 'upcoming', COMPLETED: 'completed' }

export function statusBucket(status) {
  if (status === STATUS.TODAY || status === STATUS.IN_PROGRESS) return STATUS_BUCKET.TODAY
  if (status === STATUS.UPCOMING || status === STATUS.NEXT) return STATUS_BUCKET.UPCOMING
  if (status === STATUS.COMPLETED) return STATUS_BUCKET.COMPLETED
  return null
}

// How many sessions fall in each bucket right now — drives the filter chips
// (a chip is only worth showing when it would actually match something, and
// the chip row is only worth showing when it would partition the list).
export function statusBucketCounts(timetable, nowMs) {
  const counts = { all: 0, today: 0, upcoming: 0, completed: 0 }
  for (const s of listSessions(timetable)) {
    counts.all += 1
    const b = statusBucket(getSessionStatus(s, nowMs))
    if (b) counts[b] += 1
  }
  return counts
}

// Prune the timetable to the sessions in one status bucket ('today' /
// 'upcoming' / 'completed'); 'all' or a falsy bucket returns the input as-is.
// Composes with filterTimetable (search first, then status, order-independent).
export function filterTimetableByStatus(timetable, bucket, nowMs) {
  if (!timetable || !bucket || bucket === 'all') return timetable
  const days = (timetable.days || [])
    .map((day) => ({
      ...day,
      sessions: (day.sessions || []).filter(
        (s) => statusBucket(getSessionStatus(s, nowMs)) === bucket,
      ),
    }))
    .filter((day) => day.sessions.length > 0)
  return { ...timetable, days }
}

// "08:00 – 09:30" from the stored ISO strings (wall-clock slice, never local
// Date getters — see the timezone contract above).
export function formatSessionTime(session) {
  return `${session.start.slice(11, 16)} – ${session.end.slice(11, 16)}`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// "Tuesday, 27 October" from a "YYYY-MM-DD" day date. Parsed as UTC midnight
// and read back with UTC getters so the device timezone can't shift the day.
export function formatDayHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

// Whole days/hours/minutes/seconds until target — same maths as the dashboard
// card (GradeHub.jsx getCountdownParts) so the two countdowns always agree.
export function countdownParts(targetMs, nowMs) {
  const diff = targetMs - nowMs
  if (diff <= 0) return { over: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  const totalSeconds = Math.floor(diff / 1000)
  return {
    over: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

// "HH:MM:SS" (zero-padded, clamped at 0) for the live in-progress timer.
export function hms(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// Display label for a session: the briefing title, a single paper's name, or
// the alternatives joined ("Technology Studies / Home Economics …").
export function sessionLabel(session) {
  if (session.briefing) return session.title || 'Briefing'
  const names = (session.papers || []).map((p) => p.name)
  if (names.length <= 1) return names[0] || 'Examination'
  return names.join(' / ')
}

// Structural check for a Firestore doc (or the fallback). Returns a
// normalized timetable or null so the hook can discard malformed docs and
// fall back rather than crash the page.
export function validateTimetable(doc) {
  if (!doc || typeof doc !== 'object') return null
  const grade = parseInt(doc.grade, 10)
  const year = parseInt(doc.year, 10)
  if (!Number.isFinite(grade) || !Number.isFinite(year)) return null
  if (!doc.id || !doc.examName) return null
  if (!Number.isFinite(Date.parse(doc.startsAt)) || !Number.isFinite(Date.parse(doc.endsAt))) return null
  if (!Array.isArray(doc.days) || doc.days.length === 0) return null
  for (const day of doc.days) {
    if (!day || typeof day.date !== 'string' || !Array.isArray(day.sessions)) return null
    for (const session of day.sessions) {
      if (!session || !session.key) return null
      const start = Date.parse(session.start)
      const end = Date.parse(session.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
      if (!Array.isArray(session.papers)) return null
      for (const paper of session.papers) {
        if (!paper || typeof paper.name !== 'string' || !paper.name) return null
      }
    }
  }
  return { ...doc, grade, year, active: doc.active === true }
}

// ── In-app reminders (v1: localStorage prefs + banners on the page) ────────

export const REMINDER_OFFSETS = [
  { id: '7d', ms: 7 * 24 * 60 * 60 * 1000, label: '7 days before' },
  { id: '1d', ms: 24 * 60 * 60 * 1000, label: '1 day before' },
  { id: '1h', ms: 60 * 60 * 1000, label: '1 hour before' },
  { id: '30m', ms: 30 * 60 * 1000, label: '30 minutes before' },
]

export function reminderStorageKey(uid, timetableId) {
  return `zx_exam_reminders_${uid || 'anon'}_${timetableId}`
}

// Master switch. Prefs stored before the switch existed have no `enabled`
// field — for those, having any offset selected means reminders were in use.
export function remindersEnabled(prefs) {
  if (!prefs) return false
  if (prefs.enabled === undefined) return (prefs.offsets || []).length > 0
  return prefs.enabled === true
}

/**
 * Reminders that should be showing right now.
 *
 * prefs: { enabled: true, offsets: ['1d', '1h', ...], dismissed: { '<key>': true } }
 * A reminder for (session, offset) is due when reminders are enabled, its
 * fire moment has passed but the session hasn't started, the offset is
 * selected, and the learner hasn't dismissed that exact reminder. Keys are
 * stable ("g7-2026:eng-p1@1d") so a dismissal in localStorage silences
 * exactly one banner forever.
 */
export function getDueReminders(timetable, prefs, nowMs) {
  if (!remindersEnabled(prefs)) return []
  const offsets = new Set(prefs?.offsets || [])
  if (!timetable || offsets.size === 0) return []
  const dismissed = prefs?.dismissed || {}
  const due = []
  for (const session of listSessions(timetable)) {
    const start = Date.parse(session.start)
    if (nowMs >= start) continue
    for (const offset of REMINDER_OFFSETS) {
      if (!offsets.has(offset.id)) continue
      const fireAt = start - offset.ms
      if (fireAt > nowMs) continue
      const key = `${timetable.id}:${session.key}@${offset.id}`
      if (dismissed[key]) continue
      due.push({ key, session, offsetId: offset.id, offsetLabel: offset.label, fireAt })
    }
  }
  // Soonest exam first, so the most urgent banner tops the stack.
  return due.sort(
    (a, b) => Date.parse(a.session.start) - Date.parse(b.session.start) || a.fireAt - b.fireAt,
  )
}
