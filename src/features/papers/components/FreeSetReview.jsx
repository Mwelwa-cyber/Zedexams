/**
 * FreeSetReview — the wrong answers, with the right ones. Free, always.
 *
 * Every question the learner got wrong, showing what they picked, what the
 * answer was, and the explanation if the question carries one. There is no
 * plan check anywhere in this component and there must never be one: marking
 * and review of work already done are free on every plan, permanently.
 *
 * This screen is the reason the learner opens the app tomorrow. Charging for
 * it buys exactly one refusal and costs the habit — and the `results_review_opened`
 * event is the funnel step to watch, because if it is low the results screen
 * is failing and no amount of paywall tuning will help.
 */

import RichContent, { getRichPlainText } from '../../../editor/RichContent'

function optionLabel(option) {
  if (option == null) return ''
  if (typeof option === 'string') return getRichPlainText(option) || option
  if (typeof option === 'object') return getRichPlainText(option.textJSON ?? option.text ?? '') || option.text || ''
  return String(option)
}

/**
 * @param {object} props
 * @param {Array} props.answers    from the attempt draft
 * @param {Array} props.questions  the loaded question list
 * @param {() => void} props.onBack
 */
export default function FreeSetReview({ answers = [], questions = [], onBack }) {
  const wrong = answers.filter((a) => !a.correct)

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 bg-transparent px-0 text-[12px] font-black theme-text-muted shadow-none"
      >
        ← Back to your score
      </button>

      <h1 className="font-display text-lg font-black theme-text">
        {wrong.length} to look at
      </h1>
      <p className="mt-0.5 text-[12px] theme-text-muted">
        The correct answers and why, for every one you missed.
      </p>

      <ol className="mt-4 space-y-3">
        {wrong.map((a) => {
          const q = questions.find((x) => x.id === a.questionId)
          if (!q) return null
          const options = Array.isArray(q.options) ? q.options : []
          return (
            <li key={a.questionId} className="rounded-radius-md border theme-border theme-card p-3.5">
              <p className="text-[10px] font-black uppercase tracking-widest theme-text-muted">
                Question {a.order + 1}
              </p>
              <div className="question-text mt-1 text-[13px] theme-text">
                <RichContent
                  value={q.textJSON ?? q.text ?? ''}
                  fallback={<p>{getRichPlainText(q.text ?? '') || q.text || ''}</p>}
                />
              </div>

              <div className="mt-2.5 space-y-1.5">
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-900 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
                  <span className="font-black">You chose: </span>
                  {optionLabel(options[a.selectedIndex]) || '—'}
                </p>
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[12px] text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <span className="font-black">Correct answer: </span>
                  {optionLabel(options[a.correctIndex]) || '—'}
                </p>
              </div>

              {(q.explanation || q.explanationJSON) && (
                <div className="mt-2 rounded-lg theme-bg-subtle px-2.5 py-2 text-[12px] leading-relaxed theme-text-muted">
                  <RichContent
                    value={q.explanationJSON ?? q.explanation ?? ''}
                    fallback={<p>{q.explanation}</p>}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
