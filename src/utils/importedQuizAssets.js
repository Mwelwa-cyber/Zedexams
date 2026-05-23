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
  return next
}
