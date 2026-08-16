/**
 * LockBadge + LockedCard — Tier 1. Locks you can see.
 *
 * Three things a locked item must never be, each of which the app did at
 * least once before this component existed:
 *
 *   • HIDDEN. A feature removed from the list converts nobody and teaches the
 *     learner the app is smaller than it is.
 *   • `disabled`. A disabled card swallows the tap, and the tap IS the point —
 *     it is the moment the learner has chosen to engage with the offer, which
 *     is exactly when they are most persuadable.
 *   • `pointer-events: none`. Same failure, less visibly.
 *
 * So a locked card stays rendered, stays readable, stays tappable, and grows a
 * padlock and a "Tap to unlock" subtitle. Its icon drops to ~55% grayscale —
 * enough to read as unavailable, not so much that it reads as broken.
 *
 * It sits in `src/shared/` beside `PlanChip` and for the same reason: any list
 * with a locked row needs it, and the subscription front door eagerly exports
 * the Lenco checkout.
 */

import Icon from './Icon'
import { Lock } from './icons'

/** The padlock itself, for callers composing their own card. */
export function LockBadge({ className = '' }) {
  return (
    <span
      className={`inline-grid h-6 w-6 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-200 ${className}`}
      aria-hidden="true"
    >
      <Icon as={Lock} size="xs" />
    </span>
  )
}

/** The grayscale treatment for a locked item's icon. */
export const LOCKED_ICON_CLASS = 'grayscale-[0.55] opacity-90'

/**
 * A locked list row.
 *
 * @param {object} props
 * @param {React.ReactNode} props.icon    the row's own icon, rendered dimmed
 * @param {string} props.title
 * @param {string} [props.subtitle]       defaults to "Tap to unlock"
 * @param {() => void} props.onUnlock     opens the contextual sheet
 */
export default function LockedCard({
  icon,
  title,
  subtitle = 'Tap to unlock',
  onUnlock,
  className = '',
}) {
  return (
    <button
      type="button"
      onClick={onUnlock}
      className={`flex w-full items-center gap-3 rounded-radius-md border theme-border theme-card p-3 text-left shadow-none transition-colors hover:theme-bg-subtle ${className}`}
    >
      <span className={`grid h-9 w-9 flex-none place-items-center rounded-xl theme-bg-subtle text-lg ${LOCKED_ICON_CLASS}`} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-black theme-text-muted">{title}</span>
        <span className="block text-[11px] font-semibold theme-text-muted opacity-80">{subtitle}</span>
      </span>
      <LockBadge className="flex-none" />
    </button>
  )
}
