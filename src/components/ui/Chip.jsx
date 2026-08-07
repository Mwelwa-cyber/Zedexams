/**
 * Chip — the ONE status/meta pill for teacher studio surfaces.
 *
 * Variants are named by MEANING, not by screen, so the same colour always
 * carries the same message everywhere:
 *   green   good / synced / saved
 *   amber   attention / draft / marks
 *   blue    info / time
 *   red     problem / needs review
 *   purple  special states (e.g. Excused)
 *   pink    subject accent (Home Economics tile family)
 *   neutral plain metadata
 *
 * Colours live in index.css under `.zx-chip` (with the Night remaps beside
 * the other studio component remaps) — do not add inline hexes here.
 */

const VARIANTS = new Set(['green', 'amber', 'blue', 'red', 'purple', 'pink', 'neutral'])

export default function Chip({ variant = 'neutral', className = '', title, children, ...rest }) {
  const safe = VARIANTS.has(variant) ? variant : 'neutral'
  return (
    <span className={`zx-chip zx-chip--${safe} ${className}`.trim()} title={title} {...rest}>
      {children}
    </span>
  )
}
