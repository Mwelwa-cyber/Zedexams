/**
 * quizEngineAdapter — bridges the Quiz Editor's in-memory question shape to
 * the shared Document Understanding Engine (src/documentEngine/), so the
 * editor gets LIVE structural validation (missing/duplicate/out-of-order
 * numbering, "Missing Option D", [UNCLEAR] spans, answer-key blocks) from the
 * exact same engine the server-side importers gate on.
 *
 * Pure ESM, no React/DOM requirement (extractRichTextPlain degrades to
 * tag-stripping under node), unit-tested by
 * scripts/test-quiz-engine-adapter.mjs.
 *
 * Editor questions store rich text as HTML strings OR Tiptap JSON (object or
 * stringified) and options likewise; the engine wants plain text. Answer
 * semantics also differ per type — `deriveAnswerKnown` mirrors the editor's
 * own pre-publish rules (src/utils/quizValidation.js): a blank expected answer
 * on a written-response type is a SUPPORTED state ("AI will judge"), never a
 * warning, while an unanswered MCQ/tf/numeric/fill-blanks/matching/sequence/
 * hotspot is flagged.
 */

import { extractRichTextPlain } from './quizRichText.js'
import { canonicalizeQuestionType } from './questionType.js'
import { fillBlanksAnswerKey } from './fillBlanks.js'
import {
  analyzeNumbering,
  analyzeMcqCompleteness,
  detectUnclear,
  detectAnswerKeyBlock,
  computeValidationStatus,
  gateImport,
} from '../documentEngine/validationEngine.js'

// Written-response types where a blank expected answer means "the AI judges
// from the stem" — mirrors TEXT_ANSWER_TYPES in quizValidation.js.
const TEXT_ANSWER_TYPES = new Set(['short_answer', 'short', 'diagram', 'essay', 'fill'])

/**
 * Whether the teacher has actually set a markable answer for this question,
 * per the editor's own per-type semantics. Feeds the engine's `answerKnown`.
 */
export function deriveAnswerKnown(question) {
  const q = question || {}
  const type = canonicalizeQuestionType(q.type) || 'mcq'

  if (TEXT_ANSWER_TYPES.has(type)) return true // blank = AI judges; never warn

  if (type === 'mcq' || type === 'tf') {
    // Guard the empty/null cases BEFORE Number(): Number('') === 0 would
    // silently read an unanswered MCQ as "the answer is A".
    if (q.correctAnswer === '' || q.correctAnswer == null) return false
    const idx = Number(q.correctAnswer)
    const count = Array.isArray(q.options) ? q.options.length : 0
    return Number.isInteger(idx) && idx >= 0 && idx < count
  }

  if (type === 'numeric') {
    const value = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : q.correctAnswer
    return value !== '' && value != null && Number.isFinite(Number(value))
  }

  if (type === 'fill_blanks') {
    const key = fillBlanksAnswerKey(q)
    return key.length > 0 && key.every(answer => String(answer ?? '').trim().length > 0)
  }

  if (type === 'matching') {
    const left = (Array.isArray(q.matchingLeft) ? q.matchingLeft : []).map(v => String(v ?? '').trim())
    const right = (Array.isArray(q.matchingRight) ? q.matchingRight : []).map(v => String(v ?? '').trim())
    const answer = Array.isArray(q.matchingAnswer) ? q.matchingAnswer : []
    if (left.filter(Boolean).length < 2 || right.filter(Boolean).length < 2) return false
    return left.every((item, i) => {
      if (!item) return true
      const idx = Number(answer[i])
      return Number.isInteger(idx) && idx >= 0 && idx < right.length && Boolean(right[idx])
    })
  }

  if (type === 'sequence') {
    const items = (Array.isArray(q.sequenceItems) ? q.sequenceItems : []).map(v => String(v ?? '').trim())
    const answer = Array.isArray(q.sequenceAnswer) ? q.sequenceAnswer : []
    const filled = items.map((item, i) => (item ? i : -1)).filter(i => i >= 0)
    if (filled.length < 2) return false
    const seen = new Set()
    return filled.every(i => {
      const pos = Number(answer[i])
      if (!Number.isInteger(pos) || pos < 1 || pos > filled.length || seen.has(pos)) return false
      seen.add(pos)
      return true
    })
  }

  if (type === 'hotspot') {
    const region = q.correctRegion
    return Boolean(
      region && typeof region === 'object' &&
      Number.isFinite(Number(region.x)) && Number.isFinite(Number(region.y)),
    )
  }

  return Boolean(String(q.correctAnswer ?? '').trim())
}

/** The printed source-paper number for a question, or null. */
export function questionSourceNumber(question) {
  const n = Number(question?.sourceQuestionNumber)
  return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null
}

/**
 * Map one editor question to the engine's working shape:
 *   { type, prompt, options[], correctAnswer, answerKnown, sourceNumber,
 *     explanation, passage? }
 * Rich text (HTML / Tiptap object / stringified Tiptap) flattens to plain
 * text; blank options are dropped (a stringified empty Tiptap doc is "").
 */
export function toEngineQuestion(question, { passage = null } = {}) {
  const q = question || {}
  const options = (Array.isArray(q.options) ? q.options : [])
    .map(option => extractRichTextPlain(option))
    .filter(option => option.trim().length > 0)
  const engineQuestion = {
    type: canonicalizeQuestionType(q.type) || 'mcq',
    prompt: extractRichTextPlain(q.text),
    options,
    correctAnswer: q.correctAnswer,
    explanation: extractRichTextPlain(q.explanation),
    answerKnown: deriveAnswerKnown(q),
    sourceNumber: questionSourceNumber(q),
  }
  if (passage) engineQuestion.passage = passage
  return engineQuestion
}

/**
 * Live ok|warning|error rollup for ONE editor question — powers the status
 * chip on each card. Wraps the shared engine's computeValidationStatus so a
 * card goes green the moment the teacher fixes it (independent of the
 * persisted import-time `validationStatus` snapshot).
 */
export function questionValidationStatus(question) {
  return computeValidationStatus(toEngineQuestion(question))
}

/**
 * Run the shared engine over the editor's whole `sections` array.
 *
 * Returns:
 *   ok         — false when a structural blocker exists
 *   blockers   — global blocker strings (missing numbers, answer-key block)
 *   numbering  — analyzeNumbering result (missing/duplicates/outOfOrder/restarts)
 *   items      — per-question findings [{ localId, label, message, severity }]
 *                for the panel's clickable rows (jump via localId)
 *   unclearCount / noAnswerCount — global tallies for the summary line
 *
 * `questionNumbers` (localId -> display number) labels findings for questions
 * with no printed number. Purely derived — callers must never write any of
 * this back into section state (it would dirty the autosave loop).
 */
export function runQuizValidation(sections = [], { questionNumbers = {} } = {}) {
  const flat = [] // { question, localId, passage|null }
  for (const section of Array.isArray(sections) ? sections : []) {
    if (section?.kind === 'passage') {
      const passage = section.passage || {}
      const children = Array.isArray(passage.questions) ? passage.questions : []
      children.forEach((question, index) => {
        flat.push({
          question,
          localId: question?.localId || null,
          // Attach the passage text to the FIRST child only, so a shared
          // passage's [UNCLEAR] spans are counted once, not once per child.
          passage: index === 0
            ? {
              title: String(passage.title ?? ''),
              text: extractRichTextPlain(passage.passageText),
            }
            : null,
        })
      })
      continue
    }
    if (section?.question) {
      flat.push({ question: section.question, localId: section.question.localId || null, passage: null })
    }
  }

  const engineQuestions = flat.map(entry =>
    toEngineQuestion(entry.question, { passage: entry.passage }),
  )
  const gate = gateImport({ questions: engineQuestions })
  const numbering = analyzeNumbering(engineQuestions)

  const items = []
  let unclearCount = 0
  let noAnswerCount = 0
  flat.forEach((entry, index) => {
    const engineQuestion = engineQuestions[index]
    const label = `Question ${engineQuestion.sourceNumber
      ?? questionNumbers[entry.localId]
      ?? index + 1}`

    const mcq = analyzeMcqCompleteness(engineQuestion, label)
    if (mcq) {
      items.push({ localId: entry.localId, label, message: mcq.message, severity: mcq.severity })
    }
    const unclear = detectUnclear(engineQuestion)
    if (unclear.length) {
      unclearCount += unclear.length
      items.push({
        localId: entry.localId,
        label,
        message: `${label} — ${unclear.length} unreadable [UNCLEAR] span${unclear.length === 1 ? '' : 's'}`,
        severity: 'warning',
      })
    }
    if (detectAnswerKeyBlock(engineQuestion)) {
      items.push({
        localId: entry.localId,
        label,
        message: `${label} — looks like an answer key / marking scheme, not a question`,
        severity: 'error',
      })
    }
    if (!engineQuestion.answerKnown && engineQuestion.type !== 'essay') {
      noAnswerCount += 1
    }
  })

  return {
    ok: gate.ok,
    blockers: gate.blockers,
    numbering,
    items,
    unclearCount,
    noAnswerCount,
    questionCount: flat.length,
  }
}
