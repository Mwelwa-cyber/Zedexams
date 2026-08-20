/**
 * Which option is the right one — the ONE resolver for the whole quiz.
 *
 * ⚠️ SHARED WITH THE FRONTEND. The browser's runner paints the ✓ from this,
 * and `submitAttempt` marks the exam with it — the same file, imported by
 * both, because two readings of one key is how a results screen ends up
 * disagreeing with the tick a learner watched appear.
 * `src/features/papers/quiz/lib/answerKey.js` is a re-export shim onto this;
 * DO NOT put a rule there.
 *
 * Plain ESM, no React / DOM / Firebase / docx — see the package README and
 * `neutrality.test.js`. Cloud Functions is CommonJS, so the server reaches it
 * with `await import(...)` INSIDE the async handler, never a top-level
 * `require`.
 *
 * Lifted out of `PublicQuizRunner.jsx`, unchanged in behaviour, because five
 * surfaces now need the same answer and four of them are not that runner: the
 * server's marking, the results screen's answer list, the coaching panel ("the
 * correct answer is B — an") and the fix-up set.
 *
 * ── The five stored shapes, and why the ORDER of the checks matters ──────
 *
 * The platform's question schema has accumulated four unambiguous ways to say
 * "B": `correctAnswerIndex`, `correctIndex`, an integer `correctAnswer`, and
 * option-level `isCorrect`. A string `correctAnswer` is the fifth and the only
 * ambiguous one — options ["B","C","A","D"] with key "A" means the option
 * whose TEXT is "A", not position 0 — so an exact text match is tried before a
 * bare letter is read as a position. Getting that order wrong silently marks a
 * whole paper of shuffled-letter questions against the learner.
 */

import { getRichPlainText } from '../text/richPlainText.js'

/** The readable text of an option, whatever shape it is stored in. */
export function optionText(opt) {
  if (opt == null) return ''
  if (typeof opt === 'string') {
    // A plain string ("117 kg"), legacy HTML, OR a stringified Tiptap doc.
    // getRichPlainText handles all three and returns a non-JSON string
    // verbatim, so routing every string through it is what stops raw JSON
    // leaking into an option label.
    return getRichPlainText(opt) || opt
  }
  if (typeof opt === 'object') {
    return getRichPlainText(opt.textJSON ?? opt.text ?? '') || opt.text || ''
  }
  return String(opt)
}

/** The readable text of a question stem. */
export function questionText(q) {
  return getRichPlainText(q?.textJSON ?? q?.text ?? '') || q?.text || ''
}

/** Is `optionIndex` the correct option for `question`? */
export function isCorrectChoice(question, optionIndex) {
  if (Number.isInteger(question?.correctAnswerIndex)) {
    return question.correctAnswerIndex === optionIndex
  }
  if (Number.isInteger(question?.correctIndex)) {
    return question.correctIndex === optionIndex
  }
  if (Number.isInteger(question?.correctAnswer)) {
    return question.correctAnswer === optionIndex
  }
  const options = Array.isArray(question?.options) ? question.options : []
  const opt = options[optionIndex]
  if (opt && typeof opt === 'object' && opt.isCorrect) return true
  if (typeof question?.correctAnswer === 'string') {
    const raw = question.correctAnswer.trim()
    // Exact option-text match FIRST — see the header note.
    const textHit = options.findIndex((o) =>
      optionText(o).trim().toLowerCase() === raw.toLowerCase())
    if (textHit >= 0) return textHit === optionIndex
    const letterIndex = /^[A-Ha-h]$/.test(raw) ? raw.toUpperCase().charCodeAt(0) - 65 : -1
    if (letterIndex >= 0 && letterIndex < options.length) {
      return letterIndex === optionIndex
    }
    // A text key stored rich exactly as the option is ("\frac{1}{32}" vs a
    // fraction node). Project BOTH sides — projecting one compares two
    // different alphabets and fails on every maths question.
    const target = (getRichPlainText(raw) || raw).trim().toLowerCase()
    return optionText(opt).trim().toLowerCase() === target
  }
  return false
}

/**
 * The index of the correct option, or null.
 *
 * Derived by asking `isCorrectChoice` about each option rather than reading
 * any of the shapes directly, so no consumer can disagree with any other.
 * Null rather than 0 on an unkeyed question: returning 0 would paint option A
 * green on every question a paper forgot to key.
 */
export function correctIndexOf(question) {
  const options = Array.isArray(question?.options) ? question.options : []
  for (let i = 0; i < options.length; i += 1) {
    if (isCorrectChoice(question, i)) return i
  }
  return null
}

/** 0 → 'A'. The ECZ letter for a position. */
export function optionLetter(index) {
  return Number.isInteger(index) && index >= 0 && index < 26
    ? String.fromCharCode(65 + index)
    : ''
}

/**
 * "B — an", the phrase the coaching panel and the review list both print.
 * Empty string when the index names no option, so a caller never renders a
 * dangling dash.
 */
export function optionLabel(question, index) {
  const options = Array.isArray(question?.options) ? question.options : []
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return ''
  const text = optionText(options[index]).trim()
  const letter = optionLetter(index)
  return text ? `${letter} — ${text}` : letter
}
