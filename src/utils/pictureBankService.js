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
import { ref as storageRef, getDownloadURL } from 'firebase/storage'
import { uploadBytes, deleteObject } from '../firebase/attestedStorage'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db, storage } from '../firebase/config'
import { generateDiagram } from './generateDiagram'
import { assertFileSignature } from './fileSignature'

export const PICTURE_BANK_SUBJECTS_GENERIC = '_generic'

const MAX_PICTURE_BYTES = 10 * 1024 * 1024
const FETCH_LIMIT = 500

// Raster formats only. SVG is rejected up front (a picture-bank blob is
// readable by every verified user and its download URL is stored in Firestore,
// so a script-bearing SVG would be a stored-XSS vector) — this mirrors the
// storage.rules validPictureBankUpload() backstop so admins get a clear message
// instead of an opaque storage/unauthorized when the rule rejects the upload.
const PICTURE_BANK_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function assertUploadableImage(file) {
  if (!file) throw new Error('Pick an image file.')
  if (!PICTURE_BANK_CONTENT_TYPES.includes(file.type)) {
    throw new Error('Only JPEG, PNG or WebP images are supported (SVG is not allowed).')
  }
  if (file.size > MAX_PICTURE_BYTES) throw new Error('Image is over the 10 MB limit.')
  // Declared type is not enough — verify the real bytes (STOR-003).
  await assertFileSignature(file, PICTURE_BANK_CONTENT_TYPES, { label: 'a JPEG, PNG or WebP image' })
}

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

// A search/list can come back with FETCH_LIMIT (500) rows, and every one
// missing a cached `.url` (a staged/legacy row that predates activation
// pinning one) used to fire its own concurrent getDownloadURL() round trip
// — up to hundreds of simultaneous Storage requests the moment the admin
// bank or the teacher's picture picker rendered. Real contention on the
// budget Android handsets this product targets, and on the modal picker it
// re-fired on every debounced keystroke/subject change.
const WARM_CONCURRENCY = 6

/**
 * Resolve download URLs for every picture missing one, capped at
 * WARM_CONCURRENCY in flight at a time. Calls onResolved(id, url) as each
 * one lands (never for a null resolution); never throws. Fire-and-forget —
 * callers don't await this, they just want the tiles to fill in.
 */
export async function warmPictureUrls(pictures, onResolved) {
  const pending = (pictures || []).filter((p) => p?.id && !p.url)
  if (pending.length === 0) return
  let cursor = 0
  async function worker() {
    while (cursor < pending.length) {
      const pic = pending[cursor]
      cursor += 1
      const url = await resolvePictureUrl(pic)
      if (url) onResolved(pic.id, url)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WARM_CONCURRENCY, pending.length) }, worker),
  )
}

/**
 * Teacher search: active pictures matching a term (against name +
 * keywords), optionally narrowed by subject. Firestore has no full-text
 * search, so we pull the (bounded) active set and filter client-side —
 * fine at bank sizes of a few hundred images.
 * Returns { rows, error } — error is set when the query itself failed,
 * so the picker can show "couldn't load" instead of a misleading
 * "no pictures" message.
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
    return {
      rows: rows.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      error: null,
    }
  } catch (err) {
    console.error('searchActivePictures failed', err)
    return { rows: [], error: err?.message || 'Could not load the picture bank.' }
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
  await assertUploadableImage(file)
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
 * Derive a human-ish placeholder name from a file name: drop the extension,
 * swap separators for spaces, collapse whitespace. Used as the staged name
 * until the AI (or admin) supplies a real one.
 */
function nameFromFile(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '')
  const pretty = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return pretty.slice(0, 120) || 'Untitled picture'
}

/**
 * Admin: upload one picture into the bank as STAGED (awaiting tagging). Used
 * by bulk upload — files land in "Needs tagging", then the AI naming agent
 * (or the admin) fills in name + keywords + subject before activation. No
 * keywords required up front, unlike the single active upload.
 */
export async function uploadStagedBankPicture(file, { subject, gradeBand, uid } = {}) {
  await assertUploadableImage(file)

  const ref = doc(collection(db, 'pictureBank'))
  const ext = (String(file.name || '').split('.').pop() || 'png').toLowerCase()
  const storagePath = `picture-bank/uploads/${ref.id}.${ext}`
  const snap = await uploadBytes(storageRef(storage, storagePath), file, {
    contentType: file.type,
  })
  const url = await getDownloadURL(snap.ref)
  const placeholder = nameFromFile(file.name)
  await setDoc(ref, {
    id: ref.id,
    name: placeholder,
    nameLower: placeholder.toLowerCase(),
    subject: String(subject || PICTURE_BANK_SUBJECTS_GENERIC).toLowerCase(),
    gradeBand: String(gradeBand || ''),
    keywords: [],
    storagePath,
    url,
    contentType: file.type,
    source: 'upload',
    status: 'staged',
    sourceNote: `Bulk upload: ${String(file.name || '').slice(0, 180)}`,
    createdBy: uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Admin: bulk-upload many pictures as staged. Uploads run with limited
 * concurrency so a big drop doesn't open hundreds of parallel Storage
 * connections. Returns { ids, failures } — failures are per-file so one bad
 * image doesn't sink the batch.
 */
export async function bulkUploadStagedPictures(files, { subject, gradeBand, uid, onProgress } = {}) {
  const list = Array.from(files || [])
  const ids = []
  const failures = []
  let done = 0
  const CONCURRENCY = 3

  async function worker(queue) {
    for (;;) {
      const item = queue.shift()
      if (!item) return
      try {
        const id = await uploadStagedBankPicture(item, { subject, gradeBand, uid })
        ids.push(id)
      } catch (err) {
        failures.push({ name: item?.name || 'file', error: err?.message || String(err) })
      } finally {
        done += 1
        if (typeof onProgress === 'function') onProgress({ done, total: list.length })
      }
    }
  }

  const queue = [...list]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)),
  )
  return { ids, failures }
}

const functions = getFunctions(app, 'us-central1')
const nameBankPicturesCallable = httpsCallable(functions, 'nameBankPictures')

/**
 * Admin: ask the AI naming agent to look at staged pictures and suggest a
 * name, keywords and subject for each. Writes the suggestions onto the docs
 * (as aiSuggested* fields) server-side; returns { named, total, warnings }.
 * The pictures stay staged — the admin reviews the suggestions and activates.
 */
export async function nameStagedPictures(pictureIds) {
  const ids = (Array.isArray(pictureIds) ? pictureIds : [])
    .map((x) => String(x || '').trim()).filter(Boolean)
  if (!ids.length) throw new Error('No pictures selected to name.')
  try {
    const res = await nameBankPicturesCallable({ pictureIds: ids })
    return res?.data || { named: 0, total: ids.length, warnings: [] }
  } catch (err) {
    const code = err?.code || ''
    if (code.includes('permission-denied')) {
      throw new Error('Only admins can auto-name pictures.')
    }
    if (code.includes('resource-exhausted')) {
      throw new Error('The AI is busy right now — wait a moment and try again.')
    }
    throw new Error(err?.message || 'Auto-naming failed. Please try again.')
  }
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

/**
 * Teacher submission: send a finished Visual Studio picture into the shared
 * bank as STAGED, awaiting admin review/tagging. firestore.rules lets a teacher
 * CREATE a staged doc (source:'teacher', createdBy == uid) but not activate,
 * edit or delete bank pictures — the admin does that via the existing
 * "Needs tagging" queue in PictureBankAdmin.
 */
export async function submitPictureToBank({ url, storagePath = '', name, keywords, subject, gradeBand, uid }) {
  if (!url) throw new Error('Nothing to submit — generate or open a picture first.')
  if (!uid) throw new Error('Please sign in.')
  const cleanName = String(name || 'Untitled picture').trim().slice(0, 120)
  const kw = normaliseKeywords(keywords?.length ? keywords : cleanName)

  const ref = doc(collection(db, 'pictureBank'))
  await setDoc(ref, {
    id: ref.id,
    name: cleanName,
    nameLower: cleanName.toLowerCase(),
    subject: String(subject || PICTURE_BANK_SUBJECTS_GENERIC).toLowerCase(),
    gradeBand: String(gradeBand || ''),
    keywords: kw,
    storagePath: storagePath || '',
    url,
    contentType: 'image/png',
    source: 'teacher',
    status: 'staged',
    sourceNote: `Submitted from Visual Studio${uid ? ` by ${uid}` : ''}`,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}
