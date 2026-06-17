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
} from '../schemas/classRecord'
import { snapshotFromRoster, computeRecord } from './classRecordMath'

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
}) {
  const snapshot = snapshotFromRoster(roster)
  const { stats } = computeRecord({ snapshot, columns, marks: {} })
  const payload = classRecordWriteSchema.parse({
    classId, teacherUid, type, title, subject, term, year,
    assessmentType, sourceAssessmentId, columns,
    rosterSnapshot: snapshot, marks: {}, stats,
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
