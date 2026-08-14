import { resolveQuizDisplayVars } from '../../utils/quizDisplayPrefs'

/**
 * Live preview of the current reading preferences. Renders a miniature quiz
 * card — sample question text containing a bold + underlined + highlighted word
 * (so contrast and mark styling are visible) and two answer options, one of
 * them marked correct — inside a real .quiz-shell scope so it reflects the
 * chosen theme/size/spacing/highlight exactly like the runner will.
 */
export default function ThemePreview({ prefs }) {
  const vars = resolveQuizDisplayVars(prefs)
  const { className, style, ...dataAttrs } = vars

  return (
    <div
      className={`${className} rounded-2xl p-3`}
      style={style}
      {...dataAttrs}
      aria-hidden="true"
    >
      <div className="zx-card-shared p-4">
        <p className="question-text">
          What is the meaning of the <strong>underlined</strong>{' '}
          <u>river</u> that provides <mark>water</mark> for the village?
        </p>
        <div className="opt-grid mt-3 flex flex-col gap-2">
          <div className="zx-opt">
            <span className="zx-opt-letter">A</span>
            <span className="answer-text flex-1">road</span>
          </div>
          <div className="zx-opt" data-correct="true">
            <span className="zx-opt-letter">B</span>
            <span className="answer-text flex-1">stream</span>
            <span className="zx-opt-state" aria-hidden="true">✓</span>
          </div>
        </div>
      </div>
    </div>
  )
}
