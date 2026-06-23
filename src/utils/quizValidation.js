// Shared quiz validation.
//
// History: `validateStandaloneQuestion` used to live inside both
// CreateQuizV2.jsx and EditQuizV2.jsx as near-identical copies. When the
// Create copy gained a fix, the Edit copy was silently left broken (and
// vice versa). Extracting to one shared module prevents that drift.

import { richTextHasContent } from './quizRichText.js'
import { findComprehensionGroupingIssues } from './comprehensionGrouping.js'
import { canonicalizeQuestionType, questionTypeLabel } from '../editor/schema/question.js'
import { countBlanks, fillBlanksAnswerKey } from './fillBlanks.js'

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

// Canonical question-type tokens. Authoring surfaces and importers spell some
// of these differently ('truefalse'/'true_false' → 'tf', 'fill_in_blank' →
// 'fill_blanks'); every check below runs on the canonical value so the same
// question validates identically no matter which surface created it.
const MCQ = 'mcq'
// True/False is a 2-option MCQ (options ['True','False'], correctAnswer index),
// so it shares the MCQ completeness checks.
const TF = 'tf'
const SHORT_ANSWER = 'short_answer'
// Legacy short-answer alias kept as its own enum value; treated like SHORT_ANSWER.
const SHORT = 'short'
const DIAGRAM = 'diagram'
const ESSAY = 'essay'
// Single-blank fill ('fill') collects a short typed answer like short-answer;
// the dedicated multi-blank type is 'fill_blanks' (statements + word bank).
const FILL = 'fill'
const FILL_BLANKS = 'fill_blanks'
const NUMERIC = 'numeric'
const HOTSPOT = 'hotspot'
const MATCHING = 'matching'
const SEQUENCE = 'sequence'

// Text-answer types: the expected answer is optional (the runner can ask the
// AI to judge from the stem) so they never block on a missing answer.
const TEXT_ANSWER_TYPES = new Set([SHORT_ANSWER, SHORT, DIAGRAM, ESSAY, FILL])

// ── Per-type completeness checks ──────────────────────────────────
// Each returns a human-readable problem string, or null when the question is
// complete. Kept here (not in the schema) on purpose: the question write
// schema only guarantees SHAPE so auto-save never fails mid-edit, while THIS
// is the pre-publish gate that demands a question actually be answerable +
// markable before a paper is saved or printed.

function numericIssue(question) {
  const raw = question?.correctAnswer
  const value = typeof raw === 'string' ? raw.trim() : raw
  if (value === '' || value == null) return 'needs a numeric answer for the marking key.'
  if (!Number.isFinite(Number(value))) return 'answer must be a number.'
  return null
}

function matchingIssue(question) {
  const left = (Array.isArray(question?.matchingLeft) ? question.matchingLeft : []).map(v => String(v ?? '').trim())
  const right = (Array.isArray(question?.matchingRight) ? question.matchingRight : []).map(v => String(v ?? '').trim())
  const answer = Array.isArray(question?.matchingAnswer) ? question.matchingAnswer : []
  if (left.filter(Boolean).length < 2 || right.filter(Boolean).length < 2) {
    return 'needs at least two matching pairs (fill both columns).'
  }
  for (let i = 0; i < left.length; i++) {
    if (!left[i]) continue
    const idx = Number(answer[i])
    if (!Number.isInteger(idx) || idx < 0 || idx >= right.length || !right[idx]) {
      return 'every prompt needs a correct match selected.'
    }
  }
  return null
}

function sequenceIssue(question) {
  const items = (Array.isArray(question?.sequenceItems) ? question.sequenceItems : []).map(v => String(v ?? '').trim())
  const answer = Array.isArray(question?.sequenceAnswer) ? question.sequenceAnswer : []
  const filledIndexes = items.map((item, i) => (item ? i : -1)).filter(i => i >= 0)
  if (filledIndexes.length < 2) return 'needs at least two items to put in order.'
  const n = filledIndexes.length
  const seen = new Set()
  for (const i of filledIndexes) {
    const pos = Number(answer[i])
    // 1-based positions; they must form a permutation of 1..n (no gaps, no dupes).
    if (!Number.isInteger(pos) || pos < 1 || pos > n || seen.has(pos)) {
      return 'give every item a unique position in the correct order.'
    }
    seen.add(pos)
  }
  return null
}

function fillBlanksIssue(question) {
  const statements = (Array.isArray(question?.statements) ? question.statements : [])
  const withText = statements.filter(s => String(s?.text ?? '').trim().length > 0)
  if (withText.length === 0) return 'needs at least one statement with a blank.'
  const totalBlanks = withText.reduce((sum, s) => sum + countBlanks(s?.text ?? ''), 0)
  // A statement with text but no underscore run has nothing for the learner to
  // fill — point the teacher at the blank marker rather than a vague error.
  if (totalBlanks === 0) return 'each statement needs a blank — type ____ where the answer goes.'
  // Every blank needs an expected answer or the paper can't be marked
  // (fill_blanks is graded deterministically against this key).
  const key = fillBlanksAnswerKey(question)
  if (key.some(answer => !String(answer ?? '').trim())) {
    return 'every blank needs an expected answer for the marking key.'
  }
  return null
}

function hotspotIssue(question) {
  const hasImage = Boolean(String(question?.imageUrl ?? '').trim()) ||
    Boolean(question?.imageDiagram && question.imageDiagram.libraryKey)
  if (!hasImage) return 'needs an image — upload one or pick a diagram from the library.'
  const region = question?.correctRegion
  if (!region || typeof region !== 'object' ||
      !Number.isFinite(Number(region.x)) || !Number.isFinite(Number(region.y))) {
    return 'place a target on the image so it can be marked.'
  }
  return null
}

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

  // Fold aliases ('truefalse' → 'tf', 'fill_in_blank' → 'fill_blanks') so a
  // question authored under any spelling validates as its true type rather than
  // tripping the "unrecognised type" fallback at the bottom.
  const qType = canonicalizeQuestionType(question?.type) || MCQ
  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

  // True/False is a 2-option MCQ — same options + correct-answer completeness.
  if (qType === MCQ || qType === TF) {
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

  if (TEXT_ANSWER_TYPES.has(qType)) {
    // An empty expected answer is intentional: it tells the runner to ask
    // the AI to judge the student's response from the question text, subject,
    // and grade alone. The editor surfaces this with the
    // "If left blank, AI will judge…" hint. Essay answers (sample / rubric)
    // are likewise optional — the question stem is enough.
    return true
  }

  if (qType === NUMERIC) {
    const issue = numericIssue(question)
    if (issue) { notify(`${label} ${issue}`); return false }
    return true
  }

  if (qType === FILL_BLANKS) {
    const issue = fillBlanksIssue(question)
    if (issue) { notify(`${label} ${issue}`); return false }
    return true
  }

  if (qType === HOTSPOT) {
    const issue = hotspotIssue(question)
    if (issue) { notify(`${label} ${issue}`); return false }
    return true
  }

  if (qType === MATCHING) {
    const issue = matchingIssue(question)
    if (issue) { notify(`${label} ${issue}`); return false }
    return true
  }

  if (qType === SEQUENCE) {
    const issue = sequenceIssue(question)
    if (issue) { notify(`${label} ${issue}`); return false }
    return true
  }

  // Genuinely unknown type — block the save with a friendly label so the
  // teacher sees "Question 3 has an unrecognised type (Wormhole)" rather than
  // the raw enum token.
  notify(`${label} has an unrecognised type (${questionTypeLabel(qType)}).`)
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
  // Per-issue `localId` is the question (or passage) localId the issue
  // attaches to, or null for quiz-level issues. Lets the UI map an issue
  // back to the card it touches without parsing the structured id string.
  const push = (id, label, { severity = 'error', localId = null } = {}) =>
    issues.push({ id, label, severity, localId })

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

  // Comprehension grouping: a set of passages where one has every question and
  // its siblings have none is a mis-import — block publishing until it's fixed
  // (manually or via "Auto-group comprehension questions").
  for (const issue of findComprehensionGroupingIssues(sections)) {
    push(`comprehension-grouping-${issue.runStart}`, issue.message, { severity: issue.severity })
  }

  // Walk each section + collect per-question issues.
  for (const section of sections || []) {
    if (section?.kind === 'passage') {
      const passage = section.passage || {}
      const isMap = passage.passageKind === 'map'
      const passageLocalId = passage.localId || null
      if (passage.imageUploading) {
        push(`passage-uploading-${passage.localId || 'unknown'}`,
          isMap ? 'A map image is still uploading.' : 'A passage image is still uploading.',
          { localId: passageLocalId })
      }
      if (isMap && !passage.imageUrl) {
        push(`passage-map-image-${passage.localId || 'unknown'}`, 'Each map section needs a map image.',
          { localId: passageLocalId })
      } else if (!isMap && !richTextHasContent(passage.passageText)) {
        push(`passage-text-${passage.localId || 'unknown'}`, 'Each comprehension passage needs passage text.',
          { localId: passageLocalId })
      }
      if (!Array.isArray(passage.questions) || passage.questions.length === 0) {
        push(`passage-questions-${passage.localId || 'unknown'}`,
          isMap ? 'Each map section needs at least one linked question.'
                : 'Each comprehension passage needs at least one linked question.',
          { localId: passageLocalId })
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
  const localId = question?.localId || null
  if (question?.imageUploading) {
    push(`question-uploading-${question.localId}`,
      `${label}: image is still uploading.`, { localId })
  }
  if (question?.optionImageUploadingIndex != null) {
    push(`opt-uploading-${question.localId}`,
      `${label}: option image is still uploading.`, { localId })
  }
  if (!richTextHasContent(question?.text)) {
    push(`question-text-${question.localId}`,
      `${label}: question text is empty.`, { localId })
  }
  // Fold aliases onto the canonical type so true/false + fill-in-the-blanks
  // questions get their real per-type check instead of the unknown-type blocker.
  const qType = canonicalizeQuestionType(question?.type) || MCQ
  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  if (qType === MCQ || qType === TF) {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      push(`opt-count-${question.localId}`, `${label}: needs at least two options.`, { localId })
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
            `${label}: option ${OPTION_LETTERS[i] || i + 1} is empty.`, { localId })
        }
        if (hasMedia && !hasAlt) {
          push(`opt-alt-${question.localId}-${i}`,
            `${label}: option ${OPTION_LETTERS[i] || i + 1} needs alt text for its image.`, { localId })
        }
      }
      const correctIdx = Number(question.correctAnswer)
      if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= (question.options?.length || 0)) {
        push(`correct-${question.localId}`,
          `${label}: pick the correct answer.`, { localId })
      }
    }
  } else if (qType === NUMERIC) {
    const issue = numericIssue(question)
    if (issue) push(`numeric-${question.localId}`, `${label}: ${issue}`, { localId })
  } else if (qType === FILL_BLANKS) {
    const issue = fillBlanksIssue(question)
    if (issue) push(`fill-blanks-${question.localId}`, `${label}: ${issue}`, { localId })
  } else if (qType === HOTSPOT) {
    const issue = hotspotIssue(question)
    if (issue) push(`hotspot-${question.localId}`, `${label}: ${issue}`, { localId })
  } else if (qType === MATCHING) {
    const issue = matchingIssue(question)
    if (issue) push(`matching-${question.localId}`, `${label}: ${issue}`, { localId })
  } else if (qType === SEQUENCE) {
    const issue = sequenceIssue(question)
    if (issue) push(`sequence-${question.localId}`, `${label}: ${issue}`, { localId })
  } else if (!TEXT_ANSWER_TYPES.has(qType)) {
    // An unknown type is a publish blocker, not a warning — the runner /
    // grader / export paths only handle the recognised set (MCQ / TF /
    // SHORT_ANSWER / SHORT / DIAGRAM / ESSAY / FILL / FILL_BLANKS / NUMERIC /
    // HOTSPOT / MATCHING / SEQUENCE). Letting an unknown type through silently
    // would surface a question the learner can't answer and the grader can't
    // score. Show the friendly label, not the raw token.
    push(`type-${question.localId}`,
      `${label}: unrecognised question type "${questionTypeLabel(qType)}".`, { localId })
  }
}
