// Shared quiz validation.
//
// History: `validateStandaloneQuestion` used to live inside both
// CreateQuizV2.jsx and EditQuizV2.jsx as near-identical copies. When the
// Create copy gained a fix, the Edit copy was silently left broken (and
// vice versa). Extracting to one shared module prevents that drift.

import { richTextHasContent } from './quizRichText.js'

const MCQ = 'mcq'
const SHORT_ANSWER = 'short_answer'
const DIAGRAM = 'diagram'

/**
 * Validate a standalone quiz question before save.
 *
 * @param {object}   question - the in-memory question (may be from passage or standalone)
 * @param {string}   label    - human-readable label shown in error toasts, e.g. "Question 3"
 * @param {object}   opts
 * @param {function} opts.onError - called as onError(messageString) for each failure
 *                                  (typically the component's toast function)
 * @returns {boolean} true if valid, false if any check fails
 */
export function validateStandaloneQuestion(question, label, { onError } = {}) {
  const notify = typeof onError === 'function' ? onError : () => {}

  if (question?.imageUploading) {
    notify(`${label} image is still uploading. Please wait.`)
    return false
  }
  if (question?.optionImageUploadingIndex != null) {
    notify(`${label} option image is still uploading. Please wait.`)
    return false
  }
  if (!richTextHasContent(question?.text)) {
    notify(`${label} is missing question text.`)
    return false
  }

  const qType = question?.type || MCQ
  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

  if (qType === MCQ) {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      notify(`${label} needs at least two options.`)
      return false
    }
    const media = Array.isArray(question.optionMedia) ? question.optionMedia : []
    for (let i = 0; i < question.options.length; i++) {
      const text = String(question.options[i] || '').trim()
      const slot = media[i]
      const hasImage = Boolean(slot && slot.imageUrl)
      const hasDiagram = Boolean(slot && slot.diagram && slot.diagram.libraryKey)
      const hasMedia = hasImage || hasDiagram
      const hasAlt = hasMedia && String(slot.alt || '').trim().length > 0
      // An option is valid if it has text, OR media (image / library diagram)
      // with alt text. Alt text is mandatory when any media is present — both
      // for screen readers and so the AI grader knows what it represents.
      if (!text && !hasMedia) {
        notify(`${label} has empty options.`)
        return false
      }
      if (hasMedia && !hasAlt) {
        const kind = hasDiagram && !hasImage ? 'diagram' : 'image'
        notify(`${label} option ${OPTION_LETTERS[i] || i + 1} has ${kind === 'diagram' ? 'a diagram' : 'an image'} — add an alt-text description.`)
        return false
      }
    }
    const correctIdx = Number(question.correctAnswer)
    if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= question.options.length) {
      notify(`${label} needs a correct answer selected.`)
      return false
    }
    return true
  }

  if (qType === SHORT_ANSWER || qType === DIAGRAM) {
    // An empty expected answer is intentional: it tells the runner to ask
    // the AI to judge the student's response from the question text, subject,
    // and grade alone. The editor surfaces this with the
    // "If left blank, AI will judge…" hint.
    return true
  }

  // Unknown types: allow but warn so unknown content doesn't silently block saves.
  notify(`${label} has an unrecognised type (${qType}).`)
  return false
}
