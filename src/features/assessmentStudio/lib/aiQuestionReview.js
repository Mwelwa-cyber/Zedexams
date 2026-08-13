/**
 * Quick-questions review helpers — the pure logic behind the AI slide-over's
 * accept/discard pass (AiReviewPanel).
 *
 * partitionUsableQuestions is the predicate that used to live inline in
 * AssessmentStudio.handleGenerateQuestions and silently DROP incomplete
 * generations. It's extracted so (a) the review panel can report exactly what
 * was dropped and why the counts differ, and (b) it unit-tests without
 * mounting the studio.
 */

import { richTextHasContent, richTextToPlainText } from '../../../utils/quizRichText.js'

/**
 * Split a generated question list into the ones complete enough to insert
 * and the ones missing something structural (no stem, an MCQ without at
 * least 2 options, fill-in-the-blanks without any actual blank, a
 * short-answer/diagram with no expected answer).
 *
 * @param {Array} generatedList — raw questions from generateAIQuizQuestions
 * @returns {{ usable: Array, dropped: Array }}
 */
export function partitionUsableQuestions(generatedList) {
  const list = Array.isArray(generatedList) ? generatedList : []
  const usable = []
  const dropped = []
  for (const q of list) {
    if (isUsableQuestion(q)) usable.push(q)
    else dropped.push(q)
  }
  return { usable, dropped }
}

function isUsableQuestion(q) {
  if (!richTextHasContent(q?.text ?? '')) return false
  const t = q?.type || 'mcq'
  if (t === 'fill_blanks') {
    return Array.isArray(q?.statements)
      && q.statements.some(s => /_{2,}/.test(String(s?.text ?? '')))
  }
  if (t === 'short_answer' || t === 'diagram') {
    return String(q?.correctAnswer ?? '').trim().length > 0
  }
  const opts = Array.isArray(q?.options) ? q.options.filter(o => String(o ?? '').trim()) : []
  return opts.length >= 2
}

/** Short human label for a question type chip in the review list. */
export function questionTypeLabel(type) {
  switch (type) {
    case 'short_answer': return 'Short answer'
    case 'fill_blanks': return 'Fill in the blanks'
    case 'diagram': return 'Structured'
    case 'essay': return 'Essay'
    case 'true_false': return 'True / False'
    case 'mcq':
    default: return 'Multiple choice'
  }
}

/** Plain-text stem preview (the generator may emit rich HTML). */
export function questionPreviewText(q, max = 220) {
  const plain = richTextToPlainText(q?.text ?? '').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

/** Plain-text option previews for MCQ-style questions (empties dropped). */
export function optionPreviewTexts(q) {
  if (!Array.isArray(q?.options)) return []
  return q.options
    .map(o => richTextToPlainText(String(o ?? '')).trim())
    .filter(Boolean)
}
