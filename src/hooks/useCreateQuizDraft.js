/**
 * Auto-save a new-quiz draft to localStorage so accidental refreshes
 * don't throw away typed work.
 *
 * Scope: only the CreateQuizV2 editor (brand-new quizzes). Existing
 * quizzes go through EditQuizV2 and already have a Firestore record
 * to fall back on, so they aren't covered here.
 *
 * Strategy:
 *   - Key by user id; one draft per user.
 *   - Strip runtime-only fields (uploading flags, in-memory asset
 *     references) before writing — blobs don't survive a refresh.
 *   - Expire after DRAFT_TTL to avoid indefinite accumulation.
 */

const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
const KEY_PREFIX = 'examprep:createquiz:draft:'

function draftKey(userId) {
  return `${KEY_PREFIX}${userId}`
}

function stripQuestionRuntime(question) {
  if (!question) return question
  const {
    imageUploading: _imageUploading,
    imageUploadStep: _imageUploadStep,
    // imageAssetId points at an in-memory blob (document import flow).
    // The blob is gone after refresh, so drop the reference — the typed
    // text is what we care about preserving.
    imageAssetId: _imageAssetId,
    ...rest
  } = question
  return rest
}

function stripSectionsRuntime(sections = []) {
  return sections.map(section => {
    if (section?.kind === 'passage') {
      const passage = section.passage || {}
      const {
        imageUploading: _imageUploading,
        imageUploadStep: _imageUploadStep,
        ...passageRest
      } = passage
      return {
        ...section,
        passage: {
          ...passageRest,
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

export function saveCreateQuizDraft(userId, payload) {
  if (!userId || !payload) return
  try {
    const toSave = {
      form: payload.form,
      sections: stripSectionsRuntime(payload.sections),
      creationMode: payload.creationMode,
      savedAt: Date.now(),
    }
    localStorage.setItem(draftKey(userId), JSON.stringify(toSave))
  } catch {
    // Quota exceeded or private-browsing restriction — ignore
  }
}

export function loadCreateQuizDraft(userId) {
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

export function clearCreateQuizDraft(userId) {
  if (!userId) return
  try {
    localStorage.removeItem(draftKey(userId))
  } catch {
    // Private-browsing restriction — nothing to clean up.
  }
}
