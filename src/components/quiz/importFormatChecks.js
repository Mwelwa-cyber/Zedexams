/**
 * src/components/quiz/importFormatChecks.js
 *
 * Post-import formatting sanity checks. Exam questions frequently refer to
 * their own typography — "what does the underlined word mean?", "study the
 * word in bold" — so an import that flattened that formatting produces an
 * unanswerable question. These checks compare what each question SAYS about
 * formatting with what actually survived the import, plus two structural
 * checks (passage references without a passage, empty MCQ options), and
 * return teacher-facing warnings for the import review panel.
 *
 * Pure inspection over the importer's section objects — no DOM, no mutation —
 * so it runs in the browser importer and the plain `node` test runner alike.
 */

import { stripFormatTokens } from '../../shared/utils/importFormatTokens.js'

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// What a question can SAY about formatting (matched on plain text)…
const MENTION_RES = {
  bold: /\b(?:in bold|bold(?:ed)?\s+(?:word|words|phrase|text|letter|letters|print|type)|word[s]?\s+(?:written\s+|printed\s+|shown\s+)?in bold)\b/i,
  underlined: /\bunderlined\b/i,
  italics: /\bitalici[sz]ed\b|\bin italics\b/i,
  highlighted: /\bhighlighted\b/i,
}

// …and how that formatting looks when it actually survived (HTML tags from
// the converted fields, or raw [[tokens]] if a field was never converted).
const PRESENCE_RES = {
  bold: /<(?:strong|b)[\s>]|\[\[b\]\]/i,
  underlined: /<u[\s>]|\[\[u\]\]/i,
  italics: /<(?:em|i)[\s>]|\[\[i\]\]/i,
  highlighted: /<mark[\s>]|\[\[hl\]\]/i,
}

const STYLE_LABEL = {
  bold: 'bold',
  underlined: 'underlined',
  italics: 'italicised',
  highlighted: 'highlighted',
}

const PASSAGE_REF_RE = /\b(?:the passage|in the passage|from the passage|passage above|the story above|the poem above|according to the passage)\b/i

function plainText(value) {
  return stripFormatTokens(String(value ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function questionFields(question) {
  const options = Array.isArray(question?.options) ? question.options : []
  return [question?.text, question?.explanation, ...options]
    .filter(v => typeof v === 'string')
    .join('\n')
}

function checkQuestion({ question, label, passage, warnings }) {
  if (!question || typeof question !== 'object') return
  const stemPlain = plainText(question.text)
  if (!stemPlain) return

  // 1 ─ formatting the question refers to must exist somewhere the learner
  //     can see it: the question itself or its passage.
  const haystack = [
    questionFields(question),
    passage ? String(passage.passageText ?? '') : '',
    passage ? String(passage.instructions ?? '') : '',
  ].join('\n')
  Object.keys(MENTION_RES).forEach(style => {
    if (!MENTION_RES[style].test(stemPlain)) return
    if (PRESENCE_RES[style].test(haystack)) return
    warnings.push(
      `Question ${label} says “${STYLE_LABEL[style]}” but no ${STYLE_LABEL[style]} text was detected — check the formatting imported correctly.`,
    )
  })

  // 2 ─ a standalone question referring to a passage has nothing to read.
  if (!passage && PASSAGE_REF_RE.test(stemPlain)) {
    warnings.push(`Question ${label} refers to a passage, but no passage is attached to it.`)
  }

  // 3 ─ empty MCQ options among filled ones ("Answer option B is empty").
  const type = question.type || 'mcq'
  if (type === 'mcq' && Array.isArray(question.options)) {
    const texts = question.options.map(option => (typeof option === 'string' ? plainText(option) : ''))
    const filled = texts.filter(Boolean).length
    if (filled >= 2) {
      texts.forEach((text, index) => {
        if (!text && index < question.options.length) {
          warnings.push(`Question ${label}: answer option ${OPTION_LETTERS[index] || index + 1} is empty.`)
        }
      })
    }
  }
}

/**
 * Inspect the final import sections and return formatting warnings.
 * @param {Array} sections importer section objects (standalone + passage)
 * @returns {string[]} teacher-facing warnings (empty when everything checks out)
 */
export function buildImportFormatWarnings(sections) {
  const warnings = []
  if (!Array.isArray(sections)) return warnings
  let runningNumber = 0

  sections.forEach(section => {
    if (!section) return
    if (section.kind === 'passage' && section.passage) {
      const questions = Array.isArray(section.passage.questions) ? section.passage.questions : []
      questions.forEach(question => {
        runningNumber += 1
        const label = question?.sourceQuestionNumber || runningNumber
        checkQuestion({ question, label, passage: section.passage, warnings })
      })
      return
    }
    if (section.question) {
      runningNumber += 1
      const label = section.question?.sourceQuestionNumber || runningNumber
      checkQuestion({ question: section.question, label, passage: null, warnings })
    }
  })

  return warnings
}
