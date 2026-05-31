/**
 * answerKeyUtils — pure helpers for the Quiz Editor's bulk answer-key entry.
 *
 * Scanned-paper imports land with every MCQ answer blank (the question papers
 * carry no key). Setting ~60 answers one card at a time is the slowest part of
 * the admin's review. These helpers let the editor offer a compact grid + a
 * paste box ("ACBD ABCA…" or "1A 2C 3B") that fills them in one pass.
 *
 * Everything here is pure and addresses questions by their stable `localId`,
 * so applying a key never reorders sections, never touches a non-MCQ question,
 * and only rewrites the questions whose answer actually changed.
 */

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

// Editor MCQ-style types whose answer is a 0-based option index.
const ANSWERABLE_TYPES = new Set(['mcq', 'truefalse', 'tf'])

function isAnswerableType(type) {
  return ANSWERABLE_TYPES.has(type || 'mcq')
}

function correctIndexOf(question) {
  const raw = question?.correctAnswer
  if (Number.isInteger(raw)) return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  return null // '' / null / undefined / text → unset
}

/**
 * Flatten sections into the answerable MCQ questions, in display order.
 * Each entry: { localId, number, optionCount, correctIndex, hasImageOptions,
 * inPassage }. `number` is the printed question number when known, else a
 * running 1-based count of answerable questions.
 */
export function collectAnswerableQuestions(sections = []) {
  const out = []
  let counter = 0

  const push = (question, inPassage) => {
    if (!question || !isAnswerableType(question.type)) return
    counter += 1
    const options = Array.isArray(question.options) ? question.options : []
    const optionCount = Math.min(6, Math.max(2, options.length || 4))
    out.push({
      localId: question.localId,
      number: Number.isFinite(question.sourceQuestionNumber) ? question.sourceQuestionNumber : counter,
      optionCount,
      correctIndex: correctIndexOf(question),
      hasImageOptions: Array.isArray(question.optionMedia) &&
        question.optionMedia.some(slot => slot && typeof slot === 'object' && (slot.imageUrl || slot.imageAssetId)),
      inPassage: Boolean(inPassage),
    })
  }

  sections.forEach(section => {
    if (section?.kind === 'passage') {
      (section.passage?.questions || []).forEach(q => push(q, true))
    } else if (section?.kind === 'standalone') {
      push(section.question, false)
    }
    // pagebreak / unknown kinds carry no answerable question.
  })

  return out
}

/**
 * Parse a pasted answer key into a { localId: optionIndex } map against the
 * given answerable-question list (from collectAnswerableQuestions).
 *
 * Two accepted shapes:
 *   - Numbered:  "1A 2C 3B", "1.A, 2) B, 3-C"  → mapped by question number.
 *   - Positional: "ACB", "A C B"                → mapped by order.
 * Numbered form wins when the text contains digit→letter pairs. Letters past a
 * question's option count are ignored (so a stray "E" on a 4-option item is
 * dropped rather than set out of range).
 */
export function parseAnswerKey(text, questions = []) {
  const map = {}
  const upper = String(text ?? '').toUpperCase()

  const letterToIndex = (letter) => letter.charCodeAt(0) - 65

  const numbered = [...upper.matchAll(/(\d+)\s*[).:-]?\s*([A-F])\b/g)]
  if (numbered.length) {
    const byNumber = new Map(questions.map(q => [q.number, q]))
    numbered.forEach(match => {
      const q = byNumber.get(Number(match[1]))
      if (!q) return
      const idx = letterToIndex(match[2])
      if (idx >= 0 && idx < q.optionCount) map[q.localId] = idx
    })
    return map
  }

  const letters = upper.match(/[A-F]/g) || []
  letters.forEach((letter, i) => {
    const q = questions[i]
    if (!q) return
    const idx = letterToIndex(letter)
    if (idx >= 0 && idx < q.optionCount) map[q.localId] = idx
  })
  return map
}

/**
 * Apply a { localId: optionIndex } map to sections, returning new sections and
 * a count of questions actually changed. Pure: untouched questions keep their
 * exact object identity, so React only re-renders what changed and no other
 * field is disturbed. A value of '' clears an answer back to blank.
 */
export function applyAnswerKeyToSections(sections = [], keyToIndex = {}) {
  let changed = 0

  const applyToQuestion = (question) => {
    const id = question?.localId
    if (!id || !(id in keyToIndex)) return question
    const next = keyToIndex[id]
    if (next === question.correctAnswer) return question
    changed += 1
    return { ...question, correctAnswer: next }
  }

  const nextSections = sections.map(section => {
    if (section?.kind === 'passage') {
      const questions = section.passage?.questions || []
      let touched = false
      const nextQuestions = questions.map(q => {
        const updated = applyToQuestion(q)
        if (updated !== q) touched = true
        return updated
      })
      if (!touched) return section
      return { ...section, passage: { ...section.passage, questions: nextQuestions } }
    }
    if (section?.kind === 'standalone') {
      const updated = applyToQuestion(section.question)
      if (updated === section.question) return section
      return { ...section, question: updated }
    }
    return section
  })

  return { sections: nextSections, changed }
}

/** Count answerable questions still missing an answer. */
export function countUnansweredQuestions(questions = []) {
  return questions.filter(q => q.correctIndex == null).length
}

/**
 * Build the payload for the AI "suggest answers" callable: one entry per
 * answerable MCQ with its stem + options as plain text. `toPlainText` is
 * injected (the editor passes its rich→text helper) so this stays pure and
 * testable. With `onlyUnanswered`, questions that already have an answer are
 * skipped — so re-running only fills the gaps and never overwrites a set one.
 */
export function collectAiAnswerTargets(sections = [], toPlainText = (v) => String(v ?? ''), { onlyUnanswered = true } = {}) {
  const out = []

  const push = (question) => {
    if (!question || !isAnswerableType(question.type)) return
    if (onlyUnanswered && correctIndexOf(question) != null) return
    const localId = question.localId
    if (!localId) return
    const text = toPlainText(question.text).trim()
    const options = (Array.isArray(question.options) ? question.options : []).map(o => toPlainText(o).trim())
    if (!text || options.length < 2) return
    out.push({ id: localId, text, options })
  }

  sections.forEach(section => {
    if (section?.kind === 'passage') {
      (section.passage?.questions || []).forEach(push)
    } else if (section?.kind === 'standalone') {
      push(section.question)
    }
  })

  return out
}
