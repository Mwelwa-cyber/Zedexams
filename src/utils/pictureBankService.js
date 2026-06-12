/**
 * Picture bank service — subject-organised, keyword-searchable library of
 * teaching figures (diagrams, maps, labelled illustrations).
 *
 * Sources: admin uploads, AI generation (the existing generateDiagram
 * callable), and images auto-extracted from sample papers uploaded for
 * assessment-format extraction (those arrive as status:'staged' and wait
 * for an admin to tag or discard them).
 *
 * Lifecycle: staged → active (admin tags name/keywords/subject) or
 * deleted. Teachers only ever query active pictures (firestore.rules
 * enforces the status filter for non-admins).
 */

import {
  collection, deleteDoc, doc, getDocs, query, where, limit,
  serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { generateDiagram } from './generateDiagram'

export const PICTURE_BANK_SUBJECTS_GENERIC = '_generic'

const MAX_PICTURE_BYTES = 10 * 1024 * 1024
const FETCH_LIMIT = 500

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

function normaliseKeywords(value) {
  const list = Array.isArray(value) ?
    value : String(value || '').split(/[,\n]/)
  const out = []
  for (const k of list) {
    const v = String(k || '').toLowerCase().trim().slice(0, 60)
    if (v && !out.includes(v)) out.push(v)
  }
  return out.slice(0, 20)
}

/**
 * Resolve a renderable URL for a picture doc: prefers the stored url,
 * falls back to a download URL from storagePath. Returns null when
 * neither resolves (the caller hides the tile).
 */
export async function resolvePictureUrl(pic) {
  if (pic?.url) return pic.url
  if (!pic?.storagePath) return null
  try {
    return await getDownloadURL(storageRef(storage, pic.storagePath))
  } catch (err) {
    console.warn('resolvePictureUrl failed', pic?.id, err?.code)
    return null
  }
}

/**
 * Teacher search: active pictures matching a term (against name +
 * keywords), optionally narrowed by subject. Firestore has no full-text
 * search, so we pull the (bounded) active set and filter client-side —
 * fine at bank sizes of a few hundred images.
 */
export async function searchActivePictures({ term = '', subject = '' } = {}) {
  try {
    const clauses = [where('status', '==', 'active'), limit(FETCH_LIMIT)]
    if (subject && subject !== 'all') {
      clauses.unshift(where('subject', 'in', [subject, PICTURE_BANK_SUBJECTS_GENERIC]))
    }
    const snap = await getDocs(query(collection(db, 'pictureBank'), ...clauses))
    let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    const tokens = tokenize(term)
    if (tokens.length > 0) {
      rows = rows.filter((p) => {
        const hay = [p.nameLower || String(p.name || '').toLowerCase(),
          ...(Array.isArray(p.keywords) ? p.keywords : [])].join(' ')
        return tokens.every((t) => hay.includes(t))
      })
    }
    return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  } catch (err) {
    console.error('searchActivePictures failed', err)
    return []
  }
}

/** Admin: list pictures by status ('staged' | 'active' | all). */
export async function listBankPictures({ status = '' } = {}) {
  try {
    const clauses = [limit(FETCH_LIMIT)]
    if (status) clauses.unshift(where('status', '==', status))
    const snap = await getDocs(query(collection(db, 'pictureBank'), ...clauses))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('listBankPictures failed', err)
    return []
  }
}

/**
 * Admin: activate a picture (typically a staged extraction) with its real
 * name, keywords and subject. Also pins a stable download URL on the doc
 * so teacher pickers don't need a storage round-trip per tile.
 */
export async function activateBankPicture(pic, { name, keywords, subject, gradeBand }) {
  const cleanName = String(name || '').trim().slice(0, 120)
  if (!pic?.id) throw new Error('Missing picture id.')
  if (!cleanName) throw new Error('Give the picture a name (e.g. "Human ear, labelled").')
  const kw = normaliseKeywords(keywords)
  if (kw.length === 0) throw new Error('Add at least one search keyword.')

  // Pin a stable download URL while activating so teacher pickers don't
  // need a storage round-trip per tile.
  const url = pic.url || await resolvePictureUrl(pic)

  await updateDoc(doc(db, 'pictureBank', pic.id), {
    name: cleanName,
    nameLower: cleanName.toLowerCase(),
    keywords: kw,
    subject: String(subject || PICTURE_BANK_SUBJECTS_GENERIC).toLowerCase(),
    gradeBand: String(gradeBand || ''),
    status: 'active',
    ...(url ? { url } : {}),
    updatedAt: serverTimestamp(),
  })
  return pic.id
}

/** Admin: discard a picture (doc + blob, best effort on the blob). */
export async function deleteBankPicture(pic) {
  if (!pic?.id) return false
  try {
    await deleteDoc(doc(db, 'pictureBank', pic.id))
    if (pic.storagePath) {
      deleteObject(storageRef(storage, pic.storagePath)).catch(() => {})
    }
    return true
  } catch (err) {
    console.error('deleteBankPicture failed', err)
    return false
  }
}

/** Admin: upload a new picture straight into the bank as active. */
export async function uploadBankPicture(file, { name, keywords, subject, gradeBand, uid }) {
  if (!file) throw new Error('Pick an image file.')
  if (!file.type?.startsWith('image/')) throw new Error('Only image files are supported.')
  if (file.size > MAX_PICTURE_BYTES) throw new Error('Image is over the 10 MB limit.')
  const cleanName = String(name || '').trim().slice(0, 120)
  if (!cleanName) throw new Error('Give the picture a name.')
  const kw = normaliseKeywords(keywords)
  if (kw.length === 0) throw new Error('Add at least one search keyword.')

  const ref = doc(collection(db, 'pictureBank'))
  const ext = (String(file.name || '').split('.').pop() || 'png').toLowerCase()
  const storagePath = `picture-bank/uploads/${ref.id}.${ext}`
  const snap = await uploadBytes(storageRef(storage, storagePath), file, {
    contentType: file.type,
  })
  const url = await getDownloadURL(snap.ref)
  await setDoc(ref, {
    id: ref.id,
    name: cleanName,
    nameLower: cleanName.toLowerCase(),
    subject: String(subject || PICTURE_BANK_SUBJECTS_GENERIC).toLowerCase(),
    gradeBand: String(gradeBand || ''),
    keywords: kw,
    storagePath,
    url,
    contentType: file.type,
    source: 'upload',
    status: 'active',
    sourceNote: '',
    createdBy: uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Admin: generate a picture with AI (existing generateDiagram callable —
 * Recraft line art by default) and save it into the bank as active.
 */
export async function generateBankPicture({ prompt, name, keywords, subject, gradeBand, uid, provider }) {
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt) throw new Error('Describe the picture to generate.')
  const { url } = await generateDiagram({ prompt: cleanPrompt, provider })
  const cleanName = String(name || cleanPrompt).trim().slice(0, 120)
  const kw = normaliseKeywords(keywords?.length ? keywords : cleanPrompt)

  const ref = doc(collection(db, 'pictureBank'))
  await setDoc(ref, {
    id: ref.id,
    name: cleanName,
    nameLower: cleanName.toLowerCase(),
    subject: String(subject || PICTURE_BANK_SUBJECTS_GENERIC).toLowerCase(),
    gradeBand: String(gradeBand || ''),
    keywords: kw,
    storagePath: '',
    url,
    contentType: 'image/png',
    source: 'ai',
    status: 'active',
    sourceNote: `AI-generated: ${cleanPrompt.slice(0, 200)}`,
    createdBy: uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { id: ref.id, url }
}
