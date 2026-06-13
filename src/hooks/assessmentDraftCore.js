/**
 * Firebase-free core for the Assessment Studio draft system.
 *
 * Everything here is pure (no Firestore, no React) so it can be unit tested
 * under plain `node`. The localStorage + Firestore I/O lives in
 * useAssessmentDraft.js, which imports these helpers.
 */

export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
export const KEY_PREFIX = 'examprep:assessmentstudio:draft:'
// Primary (client-side) cap on the mirrored draft: ~900 KiB (921,600 chars).
// Comfortably under Firestore's 1 MiB (1,048,576-byte) document limit, leaving
// headroom for the JSON wrapper + metadata; the rules enforce their own
// server-side cap. A draft bigger than this (huge image-heavy paper) simply
// isn't mirrored remotely — localStorage still holds it on this device.
export const REMOTE_MAX_CHARS = 900 * 1024 // 921,600 chars

export function draftKey(userId) {
  return `${KEY_PREFIX}${userId}`
}

// A blob: URL is bound to the document that created it. The moment the page
// reloads it becomes a dead reference — every <img> rendered against it
// shows a broken-image icon. Drop these on save so a rehydrated draft never
// surfaces a stale blob URL.
function stripBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:') ? '' : value
}

// Phase 3 layer: per-option imports may stamp a blob: URL on
// optionMedia[i].imageUrl alongside an imageAssetId. Both die when the page
// session ends, so drop them both while persisting any alt / diagram fields.
function stripOptionMediaRuntime(optionMedia) {
  if (!Array.isArray(optionMedia)) return optionMedia
  return optionMedia.map(slot => {
    if (!slot || typeof slot !== 'object') return slot
    const next = { ...slot }
    if (typeof next.imageUrl === 'string' && next.imageUrl.startsWith('blob:')) {
      delete next.imageUrl
    }
    if (next.imageAssetId) delete next.imageAssetId
    return next
  })
}

function stripQuestionRuntime(question) {
  if (!question) return question
  const {
    imageUploading: _imageUploading,
    imageUploadStep: _imageUploadStep,
    imageAssetId: _imageAssetId,
    ...rest
  } = question
  return {
    ...rest,
    imageUrl: stripBlobUrl(rest.imageUrl),
    optionMedia: stripOptionMediaRuntime(rest.optionMedia),
  }
}

export function stripSectionsRuntime(sections = []) {
  return sections.map(section => {
    if (section?.kind === 'passage') {
      const passage = section.passage || {}
      const {
        imageUploading: _imageUploading,
        imageUploadStep: _imageUploadStep,
        imageAssetId: _imageAssetId,
        ...passageRest
      } = passage
      return {
        ...section,
        passage: {
          ...passageRest,
          imageUrl: stripBlobUrl(passageRest.imageUrl),
          questions: (passage.questions || []).map(stripQuestionRuntime),
        },
      }
    }
    return {
      ...section,
      question: stripQuestionRuntime(section?.question),
    }
  })
}

// Build the persisted shape once so the local + remote layers stay identical.
// Runtime-only fields (blob URLs, upload flags) are stripped here.
export function buildDraftPayload(payload) {
  return {
    form: payload.form,
    sections: stripSectionsRuntime(payload.sections),
    parts: payload.parts || [],
    creationMode: payload.creationMode,
    view: payload.view,
    savedAt: Date.now(),
  }
}

// A parsed draft is only usable if it isn't stale and actually carries work.
export function isLiveDraft(parsed) {
  if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL) return false
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) return false
  return true
}

/**
 * Pure last-write-wins picker between a local and a remote draft. Returns
 * `{ draft, source }` where source is 'remote' when the cloud copy is newer
 * (i.e. the paper was last edited on another device).
 */
export function pickFreshestDraft(local, remote) {
  if (local && remote) {
    return (remote.savedAt || 0) > (local.savedAt || 0)
      ? { draft: remote, source: 'remote' }
      : { draft: local, source: 'local' }
  }
  if (remote) return { draft: remote, source: 'remote' }
  if (local) return { draft: local, source: 'local' }
  return { draft: null, source: null }
}
