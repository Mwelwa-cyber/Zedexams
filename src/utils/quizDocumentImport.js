/**
 * Document-import helpers shared between the quiz creation and edit flows.
 *
 * documentQuizImporter extracts questions plus an in-memory map of image
 * blobs (keyed by an opaque assetId). Before a quiz is written to
 * Firestore those blobs must land in Firebase Storage and the assetId
 * references on questions / passages must be rewritten to permanent
 * imageUrl strings — otherwise a `blob:` URL would persist and break for
 * every learner on reload.
 *
 * The upload helpers take their dependencies (storage handle, current uid)
 * as arguments so they stay decoupled from any single editor surface and
 * are easy to unit-test.
 */

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage'
import { createStandaloneSection } from './quizSections.js'

export function safeStorageName(value, fallback = 'asset') {
  const cleaned = String(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || fallback
}

export function assetsById(assets = []) {
  return Object.fromEntries(assets.map(asset => [asset.id, asset]))
}

export function buildStandaloneSection(question = {}) {
  const type = question.type ?? 'mcq'
  const isTextAnswer = type === 'short_answer' || type === 'diagram'

  return createStandaloneSection({
    ...question,
    sharedInstruction: question.sharedInstruction ?? '',
    text: question.text ?? '',
    options: isTextAnswer
      ? []
      : Array.isArray(question.options) && question.options.length
        ? question.options
        : ['', '', '', ''],
    correctAnswer: isTextAnswer
      ? String(question.correctAnswer ?? '')
      : question.correctAnswer ?? 0,
    explanation: question.explanation ?? '',
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    type,
    detectedType: question.detectedType ?? type,
    imageUrl: question.imageUrl ?? '',
    imageUploading: false,
    imageUploadStep: '',
    imageAssetId: question.imageAssetId ?? '',
    diagramText: question.diagramText ?? '',
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
  })
}

// Canvas-based image compression used before each import upload so a
// 5-MB scanned page lands as a ~200-KB JPEG. Mirrors the per-editor
// helpers so the import path doesn't depend on which editor is calling.
export function compressImportedImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = image
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width)
        width = maxWidth
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(image, 0, 0, width, height)
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Canvas compression failed'))),
        'image/jpeg',
        quality,
      )
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not load imported image'))
    }

    image.src = objectUrl
  })
}

/**
 * Upload each in-memory imported image blob to Firebase Storage and
 * return a Map<assetId, downloadUrl>. Cleans up partial uploads on error
 * so a mid-way failure does not orphan blobs in Storage.
 */
export async function uploadImportedAssets({
  storage,
  uid,
  assets,
  assetIds,
  kindSlug,
  sourceFileName = '',
  compressImage = compressImportedImage,
}) {
  const uploadedById = new Map()
  if (!assetIds.length) return uploadedById
  if (!uid) throw new Error('Please sign in before saving imported quiz images.')

  const uploadedRefs = []
  try {
    for (const assetId of assetIds) {
      const asset = assets[assetId]
      if (!asset?.blob) {
        throw new Error('An imported image is no longer available. Please re-import the document.')
      }

      const sourceFile = new File([asset.blob], asset.fileName || `${assetId}.jpg`, {
        type: asset.contentType || 'image/jpeg',
      })
      const uploadBlob = await compressImage(sourceFile)
      const fileName = `${Date.now()}-${kindSlug}-${safeStorageName(assetId)}.jpg`
      const path = `quiz-images/${uid}/imports/${fileName}`
      const ref = storageRef(storage, path)
      const snapshot = await uploadBytes(ref, uploadBlob, {
        contentType: 'image/jpeg',
        customMetadata: {
          sourceFileName: sourceFileName || '',
          sourcePath: asset.sourcePath || '',
        },
      })
      uploadedRefs.push(snapshot.ref)
      uploadedById.set(assetId, await getDownloadURL(snapshot.ref))
    }
  } catch (error) {
    await Promise.all(uploadedRefs.map(ref =>
      deleteObject(ref).catch(cleanupError =>
        console.warn('Orphaned upload cleanup failed:', cleanupError),
      ),
    ))
    throw error
  }
  return uploadedById
}

export async function uploadImportedQuestionImages(questionsToSave, ctx) {
  const assetIds = new Set()
  questionsToSave.forEach(question => {
    if (question.imageAssetId) assetIds.add(question.imageAssetId)
    if (Array.isArray(question.optionMedia)) {
      question.optionMedia.forEach(slot => {
        if (slot && typeof slot === 'object' && slot.imageAssetId) {
          assetIds.add(slot.imageAssetId)
        }
      })
    }
  })
  const uploadedById = await uploadImportedAssets({
    ...ctx,
    assetIds: Array.from(assetIds),
    kindSlug: 'question',
  })
  if (!uploadedById.size) return questionsToSave

  return questionsToSave.map(question => {
    const next = { ...question }
    const stemUrl = uploadedById.get(question.imageAssetId)
    if (stemUrl) {
      next.imageUrl = stemUrl
      next.imageAssetId = ''
    }
    if (Array.isArray(question.optionMedia)) {
      next.optionMedia = question.optionMedia.map(slot => {
        if (!slot || typeof slot !== 'object') return slot
        const url = slot.imageAssetId ? uploadedById.get(slot.imageAssetId) : null
        if (!url) return slot
        const { imageAssetId: _unused, ...rest } = slot
        return { ...rest, imageUrl: url }
      })
    }
    return next
  })
}

export async function uploadImportedPassageImages(passagesToSave, ctx) {
  const assetIds = Array.from(
    new Set(passagesToSave.map(passage => passage.imageAssetId).filter(Boolean)),
  )
  const uploadedById = await uploadImportedAssets({
    ...ctx,
    assetIds,
    kindSlug: 'passage',
  })
  if (!uploadedById.size) return passagesToSave

  return passagesToSave.map(passage => {
    const uploadedUrl = uploadedById.get(passage.imageAssetId)
    if (!uploadedUrl) return passage
    return {
      ...passage,
      imageUrl: uploadedUrl,
      imageAssetId: '',
    }
  })
}
