/**
 * Is this question finished enough to print?
 *
 * Part of the shared assessment package (see ../README.md). Environment-neutral.
 *
 * ## What moved and what did not
 *
 * The BLOCKING rules moved: the per-type completeness checks, the option and
 * correct-answer checks, and the paper-level details. They decide whether a
 * paper may leave the building, so the studio and the export callable have to
 * run the same ones — that was the whole point.
 *
 * The editor-only concerns stayed in `src/utils/quizValidation.js`: the
 * checklist summary the pre-publish modal renders, the "still uploading" flags
 * (live editor state a saved paper cannot have), the Part membership rules
 * (Parts are an authoring construct), and comprehension grouping's UI wiring.
 * `collectQuizIssues` now calls into here for everything else, so there is one
 * definition of "unfinished" and one place to change it.
 *
 * ## Identity comes from the adapter, never from the question
 *
 * The core does NOT look for `localId`. It is handed `{ question, identity,
 * number }` and keys its issues on `identity`, because the two callers know
 * different things:
 *
 *   live studio     `localId`, minted by the editor and never persisted
 *   saved paper     the Firestore document id, or failing that its position
 *
 * A core that reached for `localId` itself would produce `question-text-
 * undefined` for every saved question, an empty `numbers` array, and a blocked
 * paper whose message names nothing — the failure that looks most like success.
 * `number` is the DISPLAY-ORDER number, so a stored question with no `localId`
 * still produces "Question 3 is not finished" rather than an unnamed blocker.
 */

import { richTextHasContent } from './richTextContentCore.js'
import { canonicalizeQuestionType, questionTypeLabel } from './questionTypeCore.js'
import { countBlanks, fillBlanksAnswerKey } from './fillBlanksCore.js'

/* ── canonical type tokens ─────────────────────────────────────────────── */

const MCQ = 'mcq'
const TF = 'tf'
const SHORT_ANSWER = 'short_answer'
const SHORT = 'short'
const DIAGRAM = 'diagram'
const ESSAY = 'essay'
const FILL = 'fill'
const FILL_BLANKS = 'fill_blanks'
const NUMERIC = 'numeric'
const HOTSPOT = 'hotspot'
const DIAGRAM_LABEL = 'diagram_label'
const MATCHING = 'matching'
const SEQUENCE = 'sequence'

/**
 * Types whose expected answer is optional: the runner can ask the AI to judge
 * from the stem, subject and grade alone, so a blank answer is a choice rather
 * than an omission.
 */
const TEXT_ANSWER_TYPES = new Set([SHORT_ANSWER, SHORT, DIAGRAM, ESSAY, FILL])

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/* ── per-type completeness ─────────────────────────────────────────────── */
/* Each returns a problem string, or null when the question is complete. */

export function optionHasContent(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return false
    if (trimmed.startsWith('{') && trimmed.includes('"type"')) return richTextHasContent(trimmed)
    return true
  }
  if (typeof value === 'object') return richTextHasContent(value)
  return Boolean(value)
}

function numericIssue(question) {
  const raw = question?.correctAnswer
  const value = typeof raw === 'string' ? raw.trim() : raw
  if (value === '' || value === null || value === undefined) {
    return 'needs a numeric answer for the marking key.'
  }
  if (!Number.isFinite(Number(value))) return 'answer must be a number.'
  return null
}

function matchingIssue(question) {
  const left = (Array.isArray(question?.matchingLeft) ? question.matchingLeft : []).map((v) => String(v ?? '').trim())
  const right = (Array.isArray(question?.matchingRight) ? question.matchingRight : []).map((v) => String(v ?? '').trim())
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
  const items = (Array.isArray(question?.sequenceItems) ? question.sequenceItems : []).map((v) => String(v ?? '').trim())
  const answer = Array.isArray(question?.sequenceAnswer) ? question.sequenceAnswer : []
  const filledIndexes = items.map((item, i) => (item ? i : -1)).filter((i) => i >= 0)
  if (filledIndexes.length < 2) return 'needs at least two items to put in order.'
  const n = filledIndexes.length
  const seen = new Set()
  for (const i of filledIndexes) {
    const pos = Number(answer[i])
    if (!Number.isInteger(pos) || pos < 1 || pos > n || seen.has(pos)) {
      return 'give every item a unique position in the correct order.'
    }
    seen.add(pos)
  }
  return null
}

function fillBlanksIssue(question) {
  const statements = Array.isArray(question?.statements) ? question.statements : []
  const withText = statements.filter((s) => String(s?.text ?? '').trim().length > 0)
  if (withText.length === 0) return 'needs at least one statement with a blank.'
  const totalBlanks = withText.reduce((sum, s) => sum + countBlanks(s?.text ?? ''), 0)
  if (totalBlanks === 0) return 'each statement needs a blank — type ____ where the answer goes.'
  const key = fillBlanksAnswerKey(question)
  if (key.some((answer) => !String(answer ?? '').trim())) {
    return 'every blank needs an expected answer for the marking key.'
  }
  return null
}

function hasFigure(question) {
  return Boolean(String(question?.imageUrl ?? '').trim())
    || Boolean(question?.imageDiagram && question.imageDiagram.libraryKey)
}

function hotspotIssue(question) {
  if (!hasFigure(question)) return 'needs an image — upload one or pick a diagram from the library.'
  const region = question?.correctRegion
  if (!region || typeof region !== 'object'
      || !Number.isFinite(Number(region.x)) || !Number.isFinite(Number(region.y))) {
    return 'place a target on the image so it can be marked.'
  }
  return null
}

function diagramLabelIssue(question) {
  if (!hasFigure(question)) return 'needs an image — upload one or pick a diagram from the library.'
  const labels = Array.isArray(question?.diagramLabels) ? question.diagramLabels : []
  if (labels.filter((label) => String(label?.text ?? '').trim().length > 0).length === 0) {
    return 'click the image to add at least one numbered part, then type its name.'
  }
  return null
}

/* ── the per-question rule set ─────────────────────────────────────────── */

/**
 * Every blocking issue on ONE question.
 *
 * @param {object} question the question, in either the editor or the stored shape
 * @param {object} context
 * @param {string} context.identity the key the CALLER uses to find this question again
 * @param {string} context.label    what the teacher is shown, e.g. "Question 3"
 * @returns {Array<{id, label, severity, localId}>}
 *
 * `localId` on the returned issue is the adapter's identity under the field name
 * the studio already reads. Renaming it would have been tidier and would have
 * touched every consumer for no gain in meaning.
 */
export function collectQuestionIssues(question, { identity, label } = {}) {
  const issues = []
  const push = (id, text) => issues.push({ id, label: text, severity: 'error', localId: identity ?? null })
  const key = identity ?? 'unknown'

  if (!richTextHasContent(question?.text)) {
    push(`question-text-${key}`, `${label}: question text is empty.`)
  }

  const qType = canonicalizeQuestionType(question?.type) || MCQ

  if (qType === MCQ || qType === TF) {
    if (!Array.isArray(question?.options) || question.options.length < 2) {
      push(`opt-count-${key}`, `${label}: needs at least two options.`)
      return issues
    }
    const media = Array.isArray(question.optionMedia) ? question.optionMedia : []
    for (let i = 0; i < question.options.length; i++) {
      const slot = media[i]
      const hasImage = Boolean(slot && slot.imageUrl)
      const hasDiagram = Boolean(slot && slot.diagram && slot.diagram.libraryKey)
      const hasMedia = hasImage || hasDiagram
      const hasAlt = hasMedia && String(slot.alt || '').trim().length > 0
      if (!optionHasContent(question.options[i]) && !hasMedia) {
        push(`opt-empty-${key}-${i}`, `${label}: option ${OPTION_LETTERS[i] || i + 1} is empty.`)
      }
      if (hasMedia && !hasAlt) {
        push(`opt-alt-${key}-${i}`, `${label}: option ${OPTION_LETTERS[i] || i + 1} needs alt text for its image.`)
      }
    }
    // `Number(null)` is 0, a valid in-range index, so a stored MCQ with no
    // answer recorded passed this check as "option A is correct" — silently
    // printing a marking key that says A. Caught when the rule started running
    // over Firestore documents, where null is a shape the editor's default of 0
    // never produces. Rejected BEFORE the cast, the same trap as
    // `affectedQuestionNumbers`.
    const rawCorrect = question.correctAnswer
    const correctIdx = rawCorrect === null || rawCorrect === undefined || rawCorrect === ''
      ? NaN
      : Number(rawCorrect)
    if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= question.options.length) {
      push(`correct-${key}`, `${label}: pick the correct answer.`)
    }
    return issues
  }

  const perType = {
    [NUMERIC]: ['numeric', numericIssue],
    [FILL_BLANKS]: ['fill-blanks', fillBlanksIssue],
    [HOTSPOT]: ['hotspot', hotspotIssue],
    [DIAGRAM_LABEL]: ['diagram-label', diagramLabelIssue],
    [MATCHING]: ['matching', matchingIssue],
    [SEQUENCE]: ['sequence', sequenceIssue],
  }[qType]

  if (perType) {
    const [prefix, check] = perType
    const problem = check(question)
    if (problem) push(`${prefix}-${key}`, `${label}: ${problem}`)
    return issues
  }

  if (!TEXT_ANSWER_TYPES.has(qType)) {
    // An unrecognised type is a blocker, not a warning: the runner, the grader
    // and the exporters all only handle the recognised set, so letting one
    // through produces a question the learner cannot answer.
    push(`type-${key}`, `${label}: unrecognised question type "${questionTypeLabel(qType)}".`)
  }
  return issues
}

/* ── the paper ─────────────────────────────────────────────────────────── */

/**
 * Every blocking issue on a whole paper, from entries the ADAPTER has already
 * canonicalised into printed order with identities attached.
 *
 * @param {object} input
 * @param {{title, subject, grade}} input.paper
 * @param {Array<{question, identity, number}>} input.entries questions, in printed order
 * @param {Array} input.passages passages, each with its own linked questions already
 *        flattened into `entries` — passed here only for the passage-level rules
 * @returns {{issues: Array}}
 */
export function collectAssessmentIssues({ paper = {}, entries = [], passages = [] } = {}) {
  const issues = []
  const push = (id, label, localId = null) => issues.push({ id, label, severity: 'error', localId })

  if (!String(paper.title ?? '').trim()) push('title', 'Quiz title is required.')
  if (!String(paper.subject ?? '').trim()) push('subject', 'Pick a subject.')
  const grade = paper.grade
  if (grade === null || grade === undefined || grade === '') push('grade', 'Pick a grade.')

  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  if (list.length === 0) push('no-questions', 'Add at least one question.')

  for (const passage of Array.isArray(passages) ? passages.filter(Boolean) : []) {
    const isMap = passage.passageKind === 'map'
    const identity = passage.localId || passage.id || null
    const key = identity ?? 'unknown'
    if (isMap && !passage.imageUrl) {
      push(`passage-map-image-${key}`, 'Each map section needs a map image.', identity)
    } else if (!isMap && !richTextHasContent(passage.passageText)) {
      push(`passage-text-${key}`, 'Each comprehension passage needs passage text.', identity)
    }
    if (!Array.isArray(passage.questions) || passage.questions.length === 0) {
      push(
        `passage-questions-${key}`,
        isMap ? 'Each map section needs at least one linked question.'
          : 'Each comprehension passage needs at least one linked question.',
        identity,
      )
    }
  }

  for (const entry of list) {
    // The number is the adapter's, and it is the DISPLAY-ORDER number, so a
    // stored question carrying no localId still reads as "Question 3".
    const label = entry.label || `Question ${entry.number ?? '?'}`
    issues.push(...collectQuestionIssues(entry.question, { identity: entry.identity, label }))
  }

  return { issues }
}

/**
 * The adapter for a paper as Firestore stores it.
 *
 * Identity is the document id, falling back to the printed position — never
 * `localId`, which a stored question does not have. Position is a real identity
 * here (the list is already in printed order) and it is never empty, which is
 * what keeps every issue attributable to a question a teacher can find.
 */
export function entriesFromStoredQuestions(questions = []) {
  return (Array.isArray(questions) ? questions.filter(Boolean) : []).map((question, index) => ({
    question,
    identity: question.localId || question._id || question.id || `position-${index + 1}`,
    number: index + 1,
  }))
}
