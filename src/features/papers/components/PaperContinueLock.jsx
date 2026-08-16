/**
 * PaperContinueLock — the PAPER_CONTINUE gate, rendered INLINE.
 *
 * This is the one gate that is deliberately not a sheet. It sits at the bottom
 * of the free set's results screen, below the score, below the free
 * wrong-answer review and below the weak-topic callout — after the learner has
 * been paid in feedback for the twenty questions they actually did. Nothing
 * about it interrupts: it is a dashed card in a page the learner navigated to.
 *
 * ── The reset date is required, not decorative ─────────────────────────
 *
 * "Your next free set unlocks on Monday." A lock with no stated reset reads as
 * extortion; the same lock with a date reads as a rule, and the learner comes
 * back on Monday. So a missing `resetsAt` is a BUG and this component says so
 * in development rather than quietly rendering a bare lock — a silent
 * omission here is invisible in review and expensive in retention.
 *
 * ── Why it lives in features/papers and not features/subscription ──────
 *
 * One consumer: the free-set results screen. It renders a GATE, but the gate's
 * registry, copy and routing all come from the entitlements service, which is
 * where the shared part actually is. Putting it behind the subscription front
 * door would have added an eager edge from the papers chunk to `UpgradeModal`
 * — and through it to the Firebase invoices module — for a leaf card that
 * imports neither. Same reasoning the subscription front door already gives
 * for keeping its six paywall hosts as lazy route mounts.
 *
 * ── No price for a child ───────────────────────────────────────────────
 *
 * The route comes from `useUnlockFlow`. Under 18 the button reads "Ask your
 * guardian to unlock" and this component renders no figure at all; the
 * cheapest-rung quote is computed only on the adult branch.
 */

import { useEffect } from 'react'
import { formatResetDate, useEntitlements, useUnlockFlow } from '../../../services/entitlements'
import { cheapestPlan, formatKwacha } from '../../../config/plans'
import { capture } from '../../../utils/analytics'

/**
 * @param {object} props
 * @param {string} props.paperId
 * @param {number} props.remaining          questions left beyond the free set
 * @param {string[]} [props.lockedTopics]   e.g. ['Spelling', 'Punctuation']
 * @param {string} [props.paperYear]
 * @param {() => void} [props.onDismiss]    "Not now" — stays on the results screen
 */
export default function PaperContinueLock({
  paperId,
  remaining,
  lockedTopics = [],
  paperYear = '',
  onDismiss,
}) {
  const { planState } = useEntitlements()
  const { requestUnlock, isUnder18 } = useUnlockFlow()

  const resetsAt = planState?.resetsAt?.papersThisWeek || null
  const resetLabel = formatResetDate(resetsAt)

  useEffect(() => {
    capture('paper_continue_lock_shown', { paper_id: paperId, remaining })
  }, [paperId, remaining])

  // A reset date is part of the contract. Rather than render a lock that
  // cannot say when it lifts, render nothing — a learner who sees no offer is
  // strictly better off than one who sees a lock with no way out — and shout
  // in the console so the missing state is found rather than tolerated.
  if (!resetLabel) {
    console.error(
      '[PaperContinueLock] planState.resetsAt.papersThisWeek is missing. ' +
      'Every quota lock must be able to state its reset date; rendering nothing.',
    )
    return null
  }

  const cheapest = isUnder18 ? null : cheapestPlan()

  function handleUnlock() {
    capture('paper_continue_lock_tapped', {
      paper_id: paperId,
      remaining,
      route: isUnder18 ? 'guardian' : 'checkout',
    })
    requestUnlock('PAPER_CONTINUE', {
      screen: 'free-set-results',
      paperId,
      remaining,
      paperYear,
    })
  }

  return (
    <section className="mt-4 rounded-radius-md border-2 border-dashed border-indigo-200 theme-card p-4 text-left dark:border-indigo-400/30">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-indigo-50 text-base text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-200" aria-hidden="true">
          🔒
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-black theme-text">
            {remaining} more question{remaining === 1 ? '' : 's'} in this paper
          </span>
          {lockedTopics.length > 0 && (
            <span className="block truncate text-[11px] theme-text-muted">
              {lockedTopics.join(' · ')}
            </span>
          )}
        </span>
      </div>

      <p className="text-[12px] leading-relaxed theme-text-muted">
        Finish the whole {paperYear} paper and get it marked like the real exam.
      </p>

      <button
        type="button"
        onClick={handleUnlock}
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-transform hover:scale-[1.01] active:scale-95"
      >
        {isUnder18
          ? 'Ask your guardian to unlock'
          : `Unlock — from ${formatKwacha(cheapest?.price)}`}
      </button>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="w-full bg-transparent px-4 py-1.5 text-[12px] font-bold theme-text-muted shadow-none"
        >
          Not now
        </button>
      )}

      <p className="mt-1 text-center text-[10px] theme-text-muted opacity-80">
        Your next free set unlocks on {resetLabel}.
      </p>
    </section>
  )
}
