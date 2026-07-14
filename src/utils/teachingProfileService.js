// Teaching Profile — Firestore service (browser-only IO layer).
//
// Reads/writes teacherProfiles/{uid} and its assignments subcollection. All
// pure shaping lives in ./teachingProfileCore (covered by the node suite);
// this module is the thin IO wrapper around it.
//
//   teacherProfiles/{uid}                            — profile doc (calendar
//                                                      reference + defaults +
//                                                      onboarding flag)
//   teacherProfiles/{uid}/teachingAssignments/{id}   — one doc per assignment
//
// The subcollection is named `teachingAssignments` (not `assignments`) to stay
// distinct from the unrelated top-level `assignments` collection. Ownership is
// doc-id == uid on the parent, and a denormalized teacherId on each assignment
// (so the security rules can gate a subcollection list without a parent
// get()). See firestore.rules.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  normalizeTeachingProfile,
  normalizeTeachingProfilePartial,
  normalizeAssignment,
  normalizeAssignmentPartial,
} from './teachingProfileCore.js'

const PROFILES = 'teacherProfiles'
const ASSIGNMENTS = 'teachingAssignments'

// ── profile ──────────────────────────────────────────────────────────────────

// Best-effort read: null on "no doc yet" OR a transient failure. Fine for
// display/seed consumers; anything that WRITES back should use the strict
// variant so a read blip can't masquerade as "no profile".
export async function getTeachingProfile(uid) {
  if (!uid) return null
  try {
    const snap = await getDoc(doc(db, PROFILES, uid))
    return snap.exists() ? normalizeTeachingProfile(snap.data()) : null
  } catch (e) {
    console.warn('getTeachingProfile failed:', e)
    return null
  }
}

// Strict read for edit surfaces: null strictly means "no doc yet"; a failed
// read REJECTS so the caller can block saves instead of overwriting real data.
export async function getTeachingProfileStrict(uid) {
  if (!uid) return null
  const snap = await getDoc(doc(db, PROFILES, uid))
  return snap.exists() ? normalizeTeachingProfile(snap.data()) : null
}

// Save (merge) the profile. Only keys PRESENT in `data` are written
// (normalized), so setDoc merge protects every field the caller didn't touch.
// Returns the partial payload written.
export async function saveTeachingProfile(uid, data) {
  if (!uid) throw new Error('Sign in to save your teaching profile.')
  const payload = normalizeTeachingProfilePartial(data)
  await setDoc(
    doc(db, PROFILES, uid),
    { ...payload, teacherId: uid, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return payload
}

// ── assignments ──────────────────────────────────────────────────────────────

// List the teacher's assignments, oldest first (stable card order). Each item
// carries its Firestore `id`. Best-effort: [] on failure.
export async function listAssignments(uid) {
  if (!uid) return []
  try {
    const snap = await getDocs(
      query(collection(db, PROFILES, uid, ASSIGNMENTS), orderBy('createdAt', 'asc')),
    )
    return snap.docs.map((d) => ({ id: d.id, ...normalizeAssignment(d.data()) }))
  } catch (e) {
    console.warn('listAssignments failed:', e)
    return []
  }
}

// Create a new assignment. Stamps the denormalized teacherId + timestamps.
// Returns { id, ...assignment }. Duplicate prevention is the caller's job
// (findDuplicateAssignment in the core) — kept out of IO so the UI can surface
// the "already added" message before writing.
export async function addAssignment(uid, data) {
  if (!uid) throw new Error('Sign in to add a teaching assignment.')
  const payload = normalizeAssignment(data)
  const ref = await addDoc(collection(db, PROFILES, uid, ASSIGNMENTS), {
    ...payload,
    teacherId: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: ref.id, ...payload }
}

// Merge-update an assignment. Only present keys are written.
export async function updateAssignment(uid, assignmentId, data) {
  if (!uid) throw new Error('Sign in to edit a teaching assignment.')
  if (!assignmentId) throw new Error('Missing assignment id.')
  const payload = normalizeAssignmentPartial(data)
  await setDoc(
    doc(db, PROFILES, uid, ASSIGNMENTS, assignmentId),
    { ...payload, teacherId: uid, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return payload
}

// Remove an assignment. Does NOT touch any existing lesson plans / schemes /
// tests (section 28 — those documents are never deleted here). If it was the
// default, the caller should pick a new default (resolveDefaultAssignmentId).
export async function removeAssignment(uid, assignmentId) {
  if (!uid) throw new Error('Sign in to remove a teaching assignment.')
  if (!assignmentId) throw new Error('Missing assignment id.')
  await deleteDoc(doc(db, PROFILES, uid, ASSIGNMENTS, assignmentId))
}

/**
 * Make `assignmentId` the default: writes profile.defaultAssignmentId and flips
 * the isDefault flag on every assignment in one atomic batch, so exactly one
 * assignment is ever marked default. `allAssignmentIds` is the current id list
 * (from listAssignments) — pass it so the batch can clear stale flags.
 */
export async function setDefaultAssignment(uid, assignmentId, allAssignmentIds = []) {
  if (!uid) throw new Error('Sign in to set your default assignment.')
  if (!assignmentId) throw new Error('Missing assignment id.')
  const batch = writeBatch(db)
  batch.set(
    doc(db, PROFILES, uid),
    { defaultAssignmentId: assignmentId, teacherId: uid, updatedAt: serverTimestamp() },
    { merge: true },
  )
  const ids = new Set([...allAssignmentIds, assignmentId])
  for (const id of ids) {
    batch.set(
      doc(db, PROFILES, uid, ASSIGNMENTS, id),
      { isDefault: id === assignmentId, teacherId: uid, updatedAt: serverTimestamp() },
      { merge: true },
    )
  }
  await batch.commit()
}
