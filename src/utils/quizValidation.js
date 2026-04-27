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
  if (!richTextHasContent(question?.text)) {
    notify(`${label} is missing question text.`)
    return false
  }

  const qType = question?.type || MCQ

  if (qType === MCQ) {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      notify(`${label} needs at least two options.`)
      return false
    }
    if (question.options.some(option => !String(option || '').trim())) {
      notify(`${label} has empty options.`)
      return false
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
