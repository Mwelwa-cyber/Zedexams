/**
 * The worked solution — revealed one step at a time, then taken away.
 *
 * Two things about this are the teaching rather than the presentation.
 *
 * ONE STEP AT A TIME. A solution dropped whole is read as a paragraph and
 * skimmed. The same solution behind a button that says "Show step 2" is read
 * as steps, because the learner has to decide to see each one. The steps that
 * have not been revealed are rendered but dimmed and `aria-hidden`, so the
 * shape of what is coming is visible and its content is not — including to a
 * screen reader, which would otherwise read the whole solution out at once.
 *
 * AND THEN THE LEARNER DOES IT AGAIN, UNAIDED. The button at the end is not
 * "Next question"; it is "Now you try it again". Seeing a worked solution
 * teaches far less than re-walking one, and the retry the button leads to has
 * the answer, the steps and the hint all gone — enforced by the state machine,
 * where "retrying" and "showing the answer" is not a representable pair.
 */
import { Frac } from '../../../shared/components/Fraction'

/**
 * A step's maths line. The pack writes it as text — "1/2 = 2/4" — because a
 * step is a sentence a teacher would write on a board, and every fraction in
 * it is swapped for the canonical stacked renderer here. Writing the steps as
 * component trees in the data file would put JSX in `src/data/`, which is the
 * one place the layering forbids it.
 */
export function MathLine({ text }) {
  const parts = String(text || '').split(/(\d+\s*\/\s*\d+)/g)
  return (
    <span className="lhx-fw-math">
      {parts.map((part, index) => {
        const match = /^(\d+)\s*\/\s*(\d+)$/.exec(part.trim())
        if (!match) return <span key={index}>{part}</span>
        return <Frac key={index} n={Number(match[1])} d={Number(match[2])} />
      })}
    </span>
  )
}

export default function FractionWorking({ question, steps, revealed, onReveal, onRetry }) {
  const done = revealed >= steps.length

  return (
    <div className="lhx-fw">
      <div className="lhx-fw-head">
        <div className="lhx-fw-kick">Step by step</div>
        <div className="lhx-fw-q"><MathLine text={question.prompt} /></div>
      </div>

      <ol className="lhx-fw-steps">
        {steps.map((step) => {
          const shown = step.index < revealed
          return (
            <li
              key={step.index}
              className={`lhx-fw-step ${shown ? 'is-on' : ''}`}
              aria-hidden={shown ? undefined : 'true'}
            >
              <div className="lhx-fw-n">Step {step.index + 1}</div>
              {shown && (
                <>
                  <div className="lhx-fw-t">{step.title}</div>
                  {step.math && <div className="lhx-fw-m"><MathLine text={step.math} /></div>}
                  {step.note && <div className="lhx-fw-note">{step.note}</div>}
                </>
              )}
            </li>
          )
        })}
      </ol>

      {question.hint && done && (
        <div className="lhx-fw-hint">💡 {question.hint}</div>
      )}

      <button
        type="button"
        className="lhx-fl-check"
        onClick={done ? onRetry : onReveal}
      >
        {done ? 'Now you try it again ▸' : `Show step ${revealed + 1}`}
      </button>
    </div>
  )
}
