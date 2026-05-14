// Shared quiz validation.
//
// History: `validateStandaloneQuestion` used to live inside both
// CreateQuizV2.jsx and EditQuizV2.jsx as near-identical copies. When the
// Create copy gained a fix, the Edit copy was silently left broken (and
// vice versa). Extracting to one shared module prevents that drift.

import { richTextHasContent } from './quizRichText.js'

/**
 * Check whether an answer-option value carries any meaningful content.
 * Handles plain strings, Tiptap JSON objects, and stringified Tiptap docs
 * (the post Grade-7 storage shape). Empty `<p></p>` paragraphs don't count
 * — neither does a doc with just whitespace text nodes.
 */
function optionHasContent(value) {
  if (value == null) return false
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return false
    // Tiptap JSON string — defer to the rich-text helper which understands
    // both HTML strings and stringified docs.
    if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
      return richTextHasContent(trimmed)
    }
    return true
  }
  if (typeof value === 'object') return richTextHasContent(value)
  return Boolean(value)
}

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
      // Options can now be rich (Tiptap JSON / JSON-string) or plain text.
      // optionHasContent handles all three so a fraction-only option
      // doesn't get flagged as "empty".
      const hasText = optionHasContent(question.options[i])
      const slot = media[i]
      const hasImage = Boolean(slot && slot.imageUrl)
      const hasDiagram = Boolean(slot && slot.diagram && slot.diagram.libraryKey)
      const hasMedia = hasImage || hasDiagram
      const hasAlt = hasMedia && String(slot.alt || '').trim().length > 0
      // An option is valid if it has text, OR media (image / library diagram)
      // with alt text. Alt text is mandatory when any media is present — both
      // for screen readers and so the AI grader knows what it represents.
      if (!hasText && !hasMedia) {
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

/**
 * Collect all validation issues across a quiz form WITHOUT bailing on the
 * first failure. Returns a structured array the pre-publish checklist
 * modal can render — every issue at once instead of "Save → toast → fix →
 * Save → toast → fix" loops.
 *
 * @param {object} input
 * @param {{ title?: string, subject?: string, grade?: string|number }} input.form
 * @param {Array}  input.sections   — the editor's in-memory `sections` array
 * @param {Array}  input.parts      — `parts` array
 * @param {Object<string,string|number>} input.questionNumbers — map of localId → display number
 * @returns {{ issues: Array, summary: Array }}
 *   issues   — { id, severity:'error'|'warn', label }[]
 *   summary  — { label, ok }[] for the "checklist" view
 */
export function collectQuizIssues({ form = {}, sections = [], parts = [], questionNumbers = {} } = {}) {
  const issues = []
  const push = (id, label, severity = 'error') =>
    issues.push({ id, label, severity })

  // Top-level form fields.
  const title = String(form.title ?? '').trim()
  const subject = String(form.subject ?? '').trim()
  const grade = form.grade
  if (!title) push('title', 'Quiz title is required.')
  if (!subject) push('subject', 'Pick a subject.')
  if (grade === null || grade === undefined || grade === '') push('grade', 'Pick a grade.')

  // Question count.
  const allQuestions = sections.flatMap((section) => {
    if (section?.kind === 'passage') {
      return Array.isArray(section.passage?.questions) ? section.passage.questions : []
    }
    return section?.question ? [section.question] : []
  })
  if (allQuestions.length === 0) {
    push('no-questions', 'Add at least one question.')
  }

  // Parts must have titles + members.
  for (const part of parts || []) {
    if (!String(part?.title ?? '').trim()) {
      push(`part-title-${part?.id || 'unknown'}`, 'Every Part needs a title (e.g. "QUESTIONS 1-15").')
    }
    const hasMembers = sections.some((section) => {
      if (section.kind === 'passage') return section.partId === part.id
      return section.question?.partId === part.id
    })
    if (!hasMembers) {
      push(`part-empty-${part?.id || 'unknown'}`, `Part "${part?.title || 'Untitled'}" has no questions assigned.`)
    }
  }

  // Walk each section + collect per-question issues.
  for (const section of sections || []) {
    if (section?.kind === 'passage') {
      const passage = section.passage || {}
      const isMap = passage.passageKind === 'map'
      if (passage.imageUploading) {
        push(`passage-uploading-${passage.localId || 'unknown'}`,
          isMap ? 'A map image is still uploading.' : 'A passage image is still uploading.')
      }
      if (isMap && !passage.imageUrl) {
        push(`passage-map-image-${passage.localId || 'unknown'}`, 'Each map section needs a map image.')
      } else if (!isMap && !richTextHasContent(passage.passageText)) {
        push(`passage-text-${passage.localId || 'unknown'}`, 'Each comprehension passage needs passage text.')
      }
      if (!Array.isArray(passage.questions) || passage.questions.length === 0) {
        push(`passage-questions-${passage.localId || 'unknown'}`,
          isMap ? 'Each map section needs at least one linked question.'
                : 'Each comprehension passage needs at least one linked question.')
      } else {
        for (const question of passage.questions) {
          const label = `Passage question ${questionNumbers[question.localId] ?? '?'}`
          collectQuestionIssues(question, label, push)
        }
      }
      continue
    }

    const question = section?.question
    if (!question) continue
    const label = `Question ${questionNumbers[question.localId] ?? '?'}`
    collectQuestionIssues(question, label, push)
  }

  // Summary checklist: high-level "ready" view. We use issue presence to
  // flip each item green or red.
  const has = (idPrefix) => issues.some((i) => i.id.startsWith(idPrefix))
  const summary = [
    { label: 'Title set', ok: !has('title') },
    { label: 'Subject set', ok: !has('subject') },
    { label: 'Grade set', ok: !has('grade') },
    { label: 'At least one question', ok: !has('no-questions') },
    { label: 'Questions have answer options', ok: !issues.some((i) => i.id.startsWith('opt-')) },
    { label: 'Correct answer chosen for each question', ok: !issues.some((i) => i.id.startsWith('correct-')) },
    { label: 'Images uploaded (none in progress)', ok: !issues.some((i) => i.id.includes('uploading')) },
    { label: 'Image options have alt text', ok: !issues.some((i) => i.id.startsWith('opt-alt-')) },
  ]
  return { issues, summary }
}

function collectQuestionIssues(question, label, push) {
  if (question?.imageUploading) {
    push(`question-uploading-${question.localId}`,
      `${label}: image is still uploading.`)
  }
  if (question?.optionImageUploadingIndex != null) {
    push(`opt-uploading-${question.localId}`,
      `${label}: option image is still uploading.`)
  }
  if (!richTextHasContent(question?.text)) {
    push(`question-text-${question.localId}`,
      `${label}: question text is empty.`)
  }
  const qType = question?.type || MCQ
  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  if (qType === MCQ) {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      push(`opt-count-${question.localId}`, `${label}: needs at least two options.`)
    } else {
      const media = Array.isArray(question.optionMedia) ? question.optionMedia : []
      for (let i = 0; i < question.options.length; i++) {
        const hasText = optionHasContent(question.options[i])
        const slot = media[i]
        const hasImage = Boolean(slot && slot.imageUrl)
        const hasDiagram = Boolean(slot && slot.diagram && slot.diagram.libraryKey)
        const hasMedia = hasImage || hasDiagram
        const hasAlt = hasMedia && String(slot.alt || '').trim().length > 0
        if (!hasText && !hasMedia) {
          push(`opt-empty-${question.localId}-${i}`,
            `${label}: option ${OPTION_LETTERS[i] || i + 1} is empty.`)
        }
        if (hasMedia && !hasAlt) {
          push(`opt-alt-${question.localId}-${i}`,
            `${label}: option ${OPTION_LETTERS[i] || i + 1} needs alt text for its image.`)
        }
      }
      const correctIdx = Number(question.correctAnswer)
      if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= (question.options?.length || 0)) {
        push(`correct-${question.localId}`,
          `${label}: pick the correct answer.`)
      }
    }
  } else if (qType !== SHORT_ANSWER && qType !== DIAGRAM) {
    push(`type-${question.localId}`,
      `${label}: unrecognised question type "${qType}".`, 'warn')
  }
}
