/**
 * activity — what the learner is doing right now, so nothing interrupts it.
 *
 * The blocked-context list in the interruption budget names activities
 * ("quiz_active"), not routes. Matching pathnames would have been less code
 * and wrong: a quiz can be embedded, a paper can be read inside a modal, and
 * an AI generation outlives the page that started it. So the ACTIVITY declares
 * itself — the screen pushes on mount and pops on unmount — and `canShow`
 * refuses while the stack is non-empty.
 *
 * A stack rather than a flag, because these nest: a learner reading a paper
 * can start its quiz without leaving the reader, and the inner activity
 * finishing must not clear the outer one's protection.
 *
 * ── Why there is no React provider ─────────────────────────────────────
 *
 * The stack lives in the `interruptionBudget` singleton, which is also the
 * only thing that reads it. A context provider would add a second copy that
 * has to be kept in step with the one the budget actually consults, and the
 * failure mode of a drift between them is silent: a modal that fires during a
 * quiz because the provider's stack was empty while the budget's was not.
 * Screens declare their activity with the hook below; there is nothing to
 * mount and nothing to forget to mount.
 */

import { useEffect, useRef } from 'react'
import { interruptionBudget } from './interruptionBudget'

/**
 * Declare that this screen is an activity.
 *
 * ```jsx
 * useActivity('quiz_active')                 // for as long as this is mounted
 * useActivity('ai_generating', generating)   // only while a flag is true
 * ```
 *
 * The pop is idempotent and the effect re-runs when `active` changes, so a
 * component that toggles the flag several times never leaves a stale entry
 * behind. A leaked entry would silence every upsell for the rest of the
 * session — it fails quiet, which is why it is the failure worth designing
 * out rather than the one worth catching in review.
 */
export function useActivity(context, active = true) {
  const popRef = useRef(null)
  useEffect(() => {
    if (!context || !active) return undefined
    popRef.current = interruptionBudget.pushContext(context)
    return () => {
      popRef.current?.()
      popRef.current = null
    }
  }, [context, active])
}

/** The current stack — for tests and for surfaces that want to explain a refusal. */
export function activeContexts() {
  return interruptionBudget.activeContexts()
}
