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
 * Day saves go through a TRANSACTION with a per-learner three-way merge
 * (attendanceDayCore.mergeDayRecords) + a version counter, so two teachers
 * marking the same day never silently clobber each other. Decisions live in
 * the pure core modules; this file is only I/O.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { computeDailyCounts } from './attendanceCalculator'
import { mergeDayRecords, plainRecords, sanitizeNote } from './attendanceDayCore'
import { REGISTER_STATES } from './attendanceConstants'

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

/**
 * Save one day's marks. `localChanges` holds only the learners this client
 * touched ({ [learnerId]: { status, note } }); `baseRecords` is the server
 * state those changes were made against. The transaction re-reads the doc,
 * merges per learner (an explicit local tap wins its own row, everything the
 * other editor did is preserved), recomputes counts, and bumps `version`.
 *
 * Returns { records, version, conflicts } — conflicts is the list of learner
 * ids where another editor changed the same row since `baseRecords`.
 */
export async function saveAttendanceDay({
  classId,
  teacherUid,
  date,
  termMeta, // { term, year, termId, classification }
  baseRecords,
  localChanges,
}) {
  if (!ISO_DATE_RE.test(date)) throw new Error(`Invalid attendance date: ${date}`)
  const ref = dayRef(classId, date)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const existing = snap.exists() ? snap.data() : null
    const serverPlain = plainRecords(existing?.records)
    const { merged, conflicts } = mergeDayRecords({
      base: baseRecords || {},
      server: serverPlain,
      local: localChanges || {},
    })

    // Re-attach per-record metadata: keep the other editor's stamps, restamp
    // only the rows this save touches.
    const records = {}
    for (const [learnerId, record] of Object.entries(merged)) {
      const prior = existing?.records?.[learnerId]
      const touched = Object.prototype.hasOwnProperty.call(localChanges || {}, learnerId)
      records[learnerId] = {
        status: record.status,
        note: sanitizeNote(record.note),
        updatedBy: touched || !prior?.updatedBy ? teacherUid : prior.updatedBy,
        updatedAt: touched || !prior?.updatedAt ? serverTimestamp() : prior.updatedAt,
      }
    }

    const version = (Number(existing?.version) || 0) + 1
    tx.set(ref, {
      classId,
      teacherUid: existing?.teacherUid || teacherUid,
      date,
      term: termMeta?.term ?? existing?.term ?? '',
      year: termMeta?.year ?? existing?.year ?? null,
      termId: termMeta?.termId ?? existing?.termId ?? '',
      classification: termMeta?.classification ?? existing?.classification ?? 'teaching_day',
      records,
      counts: computeDailyCounts(merged),
      markedBy: existing?.markedBy || teacherUid,
      markedAt: existing?.markedAt || serverTimestamp(),
      updatedBy: teacherUid,
      updatedAt: serverTimestamp(),
      version,
    })
    return { records: merged, version, conflicts }
  })
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
