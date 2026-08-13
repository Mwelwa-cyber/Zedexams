/**
 * A past paper's name on screen, composed from its structured fields.
 *
 * Nothing here reads `paper.title`. The title is derived, display-only and
 * regenerated on save; the facts a learner needs — WHICH subject, WHICH paper,
 * and above all WHOSE paper (a real ECZ exam or a commercial mock) — live in
 * `source`, `paperNumber`, `session` and `year`, and are composed by
 * `src/utils/paperTitleCore.js`.
 *
 * Two variants:
 *
 *   row   two lines. Line 1 is the source badge + the paper number; line 2 is
 *         the descriptor, the sitting, and the quiz state. This is what a
 *         subject card lists.
 *   full  one composed string for the viewer header and exports.
 *
 * THE BADGE CARRIES ITS OWN MEANING. Official sources render as a solid
 * accent-filled chip and mocks as an outlined one, but the shape is the
 * secondary signal — the word inside it ("ECZ", "PRISCA mock") is the primary
 * one, so the distinction survives Night mode, a monochrome printout, and a
 * reader who cannot separate the two fills by colour.
 */

import { useRef } from 'react'
import { useElementWidth } from '../../../hooks/useElementWidth'
import {
  composePaperRow,
  composePaperTitle,
  fullPaperTitle,
} from '../../../utils/paperTitleCore'
import { ShieldCheck, FileText } from '../../../components/ui/icons'

/**
 * The source chip.
 *
 * `theme-accent-fill` / `theme-on-accent` are the four-theme tokens — the fill
 * and the text on it move together per theme, which is what keeps the solid
 * chip readable in Night mode. The outlined variant uses `theme-text-muted` on
 * the card background rather than a hardcoded grey for the same reason.
 */
export function PaperSourceBadge({ label, isOfficial, size = 'md' }) {
  const dims = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
  const Icon = isOfficial ? ShieldCheck : FileText
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-black whitespace-nowrap ${dims} ${
        isOfficial
          ? 'theme-accent-fill theme-on-accent'
          : 'border theme-border theme-text-muted'
      }`}
      // The chip's shape says "official" only as a second signal; this says it
      // to a screen reader, which sees neither the fill nor the icon.
      title={isOfficial ? 'Official exam paper' : 'Practice paper — not an ECZ exam'}
    >
      <Icon size={11} strokeWidth={2.6} aria-hidden="true" />
      {label}
    </span>
  )
}

function RowVariant({ paper }) {
  const ref = useRef(null)
  const measured = useElementWidth(ref)
  const row = composePaperRow(paper)
  // Line 1's non-badge half still shortens with the container, so a long
  // subject name on a 360px phone drops to the curriculum's short form rather
  // than being cut mid-word.
  const composed = composePaperTitle(paper, { width: measured ?? undefined })

  return (
    <div ref={ref} className="min-w-0" data-mode={composed.mode}>
      <div className="flex flex-wrap items-center gap-1.5">
        <PaperSourceBadge label={row.badge.label} isOfficial={row.badge.isOfficial} size="sm" />
        <span className="theme-text font-black text-sm leading-snug">
          {row.numberLabel || composed.line1}
        </span>
      </div>
      <p className="theme-text-muted text-[11px] font-bold mt-1 leading-snug">{row.secondary}</p>
    </div>
  )
}

/**
 * @param {object} paper    the paper document (structured fields only)
 * @param {'row'|'full'} variant
 * @param {string} className applied to the `full` variant's element
 */
export default function PaperTitle({ paper, variant = 'row', className = '' }) {
  if (variant === 'full') {
    return <span className={className}>{fullPaperTitle(paper)}</span>
  }
  return <RowVariant paper={paper} />
}
