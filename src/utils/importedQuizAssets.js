/**
 * Safety net for the document-import save flow.
 *
 * documentQuizImporter produces transient blob: URLs for every extracted
 * image so the editor can preview them immediately. Those URLs only live
 * as long as the importing page session: a refresh, a draft autosave that
 * preserved the URL string, or a missed upload step all leave a dead
 * `blob:` URL on the quiz record. Once written to Firestore that URL is
 * permanently broken — every learner sees a missing image and the teacher
 * has no obvious recovery path.
 *
 * `assertNoBlobImageUrls` is the last gate before persisting. It scans
 * every image-bearing field on the questions and passages headed for
 * Firestore and throws if any of them still carries a blob: URL. The
 * thrown error surfaces to the save handler's catch block, the user sees
 * an actionable message ("re-import the document"), and nothing reaches
 * the database.
 */

function isBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:')
}

function* iterateOptionMediaImageUrls(question) {
  const media = Array.isArray(question?.optionMedia) ? question.optionMedia : []
  for (const slot of media) {
    if (slot && typeof slot === 'object' && typeof slot.imageUrl === 'string') {
      yield slot.imageUrl
    }
  }
}

function* iterateExtraImageUrls(question) {
  const images = Array.isArray(question?.images) ? question.images : []
  for (const img of images) {
    if (img && typeof img === 'object' && typeof img.url === 'string') {
      yield img.url
    }
  }
}

/**
 * Throws if any question or passage in the input still carries a blob: URL
 * in a field that would be persisted. Returns silently on success.
 */
export function assertNoBlobImageUrls(questions = [], passages = []) {
  for (const question of questions) {
    if (isBlobUrl(question?.imageUrl)) {
      throw new Error(
        'A question image did not finish uploading. Please re-import the document and try saving again.',
      )
    }
    for (const optionImageUrl of iterateOptionMediaImageUrls(question)) {
      if (isBlobUrl(optionImageUrl)) {
        throw new Error(
          'An option image did not finish uploading. Please re-import the document and try saving again.',
        )
      }
    }
    for (const extraImageUrl of iterateExtraImageUrls(question)) {
      if (isBlobUrl(extraImageUrl)) {
        throw new Error(
          'A question image did not finish uploading. Please re-import the document and try saving again.',
        )
      }
    }
  }

  for (const passage of passages) {
    if (isBlobUrl(passage?.imageUrl)) {
      throw new Error(
        'A passage image did not finish uploading. Please re-import the document and try saving again.',
      )
    }
  }
}

/**
 * Swap a record's transient imported-image references for their uploaded
 * Storage URLs, using a Map<imageAssetId, downloadUrl> produced by the save
 * pass. Mirrors the question/passage transform the save path applies to the
 * Firestore copy — but here it runs on the LIVE editor record so the on-screen
 * figures keep working after the transient blob: URLs are revoked.
 *
 * Without this, saving uploads each imported figure to Storage and then revokes
 * its in-memory blob: URL, while the editor's questions/passages still point at
 * that now-dead blob — so every imported figure that re-mounts (e.g. the crop
 * modal opening from the review screen) renders broken. Returns the same
 * reference when nothing matched, so React can bail out of a no-op re-render.
 */
function applyUploadsToRecord(record, uploadedById) {
  if (!record || typeof record !== 'object') return record
  let next = record
  const swap = (patch) => { next = next === record ? { ...record, ...patch } : { ...next, ...patch } }

  const stemUrl = record.imageAssetId ? uploadedById.get(record.imageAssetId) : null
  if (stemUrl) swap({ imageUrl: stemUrl, imageAssetId: '' })

  if (Array.isArray(record.optionMedia)) {
    let changed = false
    const optionMedia = record.optionMedia.map((slot) => {
      if (!slot || typeof slot !== 'object' || !slot.imageAssetId) return slot
      const url = uploadedById.get(slot.imageAssetId)
      if (!url) return slot
      changed = true
      const { imageAssetId: _unused, ...rest } = slot
      return { ...rest, imageUrl: url }
    })
    if (changed) swap({ optionMedia })
  }

  if (Array.isArray(record.images)) {
    let changed = false
    const images = record.images.map((img) => {
      if (!img || typeof img !== 'object' || !img.imageAssetId) return img
      const url = uploadedById.get(img.imageAssetId)
      if (!url) return img
      changed = true
      const { imageAssetId: _unused, ...rest } = img
      return { ...rest, url }
    })
    if (changed) swap({ images })
  }

  return next
}

/**
 * Walk the editor's sections and replace every imported figure's transient
 * blob: reference with its uploaded Storage URL (keyed by imageAssetId).
 * Handles standalone questions, passages, and passage sub-questions, including
 * their per-option media and stacked extra figures. Returns the same `sections`
 * reference when nothing changed.
 */
export function applyUploadedImageUrls(sections = [], uploadedById) {
  if (!uploadedById || typeof uploadedById.get !== 'function' || uploadedById.size === 0) {
    return sections
  }
  let anyChange = false
  const out = sections.map((section) => {
    if (!section || typeof section !== 'object') return section
    if (section.kind === 'passage') {
      const passage = section.passage
      if (!passage || typeof passage !== 'object') return section
      const nextPassageBase = applyUploadsToRecord(passage, uploadedById)
      let questionsChanged = false
      const questions = Array.isArray(passage.questions)
        ? passage.questions.map((q) => {
            const nq = applyUploadsToRecord(q, uploadedById)
            if (nq !== q) questionsChanged = true
            return nq
          })
        : passage.questions
      if (nextPassageBase === passage && !questionsChanged) return section
      anyChange = true
      const nextPassage = nextPassageBase === passage ? { ...passage } : nextPassageBase
      if (questionsChanged) nextPassage.questions = questions
      return { ...section, passage: nextPassage }
    }
    const question = section.question
    if (!question || typeof question !== 'object') return section
    const nextQuestion = applyUploadsToRecord(question, uploadedById)
    if (nextQuestion === question) return section
    anyChange = true
    return { ...section, question: nextQuestion }
  })
  return anyChange ? out : sections
}

/**
 * Strip blob: URLs from a question or passage record. Used by the draft
 * autosave path so a refresh doesn't leave a dead blob: URL on the
 * rehydrated draft — the matching `imageAssetId` is also gone after the
 * blob is released, so the editor can re-import the document instead of
 * showing a broken image.
 */
export function stripBlobImageUrls(record) {
  if (!record) return record
  const next = { ...record }
  if (isBlobUrl(next.imageUrl)) {
    next.imageUrl = ''
  }
  if (Array.isArray(next.optionMedia)) {
    next.optionMedia = next.optionMedia.map(slot => {
      if (!slot || typeof slot !== 'object') return slot
      if (isBlobUrl(slot.imageUrl)) {
        const { imageUrl: _imageUrl, ...rest } = slot
        return rest
      }
      return slot
    })
  }
  // Drop any stacked extra figure whose blob: URL did not survive (its
  // matching crop asset is gone too, so it can only be re-imported).
  if (Array.isArray(next.images)) {
    next.images = next.images.filter(img => !(img && isBlobUrl(img.url)))
  }
  return next
}
