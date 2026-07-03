// School Profile — Firestore service (browser-only IO layer).
//
// Reads/writes the teacher's saved school branding at schoolProfiles/{uid}.
// All pure shaping lives in ./schoolProfile (which the node test suite
// covers); this module is the thin IO wrapper around it.

import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp,
  query, where, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  normalizeSchoolProfile,
  normalizeSchoolProfilePartial,
  brandingFromPapers,
} from './schoolProfile'

// Read the saved profile, or null when the teacher hasn't created one yet.
// Swallows read errors into null — fine for best-effort consumers (studio
// seeding, exports); anything that WRITES back must use the strict variant
// below so a transient read failure can never masquerade as "no profile".
export async function getSchoolProfile(uid) {
  if (!uid) return null
  try {
    const snap = await getDoc(doc(db, 'schoolProfiles', uid))
    return snap.exists() ? normalizeSchoolProfile(snap.data()) : null
  } catch (e) {
    console.warn('getSchoolProfile failed:', e)
    return null
  }
}

// Strict read for edit surfaces: null strictly means "no doc yet"; a failed
// read REJECTS so the caller can block saves instead of rendering a blank
// form over real data.
export async function getSchoolProfileStrict(uid) {
  if (!uid) return null
  const snap = await getDoc(doc(db, 'schoolProfiles', uid))
  return snap.exists() ? normalizeSchoolProfile(snap.data()) : null
}

// Save (merge) the profile. Only the keys PRESENT in `data` are written
// (normalized), so setDoc's merge actually protects every field the caller
// didn't touch — panels, uploads, tabs and the legacy settings page can each
// write their own slice without clobbering the others. Returns the partial
// payload that was written.
export async function saveSchoolProfile(uid, data) {
  if (!uid) throw new Error('Sign in to save your school profile.')
  const payload = normalizeSchoolProfilePartial(data)
  await setDoc(
    doc(db, 'schoolProfiles', uid),
    { ...payload, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return payload
}

// One-time migration source: derive branding from the teacher's recent papers
// so an existing teacher's school name pre-fills the profile form. Same query
// shape as useFirestore.getMyAssessments (the composite index already exists).
export async function getBrandingFromRecentPapers(uid) {
  if (!uid) return null
  try {
    const snap = await getDocs(query(
      collection(db, 'assessments'),
      where('createdBy', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(20),
    ))
    return brandingFromPapers(snap.docs.map(d => d.data()))
  } catch (e) {
    console.warn('getBrandingFromRecentPapers failed:', e)
    return null
  }
}
