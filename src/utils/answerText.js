// Shared helper: turn a stored answer (option index, string, or {text}
// object) into human-readable answer text. Used by both the quiz results
// page and the daily-exam corrections view so they stay in sync.
export function answerToText(question, answer) {
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
