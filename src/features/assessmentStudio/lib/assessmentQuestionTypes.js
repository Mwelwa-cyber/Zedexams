/**
 * Canonical question-type constants shared by the studio's inline card select
 * (AssessmentQuestionBlock), the EditorSlide select (AssessmentSlideOvers),
 * and the passage-child type select (AssessmentBlocks).
 *
 * Single source of truth — add a type here and it appears everywhere.
 */

/**
 * All 8 studio question types with display labels. Used to build <select>
 * option lists consistently across every type picker in the studio.
 */
export const STUDIO_QUESTION_TYPE_OPTIONS = [
  { value: 'mcq',          label: 'Multiple choice' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'diagram',      label: 'Structured / diagram' },
  { value: 'essay',        label: 'Essay' },
  { value: 'numeric',      label: 'Numeric / calculation' },
  { value: 'matching',     label: 'Matching' },
  { value: 'sequence',     label: 'Sequence / ordering' },
  { value: 'fill_blanks',  label: 'Fill in the blanks' },
]

/**
 * Fold legacy quiz-path type aliases onto the studio canonical for <select>
 * display. Bank-inserted questions may carry 'fill' or 'short' (from the quiz
 * editor path — see src/utils/questionType.js:34-37); coerce them to the
 * studio canonical so the select always shows a recognised option.
 *
 * NOTE: The tolerance branches in AssessmentSlideOvers.jsx and
 * AssessmentQuestionBlock.jsx that handle 'fill' / 'short' at render time are
 * intentionally kept — they serve legacy content already in Firestore.
 */
export function typeSelectValue(type) {
  if (type === 'fill' || type === 'fill_blank' || type === 'fill_in_blank') return 'fill_blanks'
  if (type === 'short') return 'short_answer'
  return type || 'mcq'
}

/**
 * Build a patch object for a type change on an existing question. Seeds ONLY
 * the type-specific fields that are missing on the question, so existing
 * content (text, marks, topic) is never overwritten. Mirrors the handleBlockPick
 * defaults in AssessmentStudio.jsx.
 *
 * @param {object} question - Current question object.
 * @param {string} nextType - The new canonical type to switch to.
 * @returns {object} Patch to spread onto the question.
 */
export function patchForTypeChange(question, nextType) {
  const patch = { type: nextType, detectedType: nextType }

  switch (nextType) {
    case 'mcq':
      // Seed options only if missing; keep a valid correctAnswer index.
      if (!Array.isArray(question.options) || question.options.length === 0) {
        patch.options = ['', '', '', '']
      }
      if (typeof question.correctAnswer !== 'number') {
        patch.correctAnswer = 0
      }
      break

    case 'short_answer':
    case 'diagram':
    case 'essay':
      // Text-answer types: correctAnswer is a string, options not used.
      if (typeof question.correctAnswer !== 'string') {
        patch.correctAnswer = String(question.correctAnswer ?? '')
      }
      break

    case 'numeric':
      if (typeof question.correctAnswer !== 'string') {
        patch.correctAnswer = String(question.correctAnswer ?? '')
      }
      if (question.numericTolerance == null) patch.numericTolerance = 0
      if (question.numericUnit == null) patch.numericUnit = ''
      break

    case 'matching':
      if (!Array.isArray(question.matchingLeft) || question.matchingLeft.length === 0) {
        patch.matchingLeft = ['', '', '']
      }
      if (!Array.isArray(question.matchingRight) || question.matchingRight.length === 0) {
        patch.matchingRight = ['', '', '']
      }
      if (!Array.isArray(question.matchingAnswer) || question.matchingAnswer.length === 0) {
        patch.matchingAnswer = [-1, -1, -1]
      }
      if (typeof question.correctAnswer !== 'string') {
        patch.correctAnswer = ''
      }
      break

    case 'sequence':
      if (!Array.isArray(question.sequenceItems) || question.sequenceItems.length === 0) {
        patch.sequenceItems = ['', '', '', '']
      }
      if (!Array.isArray(question.sequenceAnswer) || question.sequenceAnswer.length === 0) {
        patch.sequenceAnswer = [0, 0, 0, 0]
      }
      if (typeof question.correctAnswer !== 'string') {
        patch.correctAnswer = ''
      }
      break

    case 'fill_blanks':
      if (!Array.isArray(question.statements) || question.statements.length === 0) {
        patch.statements = [
          { text: '', answers: [''] },
          { text: '', answers: [''] },
          { text: '', answers: [''] },
          { text: '', answers: [''] },
        ]
      }
      if (!Array.isArray(question.wordBank)) {
        patch.wordBank = []
      }
      if (typeof question.correctAnswer !== 'string') {
        patch.correctAnswer = ''
      }
      break

    default:
      break
  }

  return patch
}
