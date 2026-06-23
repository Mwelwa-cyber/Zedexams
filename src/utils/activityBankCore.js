/**
 * Firebase-free core that maps a generated Lesson Activity (class exercise or
 * homework) into reusable Question Bank entries.
 *
 * The Question Bank stores editor-shaped question objects (src/editor/schema/
 * question.js) so a saved question can be re-inserted into any future paper.
 * The activity question shape is richer/looser, so this module translates the
 * subset that maps cleanly (MCQ, true/false, short answer, fill-in-the-blanks,
 * matching, calculation, essay) and SKIPS what can't round-trip into a single
 * bank question (structured multi-part items). Keeping the logic here (no
 * Firestore I/O) means it's unit-testable under plain `node`; the I/O lives in
 * questionBankService.saveQuestionToBank.
 */

// Activity type → canonical bank/editor question type. `structured` is absent
// on purpose: a multi-part question has no single answer model in the bank
// schema, so we drop it rather than store something that won't reuse cleanly.
const TYPE_TO_BANK = {
  multiple_choice: 'mcq',
  true_false: 'tf',
  short_answer: 'short_answer',
  fill_in_blank: 'fill_blanks',
  matching: 'matching',
  calculation: 'short_answer',
  essay: 'essay',
}

/** Turn an MCQ answer ("B", "b", or a numeric index) into a 0-based index. */
function answerLetterToIndex(answer, optionCount) {
  if (typeof answer === 'number' && Number.isFinite(answer)) {
    return Math.max(0, Math.min(optionCount - 1, Math.round(answer)))
  }
  const s = String(answer || '').trim()
  if (!s) return 0
  const letter = s[0].toUpperCase()
  const idx = letter.charCodeAt(0) - 65 // 'A' → 0
  if (idx >= 0 && idx < optionCount) return idx
  const n = Number(s)
  if (Number.isFinite(n)) return Math.max(0, Math.min(optionCount - 1, Math.round(n)))
  return 0
}

/** Map a single activity question to a bank-ready question object, or null. */
export function activityQuestionToBank(q, meta = {}) {
  if (!q || typeof q !== 'object') return null
  const bankType = TYPE_TO_BANK[q.type]
  if (!bankType) return null

  const text = String(q.prompt || '').trim()
  if (!text) return null

  const marks = Number.isFinite(Number(q.marks)) && Number(q.marks) >= 1
    ? Math.round(Number(q.marks)) : 1
  const topic = String(meta.topic || '').slice(0, 200)

  const base = { type: bankType, text, marks, topic, contentVersion: 3 }

  if (bankType === 'mcq') {
    const options = Array.isArray(q.options) ? q.options.map(o => String(o || '')) : []
    if (options.length < 2) return null
    return { ...base, options, correctAnswer: answerLetterToIndex(q.answer, options.length) }
  }

  if (bankType === 'tf') {
    const options = ['True', 'False']
    const truthy = /^t(rue)?$/i.test(String(q.answer || '').trim()) ||
      String(q.answer || '').trim() === '0'
    return { ...base, options, correctAnswer: truthy ? 0 : 1 }
  }

  if (bankType === 'matching') {
    const pairs = Array.isArray(q.matchPairs) ? q.matchPairs.filter(Boolean) : []
    if (pairs.length < 2) return null
    return {
      ...base,
      matchingLeft: pairs.map(p => String(p.left || '')),
      matchingRight: pairs.map(p => String(p.right || '')),
      // Index-aligned: left[i] matches right[i] as generated.
      matchingAnswer: pairs.map((_, i) => i),
    }
  }

  // short_answer / fill_blanks / essay all key on a plain-text expected answer.
  return { ...base, correctAnswer: String(q.answer || '').slice(0, 1000) }
}

/**
 * Map all questions in an activity into bank-ready objects, dropping the ones
 * that can't round-trip. Returns { questions, skipped }.
 */
export function activityToBankQuestions(activity, meta = {}) {
  const list = Array.isArray(activity?.questions) ? activity.questions : []
  const out = []
  let skipped = 0
  for (const q of list) {
    const mapped = activityQuestionToBank(q, meta)
    if (mapped) out.push(mapped)
    else skipped += 1
  }
  return { questions: out, skipped }
}
