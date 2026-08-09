/**
 * classRegister — Firestore data access for the teacher Class Register
 * (classRegisters/{classId}).
 *
 * A register is one official class, wholly owned by the teacher: a roster
 * subcollection of learners (classRoster.js) plus marking records. Roster
 * entries are names the teacher typed, pasted or uploaded — no learner
 * account is involved, and none can be linked to one. All writes are direct
 * and gated by Firestore rules on teacherUid == request.auth.uid.
 *
 * Validation goes through src/schemas/classRegister.js so a bad payload is
 * caught client-side with a named error rather than an opaque rule rejection.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { capture } from './analytics'
import {
  classRegisterWriteSchema,
  classRegisterUpdateSchema,
  coerceClassRegister,
} from '../schemas/classRegister'

const COLLECTION = 'classRegisters'

/** List the registers a teacher owns (active by default, newest first). */
export async function listTeacherRegisters(teacherUid, { status = 'active', limit = 100 } = {}) {
  const filters = [where('teacherUid', '==', teacherUid)]
  if (status) filters.push(where('status', '==', status))
  const q = query(
    collection(db, COLLECTION),
    ...filters,
    orderBy('updatedAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...coerceClassRegister(d.data()) }))
}

export async function getRegister(classId) {
  const snap = await getDoc(doc(db, COLLECTION, classId))
  return snap.exists() ? { id: snap.id, ...coerceClassRegister(snap.data()) } : null
}

/**
 * Create a class register. The teacherUid + status:'active' + learnerCount:0
 * are stamped here; the schema validates the rest before the write.
 */
export async function createRegister({ teacherUid, fields }) {
  const payload = classRegisterWriteSchema.parse({
    className: fields.className,
    grade: fields.grade,
    stream: fields.stream ?? null,
    // Deprecated on the class (§13, §7) — a new class writes neither, and the
    // empty/null default is what the schema already expects. Passed through
    // only so an EDIT of an older class can hand back the value it arrived
    // with instead of dropping it. See ClassRegisterEditor.
    term: fields.term ?? '',
    year: fields.year,
    school: fields.school ?? null,
    classTeacherName: fields.classTeacherName ?? null,
    classTeacherUid: fields.classTeacherUid ?? null,
    subject: fields.subject ?? null,
    curriculum: fields.curriculum ?? null,
    teacherUid,
    status: fields.status === 'archived' ? 'archived' : 'active',
    learnerCount: 0,
  })
  const now = serverTimestamp()
  const ref = await addDoc(collection(db, COLLECTION), {
    ...payload,
    createdAt: now,
    updatedAt: now,
  })
  // Structural analytics only — never the class name or school.
  capture('class_register_created', {
    grade: payload.grade,
    subject: payload.subject ?? null,
    hasSchool: Boolean(payload.school),
  })
  return ref.id
}

export async function updateRegister(classId, fields) {
  const patch = classRegisterUpdateSchema.parse(fields)
  await updateDoc(doc(db, COLLECTION, classId), {
    ...patch,
    updatedAt: serverTimestamp(),
  })
}

/** Soft-delete — the doc + roster + records are preserved for history. */
export async function archiveRegister(classId) {
  await updateRegister(classId, { status: 'archived' })
}

export async function unarchiveRegister(classId) {
  await updateRegister(classId, { status: 'active' })
}

/** Hard delete the register doc (roster/records cleanup is a later concern). */
export async function hardDeleteRegister(classId) {
  await deleteDoc(doc(db, COLLECTION, classId))
}
