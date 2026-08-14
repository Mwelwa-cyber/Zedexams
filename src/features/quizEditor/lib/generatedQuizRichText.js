/**
 * The quiz editor's half of the generation notation contract (Phase 5).
 *
 * The server prompt asks the model for the shared markup (\frac{a}{b}, $…$,
 * [[vmath]]) and the server ladder repairs what it can — but markup is not a
 * rendering. CreateQuizV2 used to drop the generated strings straight into the
 * editor, so a fractions quiz arrived reading "\frac{3}{5}" — worse than the
 * "3/5" it replaced. This converts each generated question ONCE, on receipt,
 * through the same importRichText converter the document and OCR import paths
 * use, so a generated fraction and an imported fraction are the same node.
 *
 * What is deliberately NOT converted:
 *   - `correctAnswer`. For MCQs it is an index; for short answers it is the
 *     string auto-marking compares against what a learner types. Either way,
 *     converting it could only break marking.
 *   - fill-in-the-blank statement ANSWERS and the word bank — same reason:
 *     the learner's typed word is checked against them.
 */

import {
  hasImportMarkup,
  importMarkupToRichHtml,
  importMarkupToOptionHtml,
} from '../../../shared/utils/importRichText.js'

/** Already-converted editor HTML — never feed it back through the converter. */
function alreadyRich(value) {
  return typeof value === 'string' && /<[a-z!/]/i.test(value)
}

/** One generated question, its display fields converted, marking fields untouched. */
export function richifyGeneratedQuestion(question) {
  if (!question || typeof question !== 'object') return question
  const out = { ...question }
  if (typeof out.text === 'string' && !alreadyRich(out.text) && hasImportMarkup(out.text)) {
    out.text = importMarkupToRichHtml(out.text)
  }
  if (typeof out.explanation === 'string' && !alreadyRich(out.explanation) && hasImportMarkup(out.explanation)) {
    out.explanation = importMarkupToRichHtml(out.explanation)
  }
  if (Array.isArray(out.options)) {
    out.options = out.options.map((opt) =>
      (typeof opt === 'string' && !alreadyRich(opt) ? importMarkupToOptionHtml(opt) : opt))
  }
  if (Array.isArray(out.statements)) {
    out.statements = out.statements.map((st) => {
      if (!st || typeof st !== 'object') return st
      if (typeof st.text !== 'string' || alreadyRich(st.text) || !hasImportMarkup(st.text)) return st
      // Inline conversion: a statement is one line with a blank in it, and a
      // block-level <p> wrapper would break the blank segmentation.
      return { ...st, text: importMarkupToOptionHtml(st.text) }
    })
  }
  return out
}

/** The whole generated batch. */
export function richifyGeneratedQuestions(questions) {
  return Array.isArray(questions) ? questions.map(richifyGeneratedQuestion) : []
}
