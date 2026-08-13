/**
 * Parses plain-text question lists pasted into the Assessment Studio.
 *
 * Accepted formats (mixed in one paste is fine):
 *
 *   MCQ
 *   ───
 *   1. What is the capital of Zambia? [2]
 *   A) Lusaka
 *   B) Ndola
 *   C) Kitwe
 *   D) Livingstone
 *   Answer: A
 *
 *   Short-answer / essay (no A–D options)
 *   ──────────────────────────────────────
 *   2. Explain the water cycle in your own words. (5 marks)
 *   Answer: Water evaporates from ...  ← optional model answer
 *
 *   True / False
 *   ─────────────
 *   3. The sun sets in the west. (1)
 *   Answer: True
 *
 * Rules:
 *  - Questions start with   <number>.  or  <number>)  (1. / 1) / Q1. / Q1)
 *  - MCQ options start with  A)  A.  (A)  a)  a.  (a)
 *  - Marks: [N]  (N)  (N marks)  (N mark)  at end of question line — optional
 *  - Answer line: "Answer:" / "Ans:" / "Correct answer:" (case-insensitive) — optional
 *  - Blank lines between questions are ignored
 *  - Lines that don't fit any pattern are appended to the current question text
 */

const QUESTION_START = /^(?:Q\s*)?(\d+)[.)]\s+(.+)/i
const OPTION_LINE = /^[\s]*(?:\(([A-Da-d])\)|([A-Da-d])[.)]\s)(.+)/
const ANSWER_LINE = /^(?:correct\s+)?ans(?:wer)?[:\s]+(.+)/i
const MARKS_SUFFIX = /[[(](\d+)\s*(?:marks?)?\s*[\])][\s.]*$/i
const TRUE_FALSE_ANSWER = /^(true|false)$/i

/**
 * @param {string} raw  Plain text pasted by the teacher
 * @returns {Array<{type,text,options,correctAnswer,marks,explanation}>}
 */
export function parsePastedQuestions(raw) {
  const lines = String(raw || '').split(/\r?\n/)
  const questions = []
  let current = null

  function flush() {
    if (!current) return
    current.text = current.text.trim()
    if (!current.text) { current = null; return }
    questions.push(finalise(current))
    current = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const qMatch = line.match(QUESTION_START)
    if (qMatch) {
      flush()
      const rawText = qMatch[2].trim()
      const { text, marks } = extractMarks(rawText)
      current = { text, marks, options: [], correctAnswer: null, answerText: '' }
      continue
    }

    if (!current) continue

    const optMatch = line.match(OPTION_LINE)
    if (optMatch) {
      const letter = (optMatch[1] || optMatch[2]).toUpperCase()
      const optText = optMatch[3].trim()
      current.options.push({ letter, text: optText })
      continue
    }

    const ansMatch = line.match(ANSWER_LINE)
    if (ansMatch) {
      current.answerText = ansMatch[1].trim()
      continue
    }

    // Continuation of the question text (multi-line question)
    current.text += ' ' + line
  }
  flush()

  return questions
}

function extractMarks(text) {
  const m = text.match(MARKS_SUFFIX)
  if (!m) return { text, marks: 1 }
  return {
    text: text.slice(0, m.index).trim(),
    marks: parseInt(m[1], 10),
  }
}

function finalise(q) {
  // True / False
  if (q.options.length === 0 && TRUE_FALSE_ANSWER.test(q.answerText)) {
    return {
      type: 'true_false',
      text: q.text,
      marks: q.marks,
      options: [],
      correctAnswer: q.answerText.toLowerCase() === 'true' ? 0 : 1,
      explanation: '',
    }
  }

  // MCQ (2–4 options detected)
  if (q.options.length >= 2) {
    const texts = q.options.map(o => o.text)
    // Pad to 4 options if fewer were given
    while (texts.length < 4) texts.push('')

    let correctAnswer = 0
    if (q.answerText) {
      const letter = q.answerText.trim().toUpperCase().charAt(0)
      const idx = ['A', 'B', 'C', 'D'].indexOf(letter)
      if (idx !== -1) correctAnswer = idx
    }

    return {
      type: 'mcq',
      text: q.text,
      marks: q.marks,
      options: texts.slice(0, 4),
      correctAnswer,
      explanation: '',
    }
  }

  // Short answer / essay (no options)
  const isLong = q.marks >= 5 || q.text.length > 120
  return {
    type: isLong ? 'essay' : 'short_answer',
    text: q.text,
    marks: q.marks,
    options: [],
    correctAnswer: q.answerText || '',
    explanation: '',
  }
}
