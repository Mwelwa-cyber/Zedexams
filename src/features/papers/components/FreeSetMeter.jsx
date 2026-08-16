/**
 * FreeSetMeter — one line of text under the progress bar.
 *
 * "Question 18 of 20 · 2 left in your free set", from two questions out.
 *
 * That is the entire component, and everything it is NOT is the design:
 * no dialog, no button, no close control, nothing dismissible, nothing that
 * moves. A limit that arrives without warning reads as a betrayal; the same
 * limit announced two questions ahead reads as a rule, and the learner braces
 * instead of feeling robbed.
 *
 * There is deliberately no dismiss affordance in the tree at all —
 * `FreeSetMeter.spec.jsx` asserts the absence, because "not dismissible" is
 * the kind of property a well-meaning later change ("let them hide it") takes
 * away without anyone noticing it was load-bearing.
 */

import { meterLabel, shouldShowMeter } from '../../../services/entitlements/freeSet'

/**
 * @param {object} props
 * @param {number} props.questionNumber  1-based
 * @param {object} props.freeSet         from resolveFreeSet()
 * @param {boolean} [props.unlocked]     a paid learner never sees it
 */
export default function FreeSetMeter({ questionNumber, freeSet, unlocked = false }) {
  if (!shouldShowMeter(questionNumber, freeSet, { unlocked })) return null
  const label = meterLabel(questionNumber, freeSet)
  if (!label) return null

  return (
    <p className="mt-1.5 flex items-center justify-between text-[11px] font-bold">
      <span className="theme-text-muted">
        Question {questionNumber} of {freeSet.toQuestion}
      </span>
      <span className="text-amber-700 dark:text-amber-300">{label}</span>
    </p>
  )
}
