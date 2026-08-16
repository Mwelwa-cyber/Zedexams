import useDelayedFlag from '../hooks/useDelayedFlag'

/**
 * TopLine — a 2px accent line on the shared loading tempo.
 *
 * Mount it inside the main content column of a shell (not at the document
 * root) so the sidebar and top bar stay visible and interactive while it runs;
 * pass `fixed` only for the app-wide route fallback, which has no shell above
 * it to sit inside.
 *
 * Gated by useDelayedFlag, so a transition that resolves inside ~200ms paints
 * nothing at all.
 */
export default function TopLine({ active = true, fixed = false, label = 'Loading' }) {
  const show = useDelayedFlag(active)
  if (!show) return null

  return (
    <div
      className={`zx-topline${fixed ? ' zx-topline--fixed' : ''}`}
      role="progressbar"
      aria-busy="true"
      aria-label={label}
    />
  )
}
