// School Profile — Firestore + Storage service (browser-only IO layer).
//
// Reads/writes the teacher's saved school branding at schoolProfiles/{uid}
// and uploads the logo. All pure shaping lives in ./schoolProfile (which the
// node test suite covers); this module is the thin IO wrapper around it.

import {
  collection, doc, getDoc, getDocs, setDoc, serverTimestamp,
  query, where, orderBy, limit,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { compressImage } from './imageCompression'
import { normalizeSchoolProfile, brandingFromPapers } from './schoolProfile'

const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_LOGO_BYTES = 10 * 1024 * 1024

// Read the saved profile, or null when the teacher hasn't created one yet.
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

// Save (merge) the profile. Returns the normalised payload that was written.
export async function saveSchoolProfile(uid, data) {
  if (!uid) throw new Error('Sign in to save your school profile.')
  const payload = normalizeSchoolProfile(data)
  await setDoc(
    doc(db, 'schoolProfiles', uid),
    { ...payload, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return payload
}

// Compress + upload a logo, returning its download URL. Reuses the owner-scoped
// `assessment-images/{uid}/` Storage path (already permitted by storage.rules)
// so no new Storage rule is needed — the logo is readable by the owning teacher
// only, exactly like the per-paper logo upload this profile replaces.
export async function uploadSchoolLogo(uid, file) {
  if (!uid) throw new Error('Sign in to upload a logo.')
  if (!file || !ALLOWED_LOGO_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, and WEBP images are allowed.')
  }
  if (file.size > MAX_LOGO_BYTES) throw new Error('Logo must be under 10 MB.')
  const compressed = await compressImage(file, 600, 0.9)
  const path = `assessment-images/${uid}/logo-${Date.now()}.jpg`
  const snapshot = await uploadBytes(storageRef(storage, path), compressed, {
    contentType: 'image/jpeg',
  })
  return getDownloadURL(snapshot.ref)
}

// One-time migration source: derive branding from the teacher's recent papers
// so an existing teacher's logo/name pre-fills the profile form. Same query
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
