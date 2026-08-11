/**
 * attendanceService — Firestore data access for the Class Register Studio.
 *
 * Collections (all under the existing teacher-owned register):
 *   classRegisters/{classId}/attendance/{YYYY-MM-DD}   one doc per class per date
 *     { classId, teacherUid, date, term, year, termId, classification,
 *       records: { [rosterId]: { status, note, updatedBy, updatedAt } },
 *       counts, markedBy, markedAt, updatedBy, updatedAt, version }
 *   classRegisters/{classId}/attendanceTerms/{termId}  per-term settings + lifecycle
 *     { classId, teacherUid, termId, term, year, state: draft|submitted|locked|reopened,
 *       policy?, dayOverrides?, customStartDate?, customEndDate?,
 *       submittedAt/By?, lockedAt/By?, reopenedAt/By?, reopenReason?, ... }
 *   classRegisters/{classId}/attendanceAudit/{autoId}  append-only change trail
 *
 * HARDENED 2026-07: day saves go through the saveClassAttendance CALLABLE
 * (functions/attendance/) — Firestore rules deny direct client writes to the
 * attendance subcollection, so the server is the only authority on term
 * resolution, locking, eligibility, statuses, counts and versioning. This
 * file keeps reads/subscriptions, term settings, lifecycle moves and the
 * (lifecycle-only) client audit writes.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'
import { sanitizeNote } from '../lib/attendanceDayCore'
import { ATTENDANCE_ERROR_MESSAGES, REGISTER_STATES } from '../../../utils/attendanceConstants'

const fns = getFunctions(app, 'us-central1')
const saveClassAttendanceCallable = httpsCallable(fns, 'saveClassAttendance')

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dayRef(classId, date) {
  return doc(db, 'classRegisters', classId, 'attendance', date)
}
function termRef(classId, termId) {
  return doc(db, 'classRegisters', classId, 'attendanceTerms', termId)
}
function auditCol(classId) {
  return collection(db, 'classRegisters', classId, 'attendanceAudit')
}

// ── attendance days ──────────────────────────────────────────────

/** Realtime subscription to one day's register. Emits null when unmarked. */
export function subscribeAttendanceDay(classId, date, onData, onError) {
  return onSnapshot(
    dayRef(classId, date),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => { if (onError) onError(err) },
  )
}

/** All saved day docs for a term, ordered by date. */
export async function listTermAttendance(classId, termId) {
  const snap = await getDocs(query(
    collection(db, 'classRegisters', classId, 'attendance'),
    where('termId', '==', termId),
  ))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Realtime subscription to every saved day in a term (feeds the term grid and
 * summaries). Equality filter only — no composite index needed; ordering is
 * client-side by date.
 */
export function subscribeTermAttendance(classId, termId, onData, onError) {
  return onSnapshot(
    query(collection(db, 'classRegisters', classId, 'attendance'), where('termId', '==', termId)),
    (snap) => onData(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? -1 : 1)),
    ),
    (err) => { if (onError) onError(err) },
  )
}

/** One-shot fetch of a single day (used to rebase after STALE_VERSION). */
export async function getAttendanceDay(classId, date) {
  const snap = await getDoc(dayRef(classId, date))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

// Structured error codes returned by the saveClassAttendance callable.
// Every UI surface maps codes → copy through ATTENDANCE_ERROR_MESSAGES.
// Declared in ./attendanceConstants.js (pure copy, no Firestore) and
// re-exported here so every existing caller keeps its import. Imported by
// name as well, because `export … from` creates no local binding and
// normalizeAttendanceError below reads the table.
export { ATTENDANCE_ERROR_MESSAGES }

/**
 * Normalise a callable failure to { code, details, offline }. Firebase
 * transport errors (offline, timeouts) become code 'NETWORK' so the outbox
 * keeps them queued instead of surfacing them as rejections.
 */
export function normalizeAttendanceError(err) {
  const details = err?.details && typeof err.details === 'object' ? err.details : {}
  const code = typeof details.code === 'string' && ATTENDANCE_ERROR_MESSAGES[details.code]
    ? details.code
    : (typeof err?.message === 'string' && ATTENDANCE_ERROR_MESSAGES[err.message] ? err.message : null)
  if (code) return { code, details, offline: false }
  // functions/unavailable, functions/deadline-exceeded, fetch failures…
  return { code: 'NETWORK', details: { raw: String(err?.code || err?.message || err) }, offline: true }
}

/**
 * Submit one day's changes to the AUTHORITATIVE server mutation
 * (functions/attendance/saveClassAttendance). The server resolves the term
 * from the date, verifies the submitted termId, checks the lock, teacher
 * assignment, per-learner eligibility and statuses, recomputes counts, and
 * rejects stale versions — nothing here is trusted from this client.
 *
 * `records` holds ONLY the learners this client changed
 * ({ [learnerId]: { status, note } }); `baseVersion` is the day-doc version
 * those changes were made against (0 when unmarked).
 *
 * Resolves { version, counts, termId, changed }; rejects with the raw
 * callable error (pass it to normalizeAttendanceError).
 */
export async function submitAttendanceDay({ classId, date, termId, baseVersion, records, reason, source }) {
  if (!ISO_DATE_RE.test(date)) throw new Error(`Invalid attendance date: ${date}`)
  const response = await saveClassAttendanceCallable({
    classId,
    date,
    termId,
    baseVersion: Number.isInteger(baseVersion) ? baseVersion : 0,
    records,
    reason: reason || '',
    source: source || 'web',
  })
  return response.data
}

// ── term settings + lifecycle ────────────────────────────────────

export async function getAttendanceTerm(classId, termId) {
  const snap = await getDoc(termRef(classId, termId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export function subscribeAttendanceTerm(classId, termId, onData, onError) {
  return onSnapshot(
    termRef(classId, termId),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => { if (onError) onError(err) },
  )
}

/**
 * Merge-write term settings (policy, dayOverrides, custom term dates,
 * warning threshold). Never changes `state` — lifecycle moves go through
 * setAttendanceTermState so they always leave an audit entry.
 */
export async function saveAttendanceTermSettings(classId, teacherUid, termMeta, patch) {
  const { state, ...safe } = patch || {}
  void state // lifecycle is not writable from here
  await setDoc(termRef(classId, termMeta.termId), {
    classId,
    teacherUid,
    termId: termMeta.termId,
    term: termMeta.term ?? '',
    year: termMeta.year ?? null,
    ...safe,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

const STATE_STAMPS = {
  submitted: { at: 'submittedAt', by: 'submittedBy' },
  locked: { at: 'lockedAt', by: 'lockedBy' },
  reopened: { at: 'reopenedAt', by: 'reopenedBy' },
}

/**
 * Move the term register through its lifecycle
 * (draft → submitted → locked → reopened). Reopening REQUIRES a reason; every
 * transition writes an append-only audit entry. Rule-level enforcement: once
 * locked, only an admin passes the update rule.
 */
export async function setAttendanceTermState(classId, uid, termMeta, { state, reason = '' } = {}) {
  if (!REGISTER_STATES[state]) throw new Error(`Unknown register state: ${state}`)
  if (state === 'reopened' && !reason.trim()) {
    throw new Error('A reason is required to reopen a locked register.')
  }
  const stamps = STATE_STAMPS[state]
  await setDoc(termRef(classId, termMeta.termId), {
    classId,
    teacherUid: termMeta.teacherUid || uid,
    termId: termMeta.termId,
    term: termMeta.term ?? '',
    year: termMeta.year ?? null,
    state,
    ...(state === 'reopened' ? { reopenReason: reason.trim() } : {}),
    ...(stamps ? { [stamps.at]: serverTimestamp(), [stamps.by]: uid } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true })
  await logAttendanceAudit(classId, uid, [{
    learnerId: null,
    prevStatus: null,
    newStatus: null,
    prevNote: '',
    newNote: '',
  }], {
    termId: termMeta.termId,
    date: null,
    action: `register_${state}`,
    reason: reason.trim(),
  })
}

// ── audit trail (append-only) ────────────────────────────────────

/**
 * Append audit entries for a set of record changes. Entries come from
 * attendanceDayCore.diffRecords; context carries { termId, date, action?,
 * reason?, source? }. Audit docs are create-only under the security rules —
 * neither teachers nor admins can update or delete them from the client.
 */
export async function logAttendanceAudit(classId, uid, entries, context = {}) {
  const list = (entries || []).filter(Boolean)
  if (!list.length) return
  const batch = writeBatch(db)
  for (const entry of list) {
    batch.set(doc(auditCol(classId)), {
      classId,
      teacherUid: context.teacherUid || uid,
      termId: context.termId || '',
      date: context.date || null,
      action: context.action || 'mark',
      reason: sanitizeNote(context.reason),
      source: context.source || 'web',
      learnerId: entry.learnerId ?? null,
      prevStatus: entry.prevStatus ?? null,
      newStatus: entry.newStatus ?? null,
      prevNote: sanitizeNote(entry.prevNote),
      newNote: sanitizeNote(entry.newNote),
      uid,
      at: serverTimestamp(),
    })
  }
  await batch.commit()
}

/** Audit entries for one date or one learner (owner/admin inspection). */
export async function listAttendanceAudit(classId, { date, learnerId, max = 200 } = {}) {
  const filters = []
  if (date) filters.push(where('date', '==', date))
  if (learnerId) filters.push(where('learnerId', '==', learnerId))
  const snap = await getDocs(query(auditCol(classId), ...filters, fsLimit(max)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0))
}
