// src/features/notes/lib/storage.js
//
// Firebase Storage helpers for note attachments.
// Two upload paths under `lesson-files/{ownerUid}/{assetBatchId}/`:
//   1. Whole-note files (PDF/Word) — used for "file" content notes
//   2. Inline images (under .../inline/) — used by the rich-text editor

import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'firebase/storage'
import { storage } from '../../../firebase/config'
import { assertFileSignature } from '../../../utils/fileSignature'

const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const ALLOWED_IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_DOC_SIZE = 25 * 1024 * 1024   // 25 MB (matches storage.rules + firestore.rules cap)
const MAX_IMG_SIZE =  5 * 1024 * 1024   //  5 MB (matches validLessonImageUpload in storage.rules)

const sanitize = (name) =>
  String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)

// ─── whole-note files (PDF / Word) ───────────────────────────────────

/**
 * Upload a PDF or Word file as the entire content of a note.
 * Calls onProgress(0..100) as it goes.
 * Returns { url, fileName, storagePath, size, contentType }.
 *
 * Path: lesson-files/{ownerUid}/{assetBatchId}/{timestamp}-{filename}
 */
export async function uploadNoteFile({ ownerUid, assetBatchId, file, onProgress }) {
  if (!ownerUid)     throw new Error('uploadNoteFile: ownerUid required')
  if (!assetBatchId) throw new Error('uploadNoteFile: assetBatchId required')
  if (!file)         throw new Error('uploadNoteFile: file required')

  if (!ALLOWED_DOC_TYPES.includes(file.type)) {
    throw new Error('Only PDF or Word documents are allowed.')
  }
  if (file.size > MAX_DOC_SIZE) {
    throw new Error('File is too large (max 25 MB).')
  }
  // The declared type is forgeable — verify the real bytes (STOR-003).
  await assertFileSignature(file, ALLOWED_DOC_TYPES, { label: 'a PDF or Word document' })

  const safeName = sanitize(file.name)
  const path = `lesson-files/${ownerUid}/${assetBatchId}/${Date.now()}-${safeName}`
  const fileRef = ref(storage, path)
  const task = uploadBytesResumable(fileRef, file, { contentType: file.type })

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => {
        if (onProgress) {
          const pct = (snap.bytesTransferred / snap.totalBytes) * 100
          onProgress(Math.round(pct))
        }
      },
      reject,
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref)
          resolve({
            url,
            fileName: file.name,
            storagePath: path,
            size: file.size,
            contentType: file.type,
          })
        } catch (err) { reject(err) }
      },
    )
  })
}

/** Delete a previously-uploaded note file by its Storage path. */
export async function deleteNoteFileByPath(storagePath) {
  if (!storagePath) return
  try {
    await deleteObject(ref(storage, storagePath))
  } catch (err) {
    if (err?.code !== 'storage/object-not-found') throw err
  }
}

// ─── inline images (from the rich-text editor) ───────────────────────

/**
 * Upload an inline image used inside a note's rich-text body.
 * Returns just the download URL — that's what the editor's image node needs.
 *
 * Path: lesson-files/{ownerUid}/{assetBatchId}/inline/{timestamp}-{filename}
 */
export async function uploadInlineImage({ ownerUid, assetBatchId, file }) {
  if (!ownerUid)     throw new Error('uploadInlineImage: ownerUid required')
  if (!assetBatchId) throw new Error('uploadInlineImage: assetBatchId required')
  if (!file)         throw new Error('uploadInlineImage: file required')

  if (!ALLOWED_IMG_TYPES.includes(file.type)) {
    throw new Error('Only PNG, JPG, WebP, or GIF images are allowed.')
  }
  await assertFileSignature(file, ALLOWED_IMG_TYPES, { label: 'a PNG, JPG, WebP or GIF image' })
  if (file.size > MAX_IMG_SIZE) {
    throw new Error('Image is too large (max 5 MB).')
  }

  const safeName = sanitize(file.name)
  const path = `lesson-files/${ownerUid}/${assetBatchId}/inline/${Date.now()}-${safeName}`
  const imgRef = ref(storage, path)
  const task = uploadBytesResumable(imgRef, file, { contentType: file.type })

  await task
  return getDownloadURL(task.snapshot.ref)
}
