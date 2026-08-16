/**
 * PlanChip — Tier 0. The whole of the ambient pressure.
 *
 * A slim chip beside the bell showing what is left: `Free · 2 left`, `0 left`,
 * `Grace`, `Premium`. It never animates, never pulses, never blocks and never
 * asks permission from the interruption budget, because it is not an
 * interruption — it is the page. A meter running down motivates more reliably
 * than a modal does, and it makes the limit legible BEFORE it is hit, which is
 * the difference between a rule and an ambush.
 *
 * Tapping opens the plan ladder (adults) or the guardian-ask sheet (under-18)
 * through `useUnlockFlow`, which is the only thing that decides which.
 *
 * ── Why src/shared/ and not the subscription feature ───────────────────
 *
 * Two consumers in two different features — the learner header and the teacher
 * top bar — so it has to be reachable from both. Behind the subscription front
 * door it would have been: that door eagerly exports `UpgradeModal`, and
 * through it `utils/invoices`, so importing a 40-line chip would have put the
 * whole Lenco checkout into the learner home chunk. The front door's own
 * docblock records exactly this measurement for its other consumers.
 *
 * It reaches Firebase only THROUGH `src/services/entitlements`, which is the
 * sanctioned direction for this layer (docs/architecture.md §14.2 — shared,
 * engines and curriculum reach Firebase through a service, never directly).
 */

import { useEntitlements, useUnlockFlow } from '../../services/entitlements'

const TONE_CLASS = {
  free: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-400/30',
  warn: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30',
  premium: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30',
  neutral: 'theme-bg-subtle theme-text-muted theme-border',
}

const DOT_CLASS = {
  free: 'bg-indigo-500',
  warn: 'bg-amber-500',
  premium: 'bg-emerald-500',
  neutral: 'bg-gray-400',
}

/**
 * @param {object} props
 * @param {'learner'|'teacher'} [props.surface] tints the chip for the teacher
 *   shell (teal) rather than the learner palette (indigo). Cosmetic only —
 *   the label and tone come from the plan state either way.
 */
export default function PlanChip({ surface = 'learner', className = '' }) {
  const { planState, chipLabel, chipTone } = useEntitlements()
  const { requestUnlock } = useUnlockFlow()

  // A premium account with nothing to count down does not need a chip taking
  // up header width. Grace keeps its chip — that one is doing a job.
  if (!planState) return null
  if (chipTone === 'premium' && planState.status !== 'grace') return null

  const tone = surface === 'teacher' && chipTone === 'free' ? 'premium' : chipTone
  const gate = planState.role === 'teacher' ? 'TEACHER_AI_GEN' : 'PAPER_OPEN'

  return (
    <button
      type="button"
      onClick={() => requestUnlock(gate, { screen: 'plan-chip', quota: planState.quotas?.papersThisWeek })}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black leading-none shadow-none transition-colors ${TONE_CLASS[tone] || TONE_CLASS.neutral} ${className}`}
      aria-label={`${chipLabel}. Tap to see plans.`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone] || DOT_CLASS.neutral}`} aria-hidden="true" />
      {chipLabel}
    </button>
  )
}
