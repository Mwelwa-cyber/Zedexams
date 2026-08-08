/**
 * diagramAssetService — Firestore CRUD for the curriculum Diagram Library
 * (`diagramAssets` collection, Visual Studio v2 spec 1A).
 *
 * One asset = source art + normalized label data; consumers reference
 * `assetId + version` and derive the printable versions at render time
 * (lib/diagramProjections.js) — never four saved images. Owner model and
 * service shape mirror visualAssetService.js: thin and swappable, so nothing
 * else in the feature folder imports Firebase directly.
 */

import {
  collection, doc, deleteDoc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp, increment,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import {
  diagramAssetWriteSchema, diagramAssetUpdateSchema, coerceDiagramAsset,
} from '../../../schemas/diagramAsset'

const FETCH_LIMIT = 300
const COLLECTION = 'diagramAssets'

function firstIssueMessage(parsed, prefix) {
  const first = parsed.error.issues[0]
  return `${prefix}: ${first ? `${first.path.join('.')} ${first.message}` : 'validation failed'}`
}

/**
 * Create a diagramAsset doc (validated against the write schema).
 * @returns {Promise<string>} the new doc id.
 */
export async function saveDiagramAsset(data) {
  const parsed = diagramAssetWriteSchema.safeParse(data)
  if (!parsed.success) throw new Error(firstIssueMessage(parsed, 'Invalid diagram'))
  const ref = doc(collection(db, COLLECTION))
  await setDoc(ref, {
    ...parsed.data,
    id: ref.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Update mutable fields. Any label/param edit must be visible to consumers
 * holding `assetId + version`, so every update bumps `version` atomically
 * unless the caller opts out (pure metadata edits).
 */
export async function updateDiagramAsset(id, patch, { bumpVersion = true } = {}) {
  const parsed = diagramAssetUpdateSchema.safeParse(patch)
  if (!parsed.success) throw new Error(firstIssueMessage(parsed, 'Invalid update'))
  const data = { ...parsed.data, updatedAt: serverTimestamp() }
  delete data.version
  if (bumpVersion) data.version = increment(1)
  await updateDoc(doc(db, COLLECTION, id), data)
}

/** Fetch one asset (coerced for safe rendering; null when missing). */
export async function getDiagramAsset(id) {
  const snap = await getDoc(doc(db, COLLECTION, id))
  return snap.exists() ? coerceDiagramAsset({ id: snap.id, ...snap.data() }) : null
}

/**
 * List the signed-in teacher's Library assets, newest first, with client-side
 * narrowing (Firestore has no full-text). Families (spec 3E) group under one
 * card client-side via `familyId`.
 * @param {string} uid
 * @param {{ search?: string, subject?: string, grade?: string }} [filters]
 */
export async function listMyDiagramAssets(uid, { search = '', subject = '', grade = '' } = {}) {
  if (!uid) return []
  try {
    const snap = await getDocs(query(
      collection(db, COLLECTION),
      where('createdBy', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(FETCH_LIMIT),
    ))
    let rows = snap.docs.map((d) => coerceDiagramAsset({ id: d.id, ...d.data() })).filter(Boolean)
    if (subject && subject !== 'all') {
      rows = rows.filter((r) => String(r.subject).toLowerCase() === String(subject).toLowerCase())
    }
    if (grade && grade !== 'all') {
      rows = rows.filter((r) => String(r.grade) === String(grade))
    }
    const term = String(search || '').toLowerCase().trim()
    if (term) {
      rows = rows.filter((r) =>
        [r.title, r.topic, r.subtopic, r.subject, r.description,
          ...r.labels.map((l) => l.word)]
          .join(' ').toLowerCase().includes(term))
    }
    return rows
  } catch (err) {
    console.error('listMyDiagramAssets failed', err)
    return []
  }
}

/** Delete an asset doc. Storage cleanup is the caller's concern (art blobs
 * can be shared across a variant family, so no blind cascade here). */
export async function deleteDiagramAsset(id) {
  if (!id) return false
  try {
    await deleteDoc(doc(db, COLLECTION, id))
    return true
  } catch (err) {
    console.error('deleteDiagramAsset failed', err)
    return false
  }
}
