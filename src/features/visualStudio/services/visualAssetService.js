/**
 * visualAssetService — Firestore + Storage CRUD for a teacher's own saved
 * Visual Studio pictures (`visualAssets` collection).
 *
 * Owner model: every doc carries `createdBy === uid`; firestore.rules lets the
 * owner read/write their own and admins read all (mirrors aiGenerations).
 * Baked PNGs live under `visual-studio/{uid}/…` in Storage, which storage.rules
 * scopes to the owner.
 *
 * Kept as a thin, swappable service so the rest of the feature folder never
 * imports Firebase directly — the eventual standalone-app port only has to
 * reimplement this file.
 */

import {
  collection, doc, deleteDoc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage'
import { db, storage } from '../../../firebase/config'
import {
  visualAssetWriteSchema, visualAssetUpdateSchema, coerceVisualAsset,
} from '../../../schemas/visualAsset'

const FETCH_LIMIT = 300
const COLLECTION = 'visualAssets'

/**
 * Upload a baked PNG (image + labels flattened) to the teacher's Storage
 * folder. Returns a stable, CORS-safe download URL + the storage path.
 * @param {Blob} blob
 * @param {{ uid: string, assetId?: string, suffix?: string }} opts
 */
export async function uploadVisualImage(blob, { uid, assetId, suffix = '' } = {}) {
  if (!blob) throw new Error('No image to upload.')
  if (!uid) throw new Error('You must be signed in.')
  const id = assetId || (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()))
  const tag = suffix ? `-${String(suffix).replace(/[^a-z0-9]/gi, '').slice(0, 16)}` : ''
  const path = `visual-studio/${uid}/${id}${tag}-${Date.now()}.png`
  const snap = await uploadBytes(storageRef(storage, path), blob, { contentType: 'image/png' })
  const url = await getDownloadURL(snap.ref)
  return { url, storagePath: path, sizeBytes: blob.size || 0 }
}

/**
 * Create a visualAsset doc. `data` is validated against the write schema.
 * @returns {Promise<string>} the new doc id.
 */
export async function saveVisualAsset(data) {
  const parsed = visualAssetWriteSchema.safeParse(data)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid visual: ${first ? `${first.path.join('.')} ${first.message}` : 'validation failed'}`)
  }
  const ref = doc(collection(db, COLLECTION))
  await setDoc(ref, {
    ...parsed.data,
    id: ref.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/** Update mutable fields on a visualAsset. */
export async function updateVisualAsset(id, patch) {
  const parsed = visualAssetUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid update: ${first ? `${first.path.join('.')} ${first.message}` : 'validation failed'}`)
  }
  await updateDoc(doc(db, COLLECTION, id), { ...parsed.data, updatedAt: serverTimestamp() })
}

/** Fetch one visualAsset (coerced for safe rendering). */
export async function getVisualAsset(id) {
  const snap = await getDoc(doc(db, COLLECTION, id))
  return snap.exists() ? coerceVisualAsset({ id: snap.id, ...snap.data() }) : null
}

/**
 * List the signed-in teacher's saved visuals, newest first, with optional
 * client-side text/subject/grade narrowing (Firestore has no full-text).
 * @param {string} uid
 * @param {{ search?: string, subject?: string, grade?: string }} [filters]
 */
export async function listMyVisualAssets(uid, { search = '', subject = '', grade = '' } = {}) {
  if (!uid) return []
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('createdBy', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(FETCH_LIMIT),
    ))
    let rows = snap.docs.map((d) => coerceVisualAsset({ id: d.id, ...d.data() })).filter(Boolean)
    if (subject && subject !== 'all') {
      rows = rows.filter((r) => String(r.subject).toLowerCase() === String(subject).toLowerCase())
    }
    if (grade && grade !== 'all') {
      rows = rows.filter((r) => String(r.grade) === String(grade))
    }
    const term = String(search || '').toLowerCase().trim()
    if (term) {
      rows = rows.filter((r) =>
        [r.title, r.topic, r.subtopic, r.subject, r.description]
          .join(' ').toLowerCase().includes(term))
    }
    return rows
  } catch (err) {
    console.error('listMyVisualAssets failed', err)
    return []
  }
}

/** Delete a visualAsset doc + its Storage blob (best-effort on the blob). */
export async function deleteVisualAsset(asset) {
  if (!asset?.id) return false
  try {
    await deleteDoc(doc(db, COLLECTION, asset.id))
    if (asset.storagePath) {
      deleteObject(storageRef(storage, asset.storagePath)).catch(() => {})
    }
    return true
  } catch (err) {
    console.error('deleteVisualAsset failed', err)
    return false
  }
}
