// Shared helper: turn a stored answer (option index, string, {text} object, or
// a matching/sequence ordering array) into human-readable answer text. Used by
// the quiz results page, the daily-exam corrections view, and the exam results
// page so they all render learner + expected answers the same way.
//
// For matching/sequence the learner answer is an array; the "expected" call
// passes question.correctAnswer (an empty string for these types), so we fall
// back to the dedicated answer key (matchingAnswer / sequenceAnswer) to render
// the model answer.

function matchingToText(question, answer) {
  const left = Array.isArray(question.matchingLeft) ? question.matchingLeft : []
  const right = Array.isArray(question.matchingRight) ? question.matchingRight : []
  const sel = Array.isArray(answer)
    ? answer
    : (Array.isArray(question.matchingAnswer) ? question.matchingAnswer : null)
  if (!sel) return 'No answer'
  const pairs = left
    .map((prompt, i) => {
      const p = String(prompt ?? '').trim()
      if (!p) return null
      const r = Number(sel[i])
      const opt = Number.isInteger(r) && r >= 0 && right[r] != null ? String(right[r]).trim() : '—'
      return `${p} → ${opt}`
    })
    .filter(Boolean)
  return pairs.length ? pairs.join('; ') : 'No answer'
}

function sequenceToText(question, answer) {
  const items = Array.isArray(question.sequenceItems) ? question.sequenceItems : []
  let order = Array.isArray(answer) && answer.length ? answer : null
  if (!order && Array.isArray(question.sequenceAnswer)) {
    // Build the order from the key: position p (1..n) → the item index whose
    // target position is p.
    const byPos = []
    items.forEach((it, i) => {
      if (!String(it ?? '').trim()) return
      const pos = Number(question.sequenceAnswer[i])
      if (Number.isInteger(pos) && pos >= 1) byPos[pos - 1] = i
    })
    order = byPos.filter(i => i != null)
  }
  if (!order || !order.length) return 'No answer'
  const parts = order
    .map((i, p) => {
      const label = String(items[i] ?? '').trim()
      return label ? `${p + 1}. ${label}` : null
    })
    .filter(Boolean)
  return parts.length ? parts.join('  ') : 'No answer'
}

export function answerToText(question, answer) {
  const type = question?.type

  if (type === 'matching') return matchingToText(question, answer)
  if (type === 'sequence') return sequenceToText(question, answer)

  if (answer === undefined || answer === null || answer === '') return 'No answer'
  const index = Number(answer)
  if (Array.isArray(question.options) && Number.isInteger(index) && question.options[index]) {
    return question.options[index]
  }
  if (typeof answer === 'object' && answer !== null && 'text' in answer) {
    return String(answer.text || '')
  }
  return String(answer)
}
