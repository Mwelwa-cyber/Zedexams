/**
 * Auto-save the assessment-studio draft to localStorage so a refresh
 * doesn't throw away typed work. Mirror of useCreateQuizDraft but with
 * a separate localStorage namespace so admin quiz drafts and teacher
 * assessment drafts don't collide.
 */

const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
const KEY_PREFIX = 'examprep:assessmentstudio:draft:'

function draftKey(userId) {
  return `${KEY_PREFIX}${userId}`
}

// A blob: URL is bound to the document that created it. The moment the page
// reloads it becomes a dead reference — every <img> rendered against it
// shows a broken-image icon. Drop these on save so a rehydrated draft never
// surfaces a stale blob URL.
function stripBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:') ? '' : value
}

function stripOptionMediaRuntime(optionMedia) {
  if (!Array.isArray(optionMedia)) return optionMedia
  return optionMedia.map(slot => {
    if (!slot || typeof slot !== 'object') return slot
    if (typeof slot.imageUrl === 'string' && slot.imageUrl.startsWith('blob:')) {
      const { imageUrl: _imageUrl, ...rest } = slot
      return rest
    }
    return slot
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

function stripSectionsRuntime(sections = []) {
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

export function saveAssessmentDraft(userId, payload) {
  if (!userId || !payload) return
  try {
    const toSave = {
      form: payload.form,
      sections: stripSectionsRuntime(payload.sections),
      parts: payload.parts || [],
      creationMode: payload.creationMode,
      savedAt: Date.now(),
    }
    localStorage.setItem(draftKey(userId), JSON.stringify(toSave))
  } catch {
    // Quota exceeded or private-browsing restriction — ignore
  }
}

export function loadAssessmentDraft(userId) {
  if (!userId) return null
  try {
    const raw = localStorage.getItem(draftKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL) {
      localStorage.removeItem(draftKey(userId))
      return null
    }
    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

export function clearAssessmentDraft(userId) {
  if (!userId) return
  try {
    localStorage.removeItem(draftKey(userId))
  } catch {
    // Private-browsing restriction — nothing to clean up.
  }
}
