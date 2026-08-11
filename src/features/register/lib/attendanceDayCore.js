/**
 * attendanceDayCore — pure logic for one attendance-day document
 * (classRegisters/{classId}/attendance/{YYYY-MM-DD}).
 *
 * Everything Firestore-free lives here (validation gates, record diffs for the
 * audit trail, mark-all-present, three-way merge for concurrent editors) so
 * scripts/test-attendance-day-core.mjs covers it under plain node. The I/O
 * shim is attendanceService.js.
 */

import { isValidStatus, REGISTER_STATES } from '../../../utils/attendanceConstants.js'
import { isLearnerEligibleOn } from '../../../utils/attendanceCalculator.js'

export const ATTENDANCE_NOTE_MAX = 200

export function sanitizeNote(note) {
  if (note == null) return ''
  return String(note).slice(0, ATTENDANCE_NOTE_MAX)
}

/** Normalise one learner record; returns null for an invalid status. */
export function normalizeRecord(record) {
  if (!record || !isValidStatus(record.status)) return null
  return { status: record.status, note: sanitizeNote(record.note) }
}

// ── validation gates ─────────────────────────────────────────────

/**
 * Whether the register can be marked for `day` at all.
 * Returns { allowed, reason } — reason ∈ 'no_day' | 'outside_term' | 'future'
 * | 'non_teaching' | 'locked' | 'ok'. UI copy maps off the reason.
 */
export function canMarkDay({ day, termInfo, termState }) {
  if (!day?.date) return { allowed: false, reason: 'no_day' }
  if (termInfo && (day.date < termInfo.startDate || day.date > termInfo.endDate)) {
    return { allowed: false, reason: 'outside_term' }
  }
  if (day.isFuture) return { allowed: false, reason: 'future' }
  if (!day.markable) return { allowed: false, reason: 'non_teaching' }
  const editable = REGISTER_STATES[termState || 'draft']?.editable
  if (!editable) return { allowed: false, reason: 'locked' }
  return { allowed: true, reason: 'ok' }
}

/** Whether one learner may be marked on a date (enrolment window). */
export function canMarkLearner({ learner, date, termInfo }) {
  if (!learner) return false
  return isLearnerEligibleOn(learner, date, { startDate: termInfo?.startDate, endDate: termInfo?.endDate })
}

/** Roster entries markable on a date: enrolled that day (any status — history stays editable). */
export function markableLearnersOn(roster, date, termInfo) {
  return (roster || []).filter((l) => canMarkLearner({ learner: l, date, termInfo }))
}

// ── record mutations ─────────────────────────────────────────────

/**
 * Mark-all-present: returns the per-learner changes map for every eligible
 * learner who is NOT yet marked. Never overwrites an existing mark, so a
 * teacher who marked two absences first doesn't lose them.
 */
export function buildMarkAllPresent({ roster, records, date, termInfo }) {
  const changes = {}
  for (const learner of markableLearnersOn(roster, date, termInfo)) {
    if ((learner.status || 'active') !== 'active') continue
    if (records?.[learner.id]?.status) continue
    changes[learner.id] = { status: 'present', note: records?.[learner.id]?.note || '' }
  }
  return changes
}

/**
 * Audit-trail diff between two record maps. Returns one entry per learner
 * whose status or note changed:
 *   { learnerId, prevStatus, newStatus, prevNote, newNote }
 */
export function diffRecords(prevRecords, nextRecords) {
  const entries = []
  const ids = new Set([...Object.keys(prevRecords || {}), ...Object.keys(nextRecords || {})])
  for (const learnerId of ids) {
    const prev = prevRecords?.[learnerId] || null
    const next = nextRecords?.[learnerId] || null
    const prevStatus = prev?.status || null
    const newStatus = next?.status || null
    const prevNote = sanitizeNote(prev?.note)
    const newNote = sanitizeNote(next?.note)
    if (prevStatus === newStatus && prevNote === newNote) continue
    entries.push({ learnerId, prevStatus, newStatus, prevNote, newNote })
  }
  return entries
}

/**
 * Three-way merge for concurrent editors of the same day.
 *
 * `base`   — the server records this client last saw,
 * `server` — the records currently in Firestore,
 * `local`  — the learner records this client wants to write (only touched ids).
 *
 * Per-learner granularity: the result starts from `server` (keeping everything
 * another teacher marked) and applies this client's touched learners on top —
 * an explicit tap the teacher just made always wins for that learner. Learners
 * where BOTH sides changed away from base are reported as conflicts so the UI
 * can tell the teacher another device edited the same rows.
 */
export function mergeDayRecords({ base = {}, server = {}, local = {} }) {
  const merged = { ...server }
  const conflicts = []
  for (const [learnerId, record] of Object.entries(local)) {
    const clean = normalizeRecord(record)
    if (!clean) continue
    const baseRec = base[learnerId] || null
    const serverRec = server[learnerId] || null
    const serverChanged =
      (baseRec?.status || null) !== (serverRec?.status || null) ||
      sanitizeNote(baseRec?.note) !== sanitizeNote(serverRec?.note)
    const differsFromServer =
      clean.status !== (serverRec?.status || null) || clean.note !== sanitizeNote(serverRec?.note)
    if (serverChanged && differsFromServer) conflicts.push(learnerId)
    merged[learnerId] = clean
  }
  return { merged, conflicts }
}

/** Strip metadata down to { status, note } pairs for diffing/merging. */
export function plainRecords(records) {
  const out = {}
  for (const [learnerId, record] of Object.entries(records || {})) {
    const clean = normalizeRecord(record)
    if (clean) out[learnerId] = clean
  }
  return out
}
