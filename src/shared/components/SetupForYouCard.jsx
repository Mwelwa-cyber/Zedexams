/**
 * SetupForYouCard — the ONE "Set up for you — this week's lesson" context
 * card, shared by the Lesson Plan wizard and the generator studios.
 *
 * The single-source-of-truth rule (the bug this card exists to fix): the
 * chips it shows MUST be derived from the same state object that populates
 * the form fields — never from the raw suggestion that produced them. If
 * the teacher changes Class/Subject the caller re-derives the chips (so the
 * card follows) or dismisses the card. The card itself is presentational.
 *
 *   <SetupForYouCard
 *     chips={[
 *       { label: 'Week 11', variant: 'blue' },
 *       { label: 'Grade 4' },
 *       { label: 'Technology Studies' },
 *       { label: '✓ CBC curriculum', variant: 'green' },
 *     ]}
 *     onChange={fn}   // optional "Change" secondary button
 *     onDismiss={fn}  // the × button
 *   />
 *
 * Terracotta 1.5px border so it reads as "smart suggestion", per the shared
 * notice rules: at most two notice rows above a form — one amber system
 * strip (DraftRecoveryPrompt) + one of these.
 */

import { CalendarDays, X } from 'lucide-react'
import Chip from '../../components/ui/Chip'

export default function SetupForYouCard({
  title = 'Set up for you — this week’s lesson',
  chips = [],
  onChange = null,
  changeLabel = 'Change',
  onDismiss = null,
}) {
  const visible = chips.filter((c) => c && c.label)
  if (visible.length === 0) return null

  return (
    <div
      className="flex items-start gap-3 rounded-xl border-[1.5px] bg-card px-3.5 py-3"
      style={{ borderColor: 'var(--zt-accent)' }}
      data-print="hide"
    >
      <CalendarDays size={18} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'var(--zt-accent-text)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-snug text-ink">{title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {visible.map((chip) => (
            <Chip key={chip.label} variant={chip.variant || 'neutral'}>
              {chip.label}
            </Chip>
          ))}
        </div>
      </div>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-lg border-[1.5px] border-card-border bg-card px-3 py-1.5 text-[12px] font-bold text-ink transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        >
          {changeLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="shrink-0 rounded-lg p-1 text-ink-muted transition-colors hover:text-ink"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
