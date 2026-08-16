/**
 * classRecords — Firestore access for Class Register marking records
 * (classRegisters/{classId}/records/{recordId}).
 *
 * A record freezes a roster SNAPSHOT at creation (snapshotFromRoster) so later
 * roster edits never disturb historical marks. saveRecordMarks recomputes the
 * per-learner totals/percentages/grades/positions and the class stats
 * (classRecordMath) on every save, so the stored doc always matches what the
 * grid shows. Owner-only, gated by Firestore rules on teacherUid.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  classRecordWriteSchema,
  classRecordUpdateSchema,
  coerceClassRecord,
} from '../shared/schemas/classRecord'
import { snapshotFromRoster, computeRecord, addLearnerToRecord } from './classRecordMath'

function recordsCol(classId) {
  return collection(db, 'classRegisters', classId, 'records')
}
function recordDoc(classId, recordId) {
  return doc(db, 'classRegisters', classId, 'records', recordId)
}

/**
 * Create a record by snapshotting the class roster. `roster` is the live
 * roster array (from classRoster.listRoster / subscribeRoster); only active
 * learners are frozen into the snapshot.
 */
export async function createRecordFromRoster({
  classId, teacherUid, type, title, subject = null, term = '', year,
  assessmentType = '', sourceAssessmentId = null, columns = [], roster = [],
  // Optional pre-seeded marks keyed by rosterId (e.g. the Final SBA G7 column
  // pre-filled from this class's year-long SBA record).
  marks = {},
}) {
  const snapshot = snapshotFromRoster(roster)
  const { stats } = computeRecord({ snapshot, columns, marks })
  const payload = classRecordWriteSchema.parse({
    classId, teacherUid, type, title, subject, term, year,
    assessmentType, sourceAssessmentId, columns,
    rosterSnapshot: snapshot, marks, stats,
  })
  const now = serverTimestamp()
  const ref = await addDoc(recordsCol(classId), { ...payload, createdAt: now, updatedAt: now })
  return ref.id
}

export async function getRecord(classId, recordId) {
  const snap = await getDoc(recordDoc(classId, recordId))
  return snap.exists() ? { id: snap.id, ...coerceClassRecord(snap.data()) } : null
}

/**
 * List a class's records, newest first. Record counts per class are small
 * (a few per term), so type filtering is done in memory — no composite index.
 */
export async function listRecords(classId, { type = null } = {}) {
  const snap = await getDocs(query(recordsCol(classId), orderBy('createdAt', 'desc')))
  const rows = snap.docs.map((d) => ({ id: d.id, ...coerceClassRecord(d.data()) }))
  return type ? rows.filter((r) => r.type === type) : rows
}

/**
 * Persist entered marks and the freshly-recomputed stats. The caller passes
 * the record's snapshot + columns (the grid already has them) so this needs no
 * extra read.
 */
export async function saveRecordMarks(classId, recordId, { marks, snapshot, columns }) {
  const { stats } = computeRecord({ snapshot, columns, marks })
  await updateDoc(recordDoc(classId, recordId), {
    marks,
    stats,
    updatedAt: serverTimestamp(),
  })
  return stats
}

export async function updateRecordMeta(classId, recordId, fields) {
  const patch = classRecordUpdateSchema.parse(fields)
  await updateDoc(recordDoc(classId, recordId), { ...patch, updatedAt: serverTimestamp() })
}

export async function deleteRecord(classId, recordId) {
  await deleteDoc(recordDoc(classId, recordId))
}

/**
 * Records in the class's CURRENT term/year that don't yet include a given
 * learner — i.e. the records a newly-added learner could be synced into.
 * Used to decide whether to prompt the teacher at all.
 */
export async function recordsMissingLearner(classId, rosterId, { term, year }) {
  const all = await listRecords(classId)
  return all.filter((r) =>
    r.term === term
    && Number(r.year) === Number(year)
    && !(r.rosterSnapshot || []).some((s) => s.rosterId === rosterId),
  )
}

/**
 * Sync a newly-added learner into existing records so old marks stay intact
 * while the current term picks the learner up. The learner is appended to each
 * target record's snapshot (with no marks → counts as zero) and stats recompute.
 *
 *   scope 'all-term'  → every current term+year record missing the learner
 *   scope 'this-only' → just `recordId`
 *   scope 'none'      → no-op
 *
 * `entry` is the roster entry { id, learnerNumber, fullName, gender }.
 * Returns the number of records updated.
 */
export async function reconcileNewLearner(classId, entry, { scope, recordId = null, term, year } = {}) {
  if (scope === 'none' || !scope) return 0
  const snapshotEntry = {
    rosterId: entry.id,
    learnerNumber: entry.learnerNumber || '',
    fullName: entry.fullName || '',
    gender: entry.gender ?? null,
  }

  let targets = []
  if (scope === 'this-only' && recordId) {
    const rec = await getRecord(classId, recordId)
    if (rec) targets = [rec]
  } else if (scope === 'all-term') {
    targets = await recordsMissingLearner(classId, entry.id, { term, year })
  }

  let updated = 0
  for (const rec of targets) {
    const { rosterSnapshot, stats, changed } = addLearnerToRecord(rec, snapshotEntry)
    if (!changed) continue
    await updateDoc(recordDoc(classId, rec.id), { rosterSnapshot, stats, updatedAt: serverTimestamp() })
    updated += 1
  }
  return updated
}
